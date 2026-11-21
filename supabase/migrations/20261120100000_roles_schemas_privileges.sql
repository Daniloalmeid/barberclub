-- Reversão: drop schema public_api, server_api, private, ledger cascade;
-- drop role backup_reader; drop role ledger_owner;
-- repor default privileges e TEMP em public, se o ambiente ainda for local.
-- Não reverte papéis gerenciados do Supabase (anon, authenticated, service_role).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ledger_owner') then
    create role ledger_owner
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'backup_reader') then
    create role backup_reader
      login
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$$;

-- Sem senha nesta migration: segredo não entra no repositório.
-- NOSUPERUSER/BYPASSRLS exigem superusuário. A migration do CLI local não é
-- superusuário; BYPASSRLS é tentado abaixo via supabase_admin quando existir.
alter role ledger_owner with nologin nocreatedb nocreaterole noreplication;
alter role backup_reader with login nocreatedb nocreaterole noreplication;

-- O papel da migration não é superusuário. A filiação permite criar objetos
-- cujo dono é ledger_owner (CREATE SCHEMA AUTHORIZATION e ALTER OWNER).
-- SET TRUE é explícito: no Postgres 17 o ADMIN OPTION sozinho não autoriza SET ROLE.
grant ledger_owner to current_user with set true, inherit true;
grant backup_reader to current_user with set true, inherit false;

do $$
begin
  begin
    execute 'alter role backup_reader bypassrls';
  exception
    when insufficient_privilege then
      begin
        execute 'set local role supabase_admin';
        execute 'alter role backup_reader bypassrls';
      exception
        when others then
          raise notice 'backup_reader sem BYPASSRLS: %', sqlerrm;
      end;
  end;
end
$$;

create schema if not exists public_api;
create schema if not exists server_api;
create schema if not exists private;
create schema if not exists ledger authorization ledger_owner;

revoke all on schema public from public;
revoke all on schema public_api, server_api, private, ledger from public;

grant usage on schema public to anon, authenticated, service_role, backup_reader, ledger_owner;
grant usage on schema public_api to anon, authenticated, backup_reader;
grant usage on schema server_api to service_role, backup_reader;
grant usage on schema private to authenticated, backup_reader;
grant usage on schema ledger to ledger_owner, backup_reader;
grant usage on schema extensions to postgres, ledger_owner;

revoke create on schema public, public_api, server_api, private, ledger from public;
revoke create on schema public, public_api, server_api, private, ledger from anon, authenticated, service_role, backup_reader;

-- Nada nasce acessível. Papéis criadores: postgres (migrations) e ledger_owner (ledger).
alter default privileges for role postgres in schema public, public_api, server_api, private, ledger
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public, public_api, server_api, private, ledger
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role, backup_reader;
alter default privileges for role postgres in schema public, public_api, server_api, private, ledger
  revoke execute on functions from public, anon, authenticated, service_role, backup_reader;

alter default privileges for role ledger_owner
  revoke execute on functions from public, anon, authenticated, service_role, backup_reader;
alter default privileges for role ledger_owner in schema ledger
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role ledger_owner in schema ledger
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role ledger_owner in schema ledger
  revoke execute on functions from public, anon, authenticated, service_role, backup_reader;

-- D37: objetos novos dos dois criadores já nascem legíveis pelo backup.
alter default privileges for role postgres in schema public, public_api, server_api, private, ledger
  grant select on tables to backup_reader;
alter default privileges for role postgres in schema public, public_api, server_api, private, ledger
  grant select on sequences to backup_reader;
alter default privileges for role ledger_owner in schema ledger
  grant select on tables to backup_reader;
alter default privileges for role ledger_owner in schema ledger
  grant select on sequences to backup_reader;

-- TEMP é privilégio de banco concedido a PUBLIC. Revoga de PUBLIC e devolve
-- a todos os papéis atuais, exceto backup_reader.
revoke temporary on database postgres from public;
revoke temporary on database postgres from backup_reader;
do $$
declare
  r text;
begin
  for r in select rolname from pg_roles where rolname <> 'backup_reader'
  loop
    execute format('grant temporary on database postgres to %I', r);
  end loop;
end
$$;

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
