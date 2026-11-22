-- Profissionais e acessos são coisas diferentes, e a tela só mostrava uma delas.
--
-- A barbearia tem Bruno e Rafael atendendo (public.staff), e tem quatro logins
-- (memberships). A tela "Equipe" listava os logins — então o dono não encontrava quem
-- trabalha ali, e não havia como dar acesso a um profissional: staff.user_id ficava nulo
-- para sempre.
--
-- Aqui nasce o elo explícito e a lista de profissionais com o estado de acesso de cada um.

create or replace function server_api.panel_staff(p_tenant uuid, p_actor uuid)
returns table (
  staff_id uuid,
  display_name text,
  active boolean,
  commission_bps integer,
  access_user_id uuid,
  access_email text,
  access_role text
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
           m.role::text
      from public.staff st
      left join auth.users u on u.id = st.user_id
      left join public.memberships m
        on m.user_id = st.user_id and m.tenant_id = st.tenant_id and m.status = 'active'
     where st.tenant_id = p_tenant
     order by st.active desc, st.display_name;
end
$$;

-- Liga o profissional ao login. Só liga se o usuário já tem (ou vai ter) vínculo com esta
-- barbearia; ligar a um estranho daria a ele agenda e comissão de outra casa.
create or replace function server_api.link_staff_user(p_tenant uuid, p_actor uuid, p_staff uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if not exists (select 1 from public.staff st where st.id = p_staff and st.tenant_id = p_tenant) then
    raise exception 'profissional_nao_encontrado' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user) then
    raise exception 'usuario_sem_vinculo' using errcode = '42501';
  end if;
  -- Um login por profissional e um profissional por login nesta barbearia.
  if exists (select 1 from public.staff st
              where st.tenant_id = p_tenant and st.user_id = p_user and st.id <> p_staff) then
    raise exception 'usuario_ja_ligado' using errcode = '23505';
  end if;

  update public.staff st set user_id = p_user where st.id = p_staff and st.tenant_id = p_tenant;
  return true;
end
$$;

-- Desativar profissional: some da agenda e do /agendar, mantém histórico e comissão.
create or replace function server_api.set_staff_active(p_tenant uuid, p_actor uuid, p_staff uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  update public.staff st set active = p_active
   where st.id = p_staff and st.tenant_id = p_tenant;
  if not found then
    raise exception 'profissional_nao_encontrado' using errcode = 'P0002';
  end if;
  return p_active;
end
$$;

-- Criar profissional pela tela (antes só existia por script de semeadura).
create or replace function server_api.add_staff(p_tenant uuid, p_actor uuid, p_name text, p_commission_bps integer default 0)
returns uuid
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

  -- Novo profissional herda o horário da casa (work_schedules), senão não teria agenda.
  insert into public.work_schedules (tenant_id, staff_id, weekday, start_time, end_time)
  select p_tenant, v_id, w.weekday, w.start_time, w.end_time
    from public.work_schedules w
   where w.tenant_id = p_tenant
     and w.staff_id = (select st.id from public.staff st
                        where st.tenant_id = p_tenant and st.id <> v_id
                        order by st.display_name limit 1);

  return v_id;
end
$$;

revoke all on function server_api.panel_staff(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.link_staff_user(uuid, uuid, uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.set_staff_active(uuid, uuid, uuid, boolean) from public, anon, authenticated, backup_reader;
revoke all on function server_api.add_staff(uuid, uuid, text, integer) from public, anon, authenticated, backup_reader;

grant execute on function server_api.panel_staff(uuid, uuid) to service_role;
grant execute on function server_api.link_staff_user(uuid, uuid, uuid, uuid) to service_role;
grant execute on function server_api.set_staff_active(uuid, uuid, uuid, boolean) to service_role;
grant execute on function server_api.add_staff(uuid, uuid, text, integer) to service_role;
