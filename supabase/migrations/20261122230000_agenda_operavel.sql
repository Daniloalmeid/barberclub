-- Agenda operável: o que o barbeiro faz em pé, no balcão.
--
-- Até agora só entrava agendamento pela página pública, e o cliente precisava se
-- cadastrar. Cliente que liga ou aparece na porta não tinha como ser marcado. Também
-- não havia como bloquear almoço, médico ou folga — e a agenda ficava oferecendo
-- horário que a barbearia não tem.
--
-- Tudo aqui exige membership ativa (private.assert_can_manage ou checagem de papel) e
-- reusa as funções privadas do motor de slot, para não duplicar regra.

-- Agenda por período, opcionalmente de um profissional só.
drop function if exists server_api.panel_agenda(uuid, timestamptz, timestamptz);
create or replace function server_api.panel_agenda(
  p_tenant uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff uuid default null
) returns table (
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  customer_name text,
  customer_phone text,
  service_name text,
  staff_name text,
  staff_id uuid,
  price_cents bigint,
  pago_cents bigint,
  metodo text
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.starts_at, a.ends_at, a.status, c.full_name, c.phone, s.name, st.display_name, a.staff_id,
         s.price_cents, coalesce(pg.amount_cents, 0)::bigint, pg.method
    from public.appointments a
    left join public.customers c on c.id = a.customer_id
    left join public.services s on s.id = a.service_id
    left join public.staff st on st.id = a.staff_id
    left join lateral (
      select p.amount_cents, p.method
        from public.payments p
       where p.appointment_id = a.id and p.status = 'paid'
       order by p.paid_at desc nulls last
       limit 1
    ) pg on true
   where a.tenant_id = p_tenant
     and a.starts_at >= p_from
     and a.starts_at < p_to
     and (p_staff is null or a.staff_id = p_staff)
   order by a.starts_at;
$$;

-- Agenda criada pela equipe (walk-in ou telefone). Nasce confirmada: quem marcou foi a
-- própria barbearia com o cliente na frente, não há o que esperar.
create or replace function server_api.book_for_customer(
  p_actor uuid,
  p_tenant uuid,
  p_staff uuid,
  p_service uuid,
  p_starts_at timestamptz,
  p_customer uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text;
  v_staff_user uuid;
  v_ends timestamptz;
  v_appt uuid;
begin
  select m.role into v_papel
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active';
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_papel = 'staff' then
    select st.user_id into v_staff_user from public.staff st where st.id = p_staff;
    if v_staff_user is distinct from p_actor then
      raise exception 'sem_permissao' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = p_tenant) then
    raise exception 'cliente_de_outra_barbearia' using errcode = '42501';
  end if;

  perform private.assert_tenant_bookable(p_tenant);
  perform private.assert_staff_service_active(p_tenant, p_staff, p_service);
  perform private.lock_staff(p_tenant, p_staff);
  perform private.expire_holds_for_staff(p_tenant, p_staff);

  v_ends := private.validate_slot(p_tenant, p_staff, p_service, p_starts_at);

  begin
    insert into public.appointments (tenant_id, staff_id, customer_id, service_id, starts_at, ends_at,
                                     status, idempotency_key, request_hash)
    values (p_tenant, p_staff, p_customer, p_service, p_starts_at, v_ends, 'confirmed',
            'balcao:' || gen_random_uuid()::text,
            decode(md5(concat_ws('|', p_tenant::text, p_staff::text, p_service::text, p_starts_at::text)), 'hex'))
    returning id into v_appt;

    insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
    values (p_tenant, p_staff, tstzrange(p_starts_at, v_ends, '[)'), v_appt);
  exception
    when exclusion_violation then
      raise exception 'horario_ocupado' using errcode = '23P01';
  end;

  return v_appt;
end
$$;

-- Reagendar: mesmo cuidado do booking — trava o profissional e valida o novo slot.
create or replace function server_api.reschedule_appointment(
  p_actor uuid,
  p_appointment uuid,
  p_starts_at timestamptz
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_staff uuid;
  v_service uuid;
  v_status text;
  v_papel text;
  v_staff_user uuid;
  v_ends timestamptz;
begin
  select a.tenant_id, a.staff_id, a.service_id, a.status
    into v_tenant, v_staff, v_service, v_status
    from public.appointments a where a.id = p_appointment;
  if v_tenant is null then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;

  select m.role into v_papel
    from public.memberships m
   where m.tenant_id = v_tenant and m.user_id = p_actor and m.status = 'active';
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_papel = 'staff' then
    select st.user_id into v_staff_user from public.staff st where st.id = v_staff;
    if v_staff_user is distinct from p_actor then
      raise exception 'sem_permissao' using errcode = '42501';
    end if;
  end if;

  if v_status not in ('hold', 'pending_payment', 'confirmed') then
    raise exception 'nao_reagendavel: %', v_status using errcode = '22023';
  end if;

  perform private.lock_staff(v_tenant, v_staff);
  v_ends := private.validate_slot(v_tenant, v_staff, v_service, p_starts_at);

  begin
    update public.appointments a
       set starts_at = p_starts_at, ends_at = v_ends
     where a.id = p_appointment;

    update public.staff_busy b
       set period = tstzrange(p_starts_at, v_ends, '[)')
     where b.appointment_id = p_appointment and b.active;
  exception
    when exclusion_violation then
      raise exception 'horario_ocupado' using errcode = '23P01';
  end;

  return p_starts_at;
end
$$;

-- Bloquear horário: almoço, médico, folga, feriado. O list_free_slots já desconsidera
-- time_off, então o site para de oferecer o horário na hora.
create or replace function server_api.block_time(
  p_actor uuid,
  p_tenant uuid,
  p_staff uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text;
  v_staff_user uuid;
  v_id uuid;
  v_conflito text;
begin
  select m.role into v_papel
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active';
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_papel = 'staff' then
    select st.user_id into v_staff_user from public.staff st where st.id = p_staff;
    if v_staff_user is distinct from p_actor then
      raise exception 'sem_permissao' using errcode = '42501';
    end if;
  end if;

  if p_to <= p_from then
    raise exception 'periodo_invalido' using errcode = '22023';
  end if;

  -- Não bloqueia por cima de cliente marcado: quem já tem horário precisa ser avisado
  -- antes, e o sistema não manda mensagem sozinho.
  select c.full_name into v_conflito
    from public.appointments a
    left join public.customers c on c.id = a.customer_id
   where a.tenant_id = p_tenant
     and a.staff_id = p_staff
     and a.status in ('hold', 'pending_payment', 'confirmed')
     and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
   limit 1;
  if v_conflito is not null then
    raise exception 'tem_agendamento: %', coalesce(v_conflito, 'cliente') using errcode = '23P01';
  end if;

  insert into public.time_off (tenant_id, staff_id, starts_at, ends_at, active, reason)
  values (p_tenant, p_staff, p_from, p_to, true, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;

  -- O motor exige que bloqueio ocupe a agenda do profissional; o trigger que cobra isso
  -- é deferido, então a linha entra depois do time_off existir.
  insert into public.staff_busy (tenant_id, staff_id, period, time_off_id, active)
  values (p_tenant, p_staff, tstzrange(p_from, p_to, '[)'), v_id, true);

  return v_id;
end
$$;

create or replace function server_api.unblock_time(p_actor uuid, p_tenant uuid, p_block uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  update public.time_off t set active = false
   where t.id = p_block and t.tenant_id = p_tenant;
  if not found then
    raise exception 'bloqueio_nao_encontrado' using errcode = 'P0002';
  end if;
  update public.staff_busy b set active = false
   where b.time_off_id = p_block and b.active;
  return true;
end
$$;

create or replace function server_api.panel_blocks(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (block_id uuid, staff_id uuid, starts_at timestamptz, ends_at timestamptz, reason text)
language sql
security definer
set search_path = ''
as $$
  select t.id, t.staff_id, t.starts_at, t.ends_at, t.reason
    from public.time_off t
   where t.tenant_id = p_tenant
     and t.active
     and t.starts_at < p_to and t.ends_at > p_from
   order by t.starts_at;
$$;

revoke all on function server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.book_for_customer(uuid, uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.reschedule_appointment(uuid, uuid, timestamptz) from public, anon, authenticated, backup_reader;
revoke all on function server_api.block_time(uuid, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.unblock_time(uuid, uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_blocks(uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;

grant execute on function server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid) to service_role;
grant execute on function server_api.book_for_customer(uuid, uuid, uuid, uuid, timestamptz, uuid) to service_role;
grant execute on function server_api.reschedule_appointment(uuid, uuid, timestamptz) to service_role;
grant execute on function server_api.block_time(uuid, uuid, uuid, timestamptz, timestamptz, text) to service_role;
grant execute on function server_api.unblock_time(uuid, uuid, uuid) to service_role;
grant execute on function server_api.panel_blocks(uuid, timestamptz, timestamptz) to service_role;
