-- FK composta de webhook_events para payments, checada só no COMMIT.
-- O INSERT do evento continua antes do advisory: a deduplicação precisa
-- responder sem esperar o lock do profissional. A FK imediata tomaria
-- FOR KEY SHARE em payments nesse INSERT e o C08 volta a dar deadlock.
-- DEFERRABLE INITIALLY DEFERRED empurra essa trava para o COMMIT, depois
-- de lock_staff e do FOR UPDATE. Nenhum caminho usa SET CONSTRAINTS IMMEDIATE
-- nesta constraint.

alter table public.webhook_events
  add column tenant_id uuid;

update public.webhook_events as w
   set tenant_id = p.tenant_id
  from public.payments as p
 where w.payment_id = p.id
   and w.tenant_id is null;

-- Pré-voo: não apaga linha. Sem payment_id, ou payment_id sem payments, o SET NOT NULL para.
do $pre$
declare
  sem_payment bigint;
  orfao bigint;
begin
  select count(*) into sem_payment
    from public.webhook_events
   where payment_id is null;
  select count(*) into orfao
    from public.webhook_events w
   where w.payment_id is not null
     and not exists (select 1 from public.payments p where p.id = w.payment_id);
  if sem_payment > 0 or orfao > 0 then
    raise exception
      'webhook_events pré-voo: % sem payment_id e % com payment órfão. Não apague essas linhas; corrija antes do SET NOT NULL.',
      sem_payment, orfao;
  end if;
end
$pre$;

alter table public.webhook_events
  alter column tenant_id set not null;

-- NO ACTION é o padrão. DEFERRABLE INITIALLY DEFERRED: o FOR KEY SHARE espera o COMMIT.
-- Não usar SET CONSTRAINTS IMMEDIATE nesta constraint.
alter table public.webhook_events
  add constraint webhook_events_tenant_payment_fkey
  foreign key (tenant_id, payment_id)
  references public.payments (tenant_id, id)
  on delete no action
  deferrable initially deferred;

comment on constraint webhook_events_tenant_payment_fkey on public.webhook_events is
  'NO ACTION, DEFERRABLE INITIALLY DEFERRED. A checagem espera o COMMIT.';

create index webhook_events_tenant_id_payment_id_idx
  on public.webhook_events (tenant_id, payment_id);

create trigger webhook_events_tenant_immutable
  before update of tenant_id on public.webhook_events
  for each row
  execute function private.forbid_tenant_change();

-- refunds e refund_requests: a FK imediata só em payments(id) não amarra o tenant.
-- O INSERT acontece depois do advisory e do FOR UPDATE em payments
-- (cancel_appointment, process_payment_event, record_refund_result).
-- A FK composta imediata toma FOR KEY SHARE numa linha que a mesma
-- transação já trava. Não abre espera antes do advisory, então não fica deferida.
alter table public.refunds
  drop constraint if exists refunds_payment_id_fkey;

alter table public.refunds
  add constraint refunds_tenant_payment_fkey
  foreign key (tenant_id, payment_id)
  references public.payments (tenant_id, id)
  on delete restrict;

create index refunds_tenant_id_payment_id_idx
  on public.refunds (tenant_id, payment_id);

alter table public.refund_requests
  drop constraint if exists refund_requests_payment_id_fkey;

alter table public.refund_requests
  add constraint refund_requests_tenant_payment_fkey
  foreign key (tenant_id, payment_id)
  references public.payments (tenant_id, id)
  on delete restrict;

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
as $fn$
declare
  v_pay public.payments%rowtype;
  v_appt public.appointments%rowtype;
  v_tenant uuid;
  v_staff uuid;
  v_appt_id uuid;
begin
  select p.tenant_id into v_tenant
    from public.payments p
   where p.id = p_payment_id;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  insert into public.webhook_events (provider, event_id, tenant_id, payment_id, received_at)
  values (p_provider, p_event_id, v_tenant, p_payment_id, now())
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
$fn$;

create or replace function server_api.record_refund_result(
  p_payment_id uuid, p_status text, p_event_id text
) returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_pay public.payments%rowtype;
  v_staff uuid;
  v_tenant uuid;
begin
  select p.tenant_id, a.staff_id
    into v_tenant, v_staff
    from public.payments p
    join public.appointments a
      on a.id = p.appointment_id
     and a.tenant_id = p.tenant_id
   where p.id = p_payment_id;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  insert into public.webhook_events (provider, event_id, tenant_id, payment_id, received_at)
  values ('refund', p_event_id, v_tenant, p_payment_id, now())
  on conflict (provider, event_id) do nothing;
  if not found then
    return 'duplicate_event';
  end if;

  perform private.lock_staff(v_tenant, v_staff);
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
$fn$;
