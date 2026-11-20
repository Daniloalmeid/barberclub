-- Reversão: drop function public_api.* cascade.

create or replace function public_api.get_tenant_public(p_slug text)
returns table (
  slug text,
  display_name text,
  logo_url text,
  banner_urls jsonb,
  color_primary text,
  color_secondary text,
  color_accent text,
  address_line text,
  city text,
  state text,
  phone_public text,
  whatsapp_public text,
  instagram_handle text,
  timezone text,
  opening_hours jsonb,
  booking_policy_text text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.slug,
         t.display_name,
         b.logo_url,
         b.banner_urls,
         b.color_primary,
         b.color_secondary,
         b.color_accent,
         b.address_line,
         b.city,
         b.state,
         b.phone_public,
         b.whatsapp_public,
         b.instagram_handle,
         t.timezone,
         b.opening_hours,
         b.booking_policy_text
    from public.tenants t
    left join public.tenant_branding b on b.tenant_id = t.id
   where t.slug = p_slug
     and t.status in ('trial', 'active');
$$;

create or replace function public_api.list_services(p_slug text)
returns table (
  service_id uuid,
  name text,
  description text,
  duration_min integer,
  price_cents bigint,
  category text,
  display_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.description, s.duration_min, s.price_cents, s.category, s.display_order
    from public.services s
    join public.tenants t on t.id = s.tenant_id
   where t.slug = p_slug
     and t.status in ('trial', 'active')
     and s.active
   order by s.display_order, s.name;
$$;

create or replace function public_api.list_staff(p_slug text)
returns table (
  staff_id uuid,
  display_name text,
  photo_url text,
  short_bio text,
  service_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select st.id,
         st.display_name,
         st.photo_url,
         st.short_bio,
         coalesce(
           array_agg(ss.service_id order by ss.service_id) filter (where sv.id is not null),
           '{}'::uuid[]
         )
    from public.staff st
    join public.tenants t on t.id = st.tenant_id
    left join public.staff_services ss
      on ss.tenant_id = st.tenant_id
     and ss.staff_id = st.id
     and ss.active
    left join public.services sv
      on sv.tenant_id = ss.tenant_id
     and sv.id = ss.service_id
     and sv.active
   where t.slug = p_slug
     and t.status in ('trial', 'active')
     and st.active
   group by st.id
   order by st.display_name;
$$;

create or replace function public_api.list_free_slots(
  p_slug text,
  p_service uuid,
  p_staff uuid default null,
  p_day date default null
)
returns table (
  staff_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with tenant as (
    select t.id, t.timezone
      from public.tenants t
     where t.slug = p_slug
       and t.status in ('trial', 'active')
  ),
  svc as (
    select s.duration_min, s.buffer_min, s.tenant_id
      from public.services s
      join tenant t on t.id = s.tenant_id
     where s.id = p_service
       and s.active
  ),
  settings as (
    select ts.slot_step_minutes, ts.min_advance_minutes, ts.tenant_id
      from public.tenant_settings ts
      join tenant t on t.id = ts.tenant_id
  ),
  day as (
    select coalesce(
      p_day,
      (now() at time zone (select timezone from tenant))::date
    ) as d
  )
  select st.id,
         (slot_ts at time zone t.timezone),
         (slot_ts at time zone t.timezone)
           + make_interval(mins => svc.duration_min + svc.buffer_min)
    from tenant t
    cross join day
    cross join svc
    cross join settings
    join public.staff st
      on st.tenant_id = t.id
     and st.active
     and (p_staff is null or st.id = p_staff)
    join public.staff_services ss
      on ss.tenant_id = t.id
     and ss.staff_id = st.id
     and ss.service_id = p_service
     and ss.active
    join public.work_schedules w
      on w.tenant_id = t.id
     and w.staff_id = st.id
     and w.weekday = extract(dow from day.d)::integer
    join lateral generate_series(
      day.d + w.start_time,
      (day.d + w.end_time) - make_interval(mins => svc.duration_min + svc.buffer_min),
      make_interval(mins => settings.slot_step_minutes)
    ) as slot_ts on true
   where day.d <= (now() at time zone t.timezone)::date + 31
     and day.d >= (now() at time zone t.timezone)::date
     and (slot_ts at time zone t.timezone) >= now() + make_interval(mins => settings.min_advance_minutes)
     and not exists (
       select 1
         from public.staff_busy b
        where b.tenant_id = t.id
          and b.staff_id = st.id
          and b.active
          and b.period && tstzrange(
            slot_ts at time zone t.timezone,
            (slot_ts at time zone t.timezone)
              + make_interval(mins => svc.duration_min + svc.buffer_min),
            '[)'
          )
     )
   order by 2, 1;
$$;

create or replace function public_api.book_appointment(
  p_tenant uuid,
  p_staff uuid,
  p_service uuid,
  p_starts_at timestamptz,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_ends timestamptz;
  v_appt uuid;
  v_hash bytea;
  v_old_hash bytea;
  v_hold integer;
begin
  perform private.assert_tenant_bookable(p_tenant);

  select c.id into v_customer
    from public.customers c
   where c.tenant_id = p_tenant
     and c.user_id = (select auth.uid());
  if v_customer is null then
    raise exception 'not_a_customer' using errcode = '42501';
  end if;

  perform private.assert_staff_service_active(p_tenant, p_staff, p_service);
  perform private.lock_staff(p_tenant, p_staff);

  v_hash := private.request_hash(p_staff, p_service, p_starts_at);
  select a.id, a.request_hash
    into v_appt, v_old_hash
    from public.appointments a
   where a.tenant_id = p_tenant
     and a.customer_id = v_customer
     and a.idempotency_key = p_idempotency_key;
  if v_appt is not null then
    if v_old_hash <> v_hash then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_appt;
  end if;

  perform private.expire_holds_for_staff(p_tenant, p_staff);
  v_ends := private.validate_slot(p_tenant, p_staff, p_service, p_starts_at);
  select ts.hold_minutes into v_hold
    from public.tenant_settings ts
   where ts.tenant_id = p_tenant;
  v_hold := coalesce(v_hold, 10);

  begin
    insert into public.appointments (
      tenant_id, staff_id, customer_id, service_id, starts_at, ends_at,
      status, hold_expires_at, idempotency_key, request_hash
    ) values (
      p_tenant, p_staff, v_customer, p_service, p_starts_at, v_ends,
      'hold', now() + make_interval(mins => v_hold), p_idempotency_key, v_hash
    )
    returning id into v_appt;

    insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
    values (p_tenant, p_staff, tstzrange(p_starts_at, v_ends, '[)'), v_appt);
  exception
    when unique_violation then
      select a.id, a.request_hash
        into v_appt, v_old_hash
        from public.appointments a
       where a.tenant_id = p_tenant
         and a.customer_id = v_customer
         and a.idempotency_key = p_idempotency_key;
      if v_appt is null or v_old_hash <> v_hash then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
  end;

  return v_appt;
end
$$;

create or replace function public_api.cancel_appointment(
  p_appointment uuid, p_reason text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_staff uuid;
  v_appt public.appointments%rowtype;
begin
  select a.tenant_id, a.staff_id
    into strict v_tenant, v_staff
    from public.appointments a
   where a.id = p_appointment;

  perform private.assert_can_cancel(v_tenant, p_appointment);
  perform private.lock_staff(v_tenant, v_staff);

  select * into strict v_appt
    from public.appointments
   where id = p_appointment
     for update;

  if v_appt.staff_id <> v_staff then
    raise exception 'appointment_reassigned_retry' using errcode = '40001';
  end if;
  if v_appt.status not in ('hold', 'pending_payment', 'confirmed') then
    return 'noop';
  end if;

  -- appointments, depois payments, depois staff_busy, depois refund_requests.
  perform 1
    from public.payments
   where appointment_id = p_appointment
     for update;

  update public.appointments
     set status = 'canceled'
   where id = p_appointment;

  update public.staff_busy
     set active = false
   where appointment_id = p_appointment;

  perform private.request_refund_if_paid(v_tenant, p_appointment, coalesce(p_reason, 'cancellation'));
  return 'canceled';
end
$$;

create or replace function public_api.create_time_off(
  p_tenant uuid,
  p_staff uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_allowed boolean;
begin
  if p_ends <= p_starts then
    raise exception 'slot_invalid' using errcode = '22023';
  end if;

  v_allowed := private.has_role(p_tenant, array['owner', 'manager'])
    or exists (
      select 1
        from public.staff s
       where s.tenant_id = p_tenant
         and s.id = p_staff
         and s.user_id = (select auth.uid())
    );
  if not v_allowed then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.lock_staff(p_tenant, p_staff);

  insert into public.time_off (tenant_id, staff_id, starts_at, ends_at, active, reason)
  values (p_tenant, p_staff, p_starts, p_ends, true, p_reason)
  returning id into v_id;

  insert into public.staff_busy (tenant_id, staff_id, period, time_off_id)
  values (p_tenant, p_staff, tstzrange(p_starts, p_ends, '[)'), v_id);

  return v_id;
end
$$;

create or replace function public_api.complete_appointment(p_appointment uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_bps integer;
  v_amount bigint;
  v_commission bigint;
begin
  select * into v_appt from public.appointments where id = p_appointment;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;
  if not (
    private.has_role(v_appt.tenant_id, array['owner', 'manager'])
    or v_appt.staff_id in (select private.my_staff_ids(v_appt.tenant_id))
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.lock_staff(v_appt.tenant_id, v_appt.staff_id);
  select * into v_appt from public.appointments where id = p_appointment for update;
  perform 1 from public.payments where appointment_id = p_appointment for update;

  if v_appt.status <> 'confirmed' then
    raise exception 'appointment_not_confirmed' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.payments p
     where p.appointment_id = p_appointment
       and p.status = 'paid'
  ) then
    raise exception 'appointment_not_paid' using errcode = '22023';
  end if;

  update public.appointments set status = 'completed' where id = p_appointment;
  update public.staff_busy set active = false where appointment_id = p_appointment;

  select coalesce(s.commission_bps, st.commission_bps, 0),
         coalesce(v_appt.price_cents, s.price_cents, 0)
    into v_bps, v_amount
    from public.services s
    join public.staff st on st.tenant_id = s.tenant_id and st.id = v_appt.staff_id
   where s.tenant_id = v_appt.tenant_id
     and s.id = v_appt.service_id;
  v_commission := (v_amount * v_bps) / 10000;
  if v_commission > 0 then
    perform ledger.post_journal_entry(
      v_appt.tenant_id, 'commission', 'appointment', p_appointment, now(),
      jsonb_build_array(
        jsonb_build_object('code', '5.1.02', 'debit_cents', v_commission, 'credit_cents', 0),
        jsonb_build_object('code', '2.1.01', 'debit_cents', 0, 'credit_cents', v_commission)
      ),
      'comissao'
    );
  end if;
  return 'completed';
end
$$;

create or replace function public_api.invite_member(
  p_tenant uuid, p_user uuid, p_role text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_tenant, array['owner']) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'manager', 'staff') then
    raise exception 'invalid_role' using errcode = '42501';
  end if;
  insert into public.memberships (tenant_id, user_id, role, status)
  values (p_tenant, p_user, p_role, 'invited')
  on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        status = 'invited'
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public_api.change_member_role(
  p_tenant uuid, p_user uuid, p_role text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_tenant, array['owner']) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'manager', 'staff') then
    raise exception 'invalid_role' using errcode = '42501';
  end if;
  update public.memberships
     set role = p_role
   where tenant_id = p_tenant
     and user_id = p_user;
  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
end
$$;

create or replace function public_api.record_commission_payout(
  p_tenant uuid, p_staff uuid, p_amount bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_id uuid := gen_random_uuid();
begin
  if not private.has_role(p_tenant, array['owner']) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  perform private.lock_staff(p_tenant, p_staff);
  select coalesce(sum(l.credit_cents - l.debit_cents), 0)
    into v_balance
    from ledger.journal_lines l
    join ledger.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
   where a.tenant_id = p_tenant
     and a.code = '2.1.01';
  if p_amount > v_balance then
    raise exception 'payout_exceeds_balance' using errcode = '22023';
  end if;

  return ledger.post_journal_entry(
    p_tenant, 'commission_payout', 'staff', v_id, now(),
    jsonb_build_array(
      jsonb_build_object('code', '2.1.01', 'debit_cents', p_amount, 'credit_cents', 0),
      jsonb_build_object('code', '1.1.03', 'debit_cents', 0, 'credit_cents', p_amount)
    ),
    'pagamento de comissao'
  );
end
$$;
