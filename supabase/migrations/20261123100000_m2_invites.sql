-- O preferido é corrigir para a frente. Reverter traz de volta o K15:
-- o invite_member antigo rebaixa uma membership active para invited,
-- inclusive a do owner. Os três passos, testados pelo DevOps, estão em
-- docs/decisoes-m2.md: reaplicar 20261120105000_public_api.sql:436-484;
-- dropar accept_invite, revoke_member, appoint_owner, guard_last_owner,
-- assert_aal2, lock_tenant_members e tenant_is_suspended; apagar a linha
-- 20261123100000 de supabase_migrations.schema_migrations.
-- Owner novo só entra por appoint_owner, e só se o chamador está em platform_admins.
-- P-M2-4, adotada por padrão pelo Orquestrador em 21/11: estas RPCs não
-- promovem, rebaixam nem removem owner. Danilo pode revisar.

create or replace function private.assert_aal2()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'aal', '') is distinct from 'aal2' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
end
$$;

create or replace function private.lock_tenant_members(p_tenant uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('members:' || p_tenant::text, 0));
$$;

create or replace function private.guard_last_owner(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owners integer;
begin
  perform 1
    from public.memberships
   where tenant_id = p_tenant
     and role = 'owner'
     and status = 'active'
   order by user_id
     for update;

  if not exists (
    select 1
      from public.memberships
     where tenant_id = p_tenant
       and user_id = p_user
       and role = 'owner'
       and status = 'active'
  ) then
    return;
  end if;

  select count(*)
    into v_owners
    from public.memberships
   where tenant_id = p_tenant
     and role = 'owner'
     and status = 'active';

  if v_owners <= 1 then
    raise exception 'last_owner' using errcode = '42501';
  end if;
end
$$;

create or replace function private.tenant_is_suspended(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tenants
     where id = p_tenant
       and status = 'suspended'
  );
$$;

revoke all on function private.assert_aal2()
  from public, anon, authenticated, service_role, backup_reader;
revoke all on function private.lock_tenant_members(uuid)
  from public, anon, authenticated, service_role, backup_reader;
revoke all on function private.guard_last_owner(uuid, uuid)
  from public, anon, authenticated, service_role, backup_reader;
revoke all on function private.tenant_is_suspended(uuid)
  from public, anon, authenticated, service_role, backup_reader;

create or replace function public_api.invite_member(
  p_tenant uuid, p_user uuid, p_role text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
  v_status text;
begin
  perform private.assert_aal2();
  if not private.has_role(p_tenant, array['owner']) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'staff') then
    raise exception 'invalid_role' using errcode = '42501';
  end if;
  if p_user is null or p_user = auth.uid() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if private.tenant_is_suspended(p_tenant) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.lock_tenant_members(p_tenant);

  select id, role, status
    into v_id, v_role, v_status
    from public.memberships
   where tenant_id = p_tenant
     and user_id = p_user
   for update;

  if found and v_status = 'active' then
    raise exception 'already_member' using errcode = '23505';
  end if;
  if found and v_role = 'owner' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if found then
    update public.memberships
       set role = p_role,
           status = 'invited'
     where id = v_id;
    return v_id;
  end if;

  begin
    insert into public.memberships (tenant_id, user_id, role, status)
    values (p_tenant, p_user, p_role, 'invited')
    returning id into v_id;
    return v_id;
  exception
    when unique_violation then
      select id, role, status
        into v_id, v_role, v_status
        from public.memberships
       where tenant_id = p_tenant
         and user_id = p_user
       for update;
      if v_status = 'active' then
        raise exception 'already_member' using errcode = '23505';
      end if;
      if v_role = 'owner' then
        raise exception 'not_allowed' using errcode = '42501';
      end if;
      update public.memberships
         set role = p_role,
             status = 'invited'
       where id = v_id;
      return v_id;
  end;
end
$$;

create or replace function public_api.change_member_role(
  p_tenant uuid, p_user uuid, p_role text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
  v_status text;
begin
  perform private.assert_aal2();
  if not private.has_role(p_tenant, array['owner']) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'staff') then
    raise exception 'invalid_role' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if private.tenant_is_suspended(p_tenant) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.lock_tenant_members(p_tenant);

  select id, role, status
    into v_id, v_role, v_status
    from public.memberships
   where tenant_id = p_tenant
     and user_id = p_user
   for update;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  if v_role = 'owner' and v_status = 'active' then
    perform private.guard_last_owner(p_tenant, p_user);
  end if;
  if p_user = auth.uid() or v_role = 'owner' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.memberships
     set role = p_role
   where id = v_id;
end
$$;

create or replace function public_api.accept_invite(p_tenant uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.lock_tenant_members(p_tenant);

  select id, status
    into v_id, v_status
    from public.memberships
   where tenant_id = p_tenant
     and user_id = auth.uid()
     and status = 'invited'
   for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  update public.memberships
     set status = 'active'
   where id = v_id;
  return v_id;
end
$$;

create or replace function public_api.revoke_member(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
  v_status text;
begin
  perform private.assert_aal2();
  if not private.has_role(p_tenant, array['owner']) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if private.tenant_is_suspended(p_tenant) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.lock_tenant_members(p_tenant);

  select id, role, status
    into v_id, v_role, v_status
    from public.memberships
   where tenant_id = p_tenant
     and user_id = p_user
   for update;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  if v_role = 'owner' and v_status = 'active' then
    perform private.guard_last_owner(p_tenant, p_user);
  end if;
  if p_user = auth.uid() or v_role = 'owner' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.memberships
     set status = 'revoked'
   where id = v_id;

  update public.staff
     set active = false
   where tenant_id = p_tenant
     and user_id = p_user
     and active;
end
$$;

create or replace function public_api.appoint_owner(p_tenant uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
  v_status text;
begin
  perform private.assert_aal2();
  if auth.uid() is null or not exists (
    select 1
      from public.platform_admins
     where user_id = auth.uid()
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform private.lock_tenant_members(p_tenant);

  select id, role, status
    into v_id, v_role, v_status
    from public.memberships
   where tenant_id = p_tenant
     and user_id = p_user
   for update;

  if not found then
    insert into public.memberships (tenant_id, user_id, role, status)
    values (p_tenant, p_user, 'owner', 'invited')
    returning id into v_id;
    return v_id;
  end if;

  if v_status = 'active' and v_role = 'owner' then
    return v_id;
  end if;

  if v_status = 'active' then
    update public.memberships
       set role = 'owner'
     where id = v_id;
    return v_id;
  end if;

  update public.memberships
     set role = 'owner',
         status = 'invited'
   where id = v_id;
  return v_id;
end
$$;

revoke all on function public_api.invite_member(uuid, uuid, text)
  from public, anon, service_role, backup_reader;
revoke all on function public_api.change_member_role(uuid, uuid, text)
  from public, anon, service_role, backup_reader;
revoke all on function public_api.accept_invite(uuid)
  from public, anon, authenticated, service_role, backup_reader;
revoke all on function public_api.revoke_member(uuid, uuid)
  from public, anon, authenticated, service_role, backup_reader;
revoke all on function public_api.appoint_owner(uuid, uuid)
  from public, anon, authenticated, service_role, backup_reader;

grant execute on function public_api.invite_member(uuid, uuid, text) to authenticated;
grant execute on function public_api.change_member_role(uuid, uuid, text) to authenticated;
grant execute on function public_api.accept_invite(uuid) to authenticated;
grant execute on function public_api.revoke_member(uuid, uuid) to authenticated;
grant execute on function public_api.appoint_owner(uuid, uuid) to authenticated;
