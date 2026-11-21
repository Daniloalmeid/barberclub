-- Reversão: drop function private.* cascade e drop dos triggers associados.
-- As tabelas permanecem.

create or replace function private.forbid_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function private.has_role(p_tenant uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
     where m.tenant_id = p_tenant
       and m.user_id = (select auth.uid())
       and m.role = any (p_roles)
       and m.status = 'active'
  );
$$;

create or replace function private.my_customer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from public.customers c
   where c.user_id = (select auth.uid());
$$;

create or replace function private.my_staff_ids(p_tenant uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.staff s
   where s.tenant_id = p_tenant
     and s.user_id = (select auth.uid());
$$;

-- Ordem global: advisory do profissional antes de qualquer row lock.
create or replace function private.lock_staff(p_tenant uuid, p_staff uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended('staff:' || p_tenant::text || ':' || p_staff::text, 0)
  );
$$;

create or replace function private.assert_tenant_bookable(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_sub text;
begin
  select t.status into v_tenant from public.tenants t where t.id = p_tenant;
  select s.status into v_sub
    from public.subscriptions s
   where s.tenant_id = p_tenant
   order by s.created_at desc
   limit 1;

  -- D7: só trial ou active. past_due bloqueia reserva nova.
  if v_tenant not in ('trial', 'active') or v_sub is null or v_sub not in ('trial', 'active') then
    raise exception 'tenant_not_bookable' using errcode = 'P0001';
  end if;
end
$$;

create or replace function private.assert_staff_service_active(
  p_tenant uuid, p_staff uuid, p_service uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.staff_services ss
      join public.staff st
        on st.tenant_id = ss.tenant_id and st.id = ss.staff_id
      join public.services sv
        on sv.tenant_id = ss.tenant_id and sv.id = ss.service_id
     where ss.tenant_id = p_tenant
       and ss.staff_id = p_staff
       and ss.service_id = p_service
       and ss.active
       and st.active
       and sv.active
  ) then
    raise exception 'staff_service_inactive' using errcode = 'P0001';
  end if;
end
$$;

create or replace function private.request_hash(
  p_staff uuid, p_service uuid, p_starts timestamptz
) returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(
    convert_to(
      concat_ws(
        '|',
        p_staff::text,
        p_service::text,
        to_char(p_starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
      ),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.validate_slot(
  p_tenant uuid, p_staff uuid, p_service uuid, p_starts timestamptz
) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_duration integer;
  v_buffer integer;
  v_ends timestamptz;
  v_min integer;
  v_tz text;
  v_local timestamp;
  v_end_local timestamp;
begin
  select s.duration_min, s.buffer_min
    into v_duration, v_buffer
    from public.services s
   where s.tenant_id = p_tenant and s.id = p_service and s.active;
  if v_duration is null then
    raise exception 'slot_invalid' using errcode = '22023';
  end if;

  v_ends := p_starts + make_interval(mins => v_duration + v_buffer);

  select t.timezone into v_tz from public.tenants t where t.id = p_tenant;
  select coalesce(ts.min_advance_minutes, 0) into v_min
    from public.tenant_settings ts where ts.tenant_id = p_tenant;
  if v_min is null then
    v_min := 0;
  end if;
  if p_starts < now() + make_interval(mins => v_min) then
    raise exception 'slot_invalid' using errcode = '22023';
  end if;

  v_local := p_starts at time zone v_tz;
  v_end_local := v_ends at time zone v_tz;
  if v_end_local::date <> v_local::date then
    raise exception 'slot_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.work_schedules w
     where w.tenant_id = p_tenant
       and w.staff_id = p_staff
       and w.weekday = extract(dow from v_local)::integer
       and w.start_time <= v_local::time
       and w.end_time >= v_end_local::time
  ) then
    raise exception 'slot_invalid' using errcode = '22023';
  end if;

  return v_ends;
end
$$;

create or replace function private.expire_holds_for_staff(p_tenant uuid, p_staff uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.staff_busy b
     set active = false
    from public.appointments a
   where a.id = b.appointment_id
     and a.tenant_id = p_tenant
     and a.staff_id = p_staff
     and a.status in ('hold', 'pending_payment')
     and a.hold_expires_at < now();

  update public.appointments a
     set status = 'expired'
   where a.tenant_id = p_tenant
     and a.staff_id = p_staff
     and a.status in ('hold', 'pending_payment')
     and a.hold_expires_at < now();
end
$$;

create or replace function private.check_busy_matches_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_tenant uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_active boolean;
begin
  if new.appointment_id is not null then
    select a.tenant_id, a.staff_id, a.starts_at, a.ends_at, a.status
      into v_tenant, v_staff, v_start, v_end, v_status
      from public.appointments a
     where a.id = new.appointment_id;
    if not found then
      raise exception 'staff_busy orphan appointment' using errcode = '23503';
    end if;
    if v_tenant is distinct from new.tenant_id
       or v_staff is distinct from new.staff_id
       or new.period is distinct from tstzrange(v_start, v_end, '[)')
       or new.active is distinct from (v_status in ('hold', 'pending_payment', 'confirmed'))
    then
      raise exception 'staff_busy diverges from appointment' using errcode = '23514';
    end if;
  else
    select t.tenant_id, t.staff_id, t.starts_at, t.ends_at, t.active
      into v_tenant, v_staff, v_start, v_end, v_active
      from public.time_off t
     where t.id = new.time_off_id;
    if not found then
      raise exception 'staff_busy orphan time_off' using errcode = '23503';
    end if;
    if v_tenant is distinct from new.tenant_id
       or v_staff is distinct from new.staff_id
       or new.period is distinct from tstzrange(v_start, v_end, '[)')
       or new.active is distinct from v_active
    then
      raise exception 'staff_busy diverges from time_off' using errcode = '23514';
    end if;
  end if;
  return null;
end
$$;

create or replace function private.check_appointment_busy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.status in ('hold', 'pending_payment', 'confirmed') then
    select count(*) into v_count
      from public.staff_busy b
     where b.appointment_id = new.id
       and b.active
       and b.staff_id = new.staff_id
       and b.tenant_id = new.tenant_id
       and b.period = tstzrange(new.starts_at, new.ends_at, '[)');
    if v_count <> 1 then
      raise exception 'appointment missing coherent staff_busy' using errcode = '23514';
    end if;
  elsif exists (
    select 1 from public.staff_busy b
     where b.appointment_id = new.id and b.active
  ) then
    raise exception 'inactive appointment still holds staff_busy' using errcode = '23514';
  end if;
  return null;
end
$$;

create or replace function private.check_time_off_busy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.active then
    select count(*) into v_count
      from public.staff_busy b
     where b.time_off_id = new.id
       and b.active
       and b.staff_id = new.staff_id
       and b.tenant_id = new.tenant_id
       and b.period = tstzrange(new.starts_at, new.ends_at, '[)');
    if v_count <> 1 then
      raise exception 'time_off missing coherent staff_busy' using errcode = '23514';
    end if;
  elsif exists (
    select 1 from public.staff_busy b where b.time_off_id = new.id and b.active
  ) then
    raise exception 'inactive time_off still holds staff_busy' using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger staff_busy_matches_source
  after insert or update on public.staff_busy
  deferrable initially deferred
  for each row
  execute function private.check_busy_matches_source();

create constraint trigger appointment_has_busy
  after insert or update of starts_at, ends_at, status, staff_id on public.appointments
  deferrable initially deferred
  for each row
  execute function private.check_appointment_busy();

create constraint trigger time_off_has_busy
  after insert or update on public.time_off
  deferrable initially deferred
  for each row
  execute function private.check_time_off_busy();

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'tenant_id'
       and not a.attisdropped
  loop
    execute format(
      'create trigger %I before update of tenant_id on public.%I
         for each row execute function private.forbid_tenant_change()',
      r.relname || '_tenant_immutable',
      r.relname
    );
  end loop;
end
$$;

create or replace function private.open_admin_case(
  p_tenant uuid, p_kind text, p_ref uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.admin_cases (tenant_id, kind, ref_id, status)
  values (p_tenant, p_kind, p_ref, 'open')
  returning id into v_id;
  return v_id;
end
$$;

create or replace function private.assert_can_cancel(p_tenant uuid, p_appointment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.appointments a
      join public.customers c
        on c.tenant_id = a.tenant_id and c.id = a.customer_id
     where a.id = p_appointment
       and a.tenant_id = p_tenant
       and c.user_id = (select auth.uid())
  ) then
    return;
  end if;
  if private.has_role(p_tenant, array['owner', 'manager', 'staff']) then
    return;
  end if;
  raise exception 'not_allowed' using errcode = '42501';
end
$$;
