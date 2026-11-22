-- Convite de equipe: o dono cria o acesso do barbeiro pela tela, sem passar pelo
-- suporte e sem senha trafegando em conversa.
--
-- Fluxo: o dono informa e-mail e papel -> o servidor cria o usuário já confirmado com
-- uma senha aleatória que ninguém usa -> grava membership status='invited' -> gera um
-- código de convite (hash, uso único, 7 dias) -> devolve o link para o dono mandar no
-- WhatsApp. Quem abre o link define a própria senha e a membership vira 'active'.
--
-- O código nunca é gravado em claro, só o digest — mesma escolha de login_handoffs.

create table if not exists private.invite_codes (
  code_hash bytea primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table private.invite_codes enable row level security;
revoke all on private.invite_codes from public, anon, authenticated, service_role;

-- Papel de quem age, exigindo que seja dono ou gerente daquela barbearia.
create or replace function private.assert_can_manage(p_tenant uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select m.role into v_role
    from public.memberships m
   where m.tenant_id = p_tenant
     and m.user_id = p_actor
     and m.status = 'active';
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
end
$$;

create or replace function server_api.create_invite(
  p_actor uuid,
  p_tenant uuid,
  p_user uuid,
  p_role text,
  p_code text,
  p_days integer default 7
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expira timestamptz;
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if p_role not in ('owner', 'manager', 'staff') then
    raise exception 'papel_invalido' using errcode = '22023';
  end if;
  -- Só dono cria outro dono: gerente não se promove nem promove cúmplice.
  if p_role = 'owner' and not exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = p_actor
       and m.status = 'active' and m.role = 'owner'
  ) then
    raise exception 'só_dono_cria_dono' using errcode = '42501';
  end if;
  if p_code is null or length(p_code) < 20 then
    raise exception 'codigo_fraco' using errcode = '22023';
  end if;

  v_expira := now() + make_interval(days => greatest(1, least(30, coalesce(p_days, 7))));

  insert into private.invite_codes (code_hash, tenant_id, user_id, role, created_by, expires_at)
  values (extensions.digest(p_code, 'sha256'), p_tenant, p_user, p_role, p_actor, v_expira)
  on conflict (code_hash) do nothing;

  insert into public.memberships (tenant_id, user_id, role, status)
  values (p_tenant, p_user, p_role, 'invited')
  on conflict (tenant_id, user_id) do update
     set role = excluded.role,
         status = case when public.memberships.status = 'active' then 'active' else 'invited' end;

  return v_expira;
end
$$;

-- Consome o convite e já devolve quem é. Uso único: used_at preenche na mesma linha.
create or replace function server_api.consume_invite(p_slug text, p_code text)
returns table (user_id uuid, tenant_id uuid, role text)
language sql
security definer
set search_path = ''
as $$
  update private.invite_codes c
     set used_at = now()
    from public.tenants t
   where c.code_hash = extensions.digest(p_code, 'sha256')
     and c.used_at is null
     and c.expires_at > now()
     and t.id = c.tenant_id
     and t.slug = p_slug
  returning c.user_id, c.tenant_id, c.role;
$$;

create or replace function server_api.activate_member(p_tenant uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.memberships m
     set status = 'active'
   where m.tenant_id = p_tenant
     and m.user_id = p_user
  returning m.status into v_status;
  return coalesce(v_status, 'nenhuma');
end
$$;

create or replace function server_api.list_members(p_tenant uuid, p_actor uuid)
returns table (user_id uuid, email text, full_name text, role text, status text, desde timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  return query
    select m.user_id, u.email::text, (u.raw_user_meta_data ->> 'full_name')::text,
           m.role, m.status, m.created_at
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where m.tenant_id = p_tenant
     order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end, u.email;
end
$$;

-- Revogar mantém o histórico da linha (status='revoked'), não apaga.
create or replace function server_api.revoke_member(p_tenant uuid, p_actor uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  select m.role into v_role from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_user;
  if v_role is null then
    raise exception 'membro_nao_encontrado' using errcode = 'P0002';
  end if;
  if v_role = 'owner' and (select count(*) from public.memberships m
                            where m.tenant_id = p_tenant and m.role = 'owner' and m.status = 'active') <= 1 then
    raise exception 'ultimo_dono' using errcode = '22023';
  end if;
  update public.memberships m set status = 'revoked'
   where m.tenant_id = p_tenant and m.user_id = p_user;
  return 'revoked';
end
$$;

revoke all on function server_api.create_invite(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated, backup_reader;
revoke all on function server_api.consume_invite(text, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.activate_member(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.list_members(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.revoke_member(uuid, uuid, uuid) from public, anon, authenticated, backup_reader;

grant execute on function server_api.create_invite(uuid, uuid, uuid, text, text, integer) to service_role;
grant execute on function server_api.consume_invite(text, text) to service_role;
grant execute on function server_api.activate_member(uuid, uuid) to service_role;
grant execute on function server_api.list_members(uuid, uuid) to service_role;
grant execute on function server_api.revoke_member(uuid, uuid, uuid) to service_role;

-- Meta de faturamento: definida pelo dono, por barbearia, por dia da semana é opcional;
-- aqui é a meta diária única, que é o que ele acompanha.
alter table public.tenant_settings
  add column if not exists daily_revenue_goal_cents bigint not null default 0
    check (daily_revenue_goal_cents >= 0);

create or replace function server_api.set_daily_goal(p_tenant uuid, p_actor uuid, p_cents bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if p_cents is null or p_cents < 0 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;
  update public.tenant_settings ts
     set daily_revenue_goal_cents = p_cents
   where ts.tenant_id = p_tenant;
  return p_cents;
end
$$;

revoke all on function server_api.set_daily_goal(uuid, uuid, bigint) from public, anon, authenticated, backup_reader;
grant execute on function server_api.set_daily_goal(uuid, uuid, bigint) to service_role;
