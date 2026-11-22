-- Qual profissional faz qual serviço.
--
-- Criar profissional hoje vincula todos os serviços ativos (a correção do "Daniel não
-- aparece"). Isso é o padrão certo para começar, mas errado como regra fixa: numa
-- barbearia o Bruno faz progressiva, o Rafael não.
--
-- Aqui: escolher na criação (lista de serviços) e editar depois. Serviço sem profissional
-- some do agendamento — então a tela avisa quando não sobra nenhum.

drop function if exists server_api.panel_staff(uuid, uuid);

create or replace function server_api.panel_staff(p_tenant uuid, p_actor uuid)
returns table (
  staff_id uuid,
  display_name text,
  active boolean,
  commission_bps integer,
  access_user_id uuid,
  access_email text,
  access_role text,
  service_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  return query
    select st.id, st.display_name, st.active, coalesce(st.commission_bps, 0),
           st.user_id,
           u.email::text,
           m.role::text,
           coalesce(
             (select array_agg(ss.service_id order by sv.display_order nulls last, sv.name)
                from public.staff_services ss
                join public.services sv on sv.id = ss.service_id
               where ss.staff_id = st.id and ss.active and sv.active),
             '{}'::uuid[]
           )
      from public.staff st
      left join auth.users u on u.id = st.user_id
      left join public.memberships m
        on m.user_id = st.user_id and m.tenant_id = st.tenant_id and m.status = 'active'
     where st.tenant_id = p_tenant
     order by st.active desc, st.display_name;
end
$$;

-- Troca o conjunto de serviços do profissional.
create or replace function server_api.set_staff_services(
  p_tenant uuid,
  p_actor uuid,
  p_staff uuid,
  p_services uuid[]
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if not exists (select 1 from public.staff st where st.id = p_staff and st.tenant_id = p_tenant) then
    raise exception 'profissional_nao_encontrado' using errcode = 'P0002';
  end if;

  -- Serviço de outra barbearia não entra: agenda cruzada é vazamento de dado.
  if exists (
    select 1 from unnest(coalesce(p_services, '{}'::uuid[])) as s(id)
     where not exists (
       select 1 from public.services sv where sv.id = s.id and sv.tenant_id = p_tenant
     )
  ) then
    raise exception 'servico_de_outra_barbearia' using errcode = '42501';
  end if;

  -- Não apaga: appointments referencia staff_services por FK, e apagar perderia o
  -- vínculo do histórico. Desativa o que saiu, reativa o que entrou.
  update public.staff_services ss
     set active = false
   where ss.staff_id = p_staff
     and ss.tenant_id = p_tenant
     and ss.service_id <> all (coalesce(p_services, '{}'::uuid[]));

  insert into public.staff_services (tenant_id, staff_id, service_id, active)
  select p_tenant, p_staff, s.id, true
    from unnest(coalesce(p_services, '{}'::uuid[])) as s(id)
  on conflict (tenant_id, staff_id, service_id) do update set active = true;

  select count(*) into v_total
    from public.staff_services ss where ss.staff_id = p_staff and ss.active;
  return v_total;
end
$$;

-- Serviço criado depois entra na equipe ativa.
create or replace function server_api.upsert_service(
  p_tenant uuid,
  p_actor uuid,
  p_service uuid,
  p_name text,
  p_description text,
  p_duration_min integer,
  p_price_cents bigint,
  p_display_order integer default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if length(v_nome) < 2 or length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'duracao_invalida' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 5000000 then
    raise exception 'preco_invalido' using errcode = '22023';
  end if;

  if p_service is null then
    insert into public.services (tenant_id, name, description, duration_min, price_cents, display_order, active)
    values (p_tenant, v_nome, nullif(btrim(coalesce(p_description, '')), ''), p_duration_min, p_price_cents,
            coalesce(p_display_order, (select coalesce(max(s.display_order), 0) + 1 from public.services s where s.tenant_id = p_tenant)), true)
    returning id into v_id;

    -- Serviço novo sem profissional é serviço que ninguém consegue agendar.
    insert into public.staff_services (tenant_id, staff_id, service_id, active)
    select p_tenant, st.id, v_id, true
      from public.staff st
     where st.tenant_id = p_tenant and st.active
    on conflict (tenant_id, staff_id, service_id) do update set active = true;

  else
    update public.services s
       set name = v_nome,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           duration_min = p_duration_min,
           price_cents = p_price_cents,
           display_order = coalesce(p_display_order, s.display_order)
     where s.id = p_service and s.tenant_id = p_tenant
     returning s.id into v_id;
    if v_id is null then
      raise exception 'servico_nao_encontrado' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end
$$;

-- Criar profissional já com os serviços escolhidos. Sem lista, herda todos os ativos.
create or replace function server_api.add_staff(
  p_tenant uuid,
  p_actor uuid,
  p_name text,
  p_commission_bps integer default 0,
  p_services uuid[] default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if length(v_nome) < 2 or length(v_nome) > 60 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if coalesce(p_commission_bps, 0) < 0 or coalesce(p_commission_bps, 0) > 10000 then
    raise exception 'percentual_invalido' using errcode = '22023';
  end if;

  insert into public.staff (tenant_id, display_name, active, commission_bps)
  values (p_tenant, v_nome, true, coalesce(p_commission_bps, 0))
  returning id into v_id;

  insert into public.work_schedules (tenant_id, staff_id, weekday, start_time, end_time)
  select p_tenant, v_id, w.weekday, w.start_time, w.end_time
    from public.work_schedules w
   where w.tenant_id = p_tenant
     and w.staff_id = (select st.id from public.staff st
                        where st.tenant_id = p_tenant and st.id <> v_id
                        order by st.display_name limit 1);

  if p_services is null then
    insert into public.staff_services (tenant_id, staff_id, service_id, active)
    select p_tenant, v_id, s.id, true
      from public.services s
     where s.tenant_id = p_tenant and s.active
    on conflict do nothing;
  else
    perform server_api.set_staff_services(p_tenant, p_actor, v_id, p_services);
  end if;

  return v_id;
end
$$;

revoke all on function server_api.panel_staff(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.set_staff_services(uuid, uuid, uuid, uuid[]) from public, anon, authenticated, backup_reader;
revoke all on function server_api.add_staff(uuid, uuid, text, integer, uuid[]) from public, anon, authenticated, backup_reader;

grant execute on function server_api.panel_staff(uuid, uuid) to service_role;
grant execute on function server_api.set_staff_services(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function server_api.add_staff(uuid, uuid, text, integer, uuid[]) to service_role;

-- Backfill: quem nunca foi decidido ganha o serviço (caso do serviço criado antes desta
-- regra, como a Hidratação). Quem foi desativado de propósito tem linha com active=false
-- e não é tocado.
insert into public.staff_services (tenant_id, staff_id, service_id, active)
select st.tenant_id, st.id, sv.id, true
  from public.staff st
  join public.services sv on sv.tenant_id = st.tenant_id and sv.active
 where st.active
   and not exists (
     select 1 from public.staff_services ss
      where ss.tenant_id = st.tenant_id and ss.staff_id = st.id and ss.service_id = sv.id
   )
on conflict do nothing;

revoke all on function server_api.upsert_service(uuid, uuid, uuid, text, text, integer, bigint, integer) from public, anon, authenticated, backup_reader;
grant execute on function server_api.upsert_service(uuid, uuid, uuid, text, text, integer, bigint, integer) to service_role;
