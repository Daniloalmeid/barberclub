-- Reversão: drop function server_api.* cascade.

create or replace function server_api.health()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 1;
$$;

create or replace function server_api.rate_limit_hit(
  p_bucket text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  v_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  insert into public.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update
    set hits = r.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end
$$;

create or replace function server_api.process_payment_event(
  p_provider text,
  p_event_id text,
  p_payment_id uuid,
  p_verified_status text,
  p_verified_amount_cents bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_appt public.appointments%rowtype;
  v_tenant uuid;
  v_staff uuid;
  v_appt_id uuid;
begin
  insert into public.webhook_events (provider, event_id, payment_id, received_at)
  values (p_provider, p_event_id, p_payment_id, now())
  on conflict (provider, event_id) do nothing;
  if not found then
    return 'duplicate_event';
  end if;
  if p_verified_status <> 'paid' then
    return 'ignored_status';
  end if;

  select a.tenant_id, a.staff_id, a.id
    into strict v_tenant, v_staff, v_appt_id
    from public.payments p
    join public.appointments a
      on a.tenant_id = p.tenant_id
     and a.id = p.appointment_id
   where p.id = p_payment_id;

  perform private.lock_staff(v_tenant, v_staff);

  select * into strict v_appt
    from public.appointments
   where id = v_appt_id
     for update;
  select * into strict v_pay
    from public.payments
   where id = p_payment_id
     for update;

  if v_appt.staff_id <> v_staff then
    raise exception 'appointment_reassigned_retry' using errcode = '40001';
  end if;
  if v_pay.status <> 'pending' then
    return 'already_processed';
  end if;
  if p_verified_amount_cents <> v_pay.amount_cents then
    perform private.open_admin_case(v_pay.tenant_id, 'amount_mismatch', p_payment_id);
    return 'amount_mismatch';
  end if;

  if v_appt.status in ('canceled', 'no_show', 'completed') then
    perform private.register_unallocated_payment(
      v_pay.tenant_id, p_payment_id, v_appt.id, 'paid_after_cancel'
    );
    return 'refund_requested';
  end if;

  if v_appt.status in ('hold', 'pending_payment') and v_appt.hold_expires_at >= now() then
    update public.appointments set status = 'confirmed' where id = v_appt.id;
    update public.payments set status = 'paid', paid_at = now() where id = p_payment_id;
    perform private.post_payment(v_pay.tenant_id, p_payment_id, 'revenue');
    return 'confirmed';
  end if;

  begin
    update public.staff_busy
       set active = true
     where appointment_id = v_appt.id;
    if not found then
      insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
      values (
        v_appt.tenant_id,
        v_appt.staff_id,
        tstzrange(v_appt.starts_at, v_appt.ends_at, '[)'),
        v_appt.id
      );
    end if;
    update public.appointments set status = 'confirmed' where id = v_appt.id;
    update public.payments set status = 'paid', paid_at = now() where id = p_payment_id;
    perform private.post_payment(v_pay.tenant_id, p_payment_id, 'revenue');
    return 'confirmed_late';
  exception
    when exclusion_violation then
      update public.appointments set status = 'payment_conflict' where id = v_appt.id;
      perform private.register_unallocated_payment(
        v_pay.tenant_id, p_payment_id, v_appt.id, 'late_payment_slot_taken'
      );
      return 'refund_requested';
  end;
end
$$;

create or replace function server_api.record_refund_result(
  p_payment_id uuid, p_status text, p_event_id text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_staff uuid;
begin
  insert into public.webhook_events (provider, event_id, payment_id, received_at)
  values ('refund', p_event_id, p_payment_id, now())
  on conflict (provider, event_id) do nothing;
  if not found then
    return 'duplicate_event';
  end if;

  select a.staff_id into v_staff
    from public.payments p
    join public.appointments a on a.id = p.appointment_id and a.tenant_id = p.tenant_id
   where p.id = p_payment_id;
  perform private.lock_staff(
    (select tenant_id from public.payments where id = p_payment_id),
    v_staff
  );
  select * into v_pay from public.payments where id = p_payment_id for update;
  if v_pay.status = 'refunded' then
    return 'already_processed';
  end if;
  if p_status <> 'refunded' then
    return 'ignored_status';
  end if;

  update public.payments set status = 'refunded' where id = p_payment_id;
  update public.refund_requests set status = 'done' where payment_id = p_payment_id;
  insert into public.refunds (tenant_id, payment_id, amount_cents, status)
  values (v_pay.tenant_id, p_payment_id, v_pay.amount_cents, 'refunded');
  perform ledger.post_journal_entry(
    v_pay.tenant_id, 'refund', 'refund', p_payment_id, now(),
    jsonb_build_array(
      jsonb_build_object('code', '2.1.02', 'debit_cents', v_pay.amount_cents, 'credit_cents', 0),
      jsonb_build_object('code', '1.1.02', 'debit_cents', 0, 'credit_cents', v_pay.amount_cents)
    ),
    'reembolso concluido'
  );
  return 'refunded';
end
$$;

create or replace function server_api.record_settlement(
  p_tenant uuid, p_source uuid, p_amount bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return ledger.post_journal_entry(
    p_tenant, 'settlement', 'settlement', p_source, now(),
    jsonb_build_array(
      jsonb_build_object('code', '1.1.02', 'debit_cents', p_amount, 'credit_cents', 0),
      jsonb_build_object('code', '1.1.01', 'debit_cents', 0, 'credit_cents', p_amount)
    ),
    'liquidacao'
  );
end
$$;

create or replace function server_api.reverse_entry(p_entry uuid, p_memo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return ledger.reverse_journal_entry(p_entry, p_memo);
end
$$;

create or replace function server_api.expire_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select distinct a.tenant_id, a.staff_id
      from public.appointments a
     where a.status in ('hold', 'pending_payment')
       and a.hold_expires_at < now() - interval '1 minute'
     order by a.staff_id
  loop
    perform private.lock_staff(r.tenant_id, r.staff_id);
  end loop;

  update public.staff_busy b
     set active = false
    from public.appointments a
   where a.id = b.appointment_id
     and a.status in ('hold', 'pending_payment')
     and a.hold_expires_at < now() - interval '1 minute';

  update public.appointments a
     set status = 'expired'
   where a.status in ('hold', 'pending_payment')
     and a.hold_expires_at < now() - interval '1 minute';
  get diagnostics v_count = row_count;

  delete from public.rate_limits
   where window_start < now() - interval '24 hours';

  return v_count;
end
$$;

create or replace function server_api.run_reconciliation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened integer := 0;
  r record;
begin
  for r in
    select a.tenant_id, a.id as ref
      from public.appointments a
     where a.status in ('hold', 'pending_payment', 'confirmed')
       and not exists (
         select 1 from public.staff_busy b
          where b.appointment_id = a.id and b.active
       )
    union all
    select a.tenant_id, b.id
      from public.staff_busy b
      join public.appointments a on a.id = b.appointment_id
     where b.active
       and (
         a.status not in ('hold', 'pending_payment', 'confirmed')
         or b.period <> tstzrange(a.starts_at, a.ends_at, '[)')
         or b.staff_id <> a.staff_id
       )
  loop
    if not exists (
      select 1 from public.admin_cases c
       where c.tenant_id = r.tenant_id
         and c.kind = 'reconciliation'
         and c.ref_id = r.ref
         and c.status = 'open'
    ) then
      perform private.open_admin_case(r.tenant_id, 'reconciliation', r.ref);
      v_opened := v_opened + 1;
    end if;
  end loop;
  return v_opened;
end
$$;
