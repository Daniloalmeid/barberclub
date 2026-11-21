begin;
select * from plan(67);

create or replace function pg_temp.err(sql text, code text, descr text) returns text
language plpgsql as $$
begin
  return extensions.throws_ok(sql, code::char(5), null::text, descr);
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444441', 'authenticated', 'authenticated', 'm4-owner@example.test', extensions.crypt('password', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444442', 'authenticated', 'authenticated', 'm4-staff@example.test', extensions.crypt('password', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444443', 'authenticated', 'authenticated', 'm4-other@example.test', extensions.crypt('password', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

insert into public.profiles (id, full_name) values
  ('44444444-4444-4444-8444-444444444441', 'owner'),
  ('44444444-4444-4444-8444-444444444442', 'staff'),
  ('44444444-4444-4444-8444-444444444443', 'other');

insert into public.tenants (id, slug, display_name, status) values
  ('55555555-5555-4555-8555-555555555551', 'ativo', 'Ativo', 'active'),
  ('55555555-5555-4555-8555-555555555552', 'trial1', 'Trial', 'trial'),
  ('55555555-5555-4555-8555-555555555553', 'suspenso', 'Suspenso', 'suspended'),
  ('55555555-5555-4555-8555-555555555554', 'devedor', 'Devedor', 'past_due'),
  ('55555555-5555-4555-8555-555555555555', 'outro', 'Outro', 'active');

insert into public.memberships (tenant_id, user_id, role, status) values
  ('55555555-5555-4555-8555-555555555551', '44444444-4444-4444-8444-444444444441', 'owner', 'active'),
  ('55555555-5555-4555-8555-555555555551', '44444444-4444-4444-8444-444444444442', 'staff', 'active'),
  ('55555555-5555-4555-8555-555555555553', '44444444-4444-4444-8444-444444444441', 'owner', 'active'),
  ('55555555-5555-4555-8555-555555555554', '44444444-4444-4444-8444-444444444441', 'owner', 'active'),
  ('55555555-5555-4555-8555-555555555553', '44444444-4444-4444-8444-444444444442', 'staff', 'active');

select pg_temp.err($$insert into public.tenants (slug, display_name, status) values ('a', 'x', 'trial')$$, '23514', 'slug de 1 caractere');
select pg_temp.err($$insert into public.tenants (slug, display_name, status) values ('ab', 'x', 'trial')$$, '23514', 'slug de 2 caracteres');
select pg_temp.err($$insert into public.tenants (slug, display_name, status) values ('api', 'x', 'trial')$$, '23514', 'slug reservado api');
select pg_temp.err($$insert into public.tenants (slug, display_name, status) values ('cdn-01', 'x', 'trial')$$, '23514', 'prefixo reservado');
select lives_ok($$insert into public.tenants (slug, display_name, status) values ('abc', 'Curto ok', 'trial')$$, 'slug de 3');
select lives_ok($$insert into public.tenants (slug, display_name, status) values ('abcdefghijklmnopqrstuvwxyz012345', 'Longo ok', 'trial')$$, 'slug de 32');
select pg_temp.err($$update public.tenants set slug = 'admin' where slug = 'abc'$$, '23514', 'update para reservado');

select lives_ok($$select server_api.rename_tenant_slug((select id from public.tenants where slug = 'abc'), 'abd')$$, 'superadmin troca o slug');
select ok(exists (select 1 from public.tenant_slug_history where slug = 'abc'), 'historico guarda o slug antigo');
select pg_temp.err($$update public.tenants set slug = 'abc' where slug = 'outro'$$, '23514', 'outro tenant nao reusa slug antigo');
select lives_ok($$select server_api.rename_tenant_slug((select id from public.tenants where slug = 'abd'), 'abc')$$, 'o proprio tenant volta ao slug');

select pg_temp.err(
  $$insert into public.reserved_slugs (slug) values ('outro')$$,
  '23514',
  'reservar slug em uso'
);

select pg_temp.err($$do $b$ begin set local role anon; perform 1 from public.reserved_slugs; end $b$ $$, '42501', 'anon nao le reserved_slugs');
select pg_temp.err($$do $b$ begin set local role anon; perform 1 from public.tenant_slug_history; end $b$ $$, '42501', 'anon nao le historico');
select pg_temp.err($$do $b$ begin set local role anon; perform 1 from private.login_handoffs; end $b$ $$, '42501', 'anon nao le handoff');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.my_login_tenants(); end $b$ $$, '42501', 'anon nao executa my_login_tenants');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.my_regularization_tenants(); end $b$ $$, '42501', 'anon nao executa regularizacao');
select pg_temp.err($$do $b$ begin set local role anon; perform private.owner_regularization_rows(); end $b$ $$, '42501', 'anon nao executa private');
select pg_temp.err($$do $b$ begin set local role authenticated; perform private.owner_regularization_rows(); end $b$ $$, '42501', 'authenticated nao executa private');
select pg_temp.err($$do $b$ begin set local role authenticated; perform server_api.create_login_handoff('44444444-4444-4444-8444-444444444441', 'ativo', '/', 'abc', '\x00'::bytea); end $b$ $$, '42501', 'authenticated nao cria handoff');
select pg_temp.err($$do $b$ begin set local role authenticated; update public.tenants set slug = 'zzzz' where slug = 'ativo'; end $b$ $$, '42501', 'owner nao atualiza slug');
select pg_temp.err($$do $b$ begin set local role service_role; perform public_api.my_regularization_tenants(); end $b$ $$, '42501', 'service_role nao executa regularizacao');

select is_empty($$select 1 from public_api.get_tenant_public('suspenso')$$, 'publico ignora suspenso');
select is_empty($$select 1 from public_api.get_tenant_public('naoexiste')$$, 'publico ignora inexistente');

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444442', true);
set local role authenticated;
select is((select count(*) from public_api.my_login_tenants()), 1::bigint, 'staff ve o tenant ativo');
select is((select count(*) from public_api.my_regularization_tenants()), 0::bigint, 'staff nao regulariza');
reset role;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444441', true);
set local role authenticated;
select is((select count(*) from public_api.my_regularization_tenants()), 2::bigint, 'owner ve suspenso e devedor');
select is((select status from public_api.my_regularization_tenants() where slug = 'devedor'), 'past_due', 'past_due');
select is((select reason_code from public_api.my_regularization_tenants() where slug = 'suspenso'), 'subscription_suspended', 'reason suspenso');
select is((select count(*) from public_api.my_login_tenants()), 1::bigint, 'owner ativo entra no login');
reset role;

select is((select p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public_api' and p.proname = 'my_regularization_tenants'), 0::smallint, 'regularizacao sem parametro');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public_api' and p.proname = 'my_login_tenants'),
  'TABLE(slug text, display_name text, role text)',
  'my_login_tenants devolve slug, nome e papel'
);
select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public_api' and p.proname = 'my_regularization_tenants'),
  'TABLE(slug text, display_name text, status text, reason_code text, action_code text)',
  'my_regularization_tenants devolve as cinco colunas'
);

select pg_temp.err(
  $$select server_api.create_login_handoff('44444444-4444-4444-8444-444444444443', 'ativo', '/', repeat('a', 64), '\\x01')$$,
  '42501',
  'handoff sem membership'
);

select pg_temp.err($$do $b$ begin set local role anon; perform server_api.consume_login_handoff('ativo', 'x'); end $b$ $$, '42501', 'anon nao consome handoff');
select pg_temp.err($$do $b$ begin set local role authenticated; perform server_api.consume_login_handoff('ativo', 'x'); end $b$ $$, '42501', 'authenticated nao consome handoff');
select pg_temp.err($$do $b$ begin set local role anon; perform server_api.purge_login_handoffs(); end $b$ $$, '42501', 'anon nao limpa handoff');
select pg_temp.err($$do $b$ begin set local role authenticated; perform server_api.purge_login_handoffs(); end $b$ $$, '42501', 'authenticated nao limpa handoff');

select lives_ok(
  $$select server_api.create_login_handoff('44444444-4444-4444-8444-444444444442', 'ativo', '/', 'consume-once', '\x0102')$$,
  'cria handoff do staff'
);
select is(
  (select user_id from server_api.consume_login_handoff('ativo', 'consume-once')),
  '44444444-4444-4444-8444-444444444442'::uuid,
  'primeira consume devolve o usuario'
);
select is_empty($$select 1 from server_api.consume_login_handoff('ativo', 'consume-once')$$, 'segunda consume vem vazia');
select is(
  (select sealed from private.login_handoffs where code_hash = extensions.digest('consume-once', 'sha256')),
  '\x'::bytea,
  'consume zera o sealed'
);

insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
values (
  extensions.digest('consume-expired', 'sha256'),
  '44444444-4444-4444-8444-444444444442',
  '55555555-5555-4555-8555-555555555551',
  '/',
  '\x01',
  now() - interval '2 minutes'
);
select is_empty($$select 1 from server_api.consume_login_handoff('ativo', 'consume-expired')$$, 'codigo vencido');

select lives_ok(
  $$select server_api.create_login_handoff('44444444-4444-4444-8444-444444444442', 'ativo', '/', 'consume-other', '\x0102')$$,
  'cria handoff para outro slug'
);
select is_empty($$select 1 from server_api.consume_login_handoff('trial1', 'consume-other')$$, 'outro slug nao consome');

insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
values (
  extensions.digest('consume-suspended', 'sha256'),
  '44444444-4444-4444-8444-444444444441',
  '55555555-5555-4555-8555-555555555553',
  '/',
  '\x01',
  now() + interval '30 seconds'
);
select is_empty($$select 1 from server_api.consume_login_handoff('suspenso', 'consume-suspended')$$, 'tenant suspenso nao consome');

insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
values (
  extensions.digest('purge-old', 'sha256'),
  '44444444-4444-4444-8444-444444444442',
  '55555555-5555-4555-8555-555555555551',
  '/',
  '\x01',
  now() - interval '2 days'
);
select lives_ok($$select server_api.purge_login_handoffs()$$, 'limpa handoff vencido ha mais de um dia');
select is_empty($$select 1 from private.login_handoffs where code_hash = extensions.digest('purge-old', 'sha256')$$, 'linha velha some');
select ok(exists (select 1 from private.login_handoffs where code_hash = extensions.digest('consume-other', 'sha256')), 'linha nova permanece');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'm4-revoked@example.test', extensions.crypt('password', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);
insert into public.profiles (id, full_name) values ('44444444-4444-4444-8444-444444444444', 'revogado');
insert into public.memberships (tenant_id, user_id, role, status) values
  ('55555555-5555-4555-8555-555555555553', '44444444-4444-4444-8444-444444444443', 'owner', 'invited'),
  ('55555555-5555-4555-8555-555555555553', '44444444-4444-4444-8444-444444444444', 'owner', 'revoked');

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444443', true);
set local role authenticated;
select is((select count(*) from public_api.my_login_tenants()), 0::bigint, 'owner invited ve zero no login');
select is((select count(*) from public_api.my_regularization_tenants()), 0::bigint, 'owner invited ve zero na regularizacao');
reset role;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
set local role authenticated;
select is((select count(*) from public_api.my_login_tenants()), 0::bigint, 'owner revoked ve zero no login');
select is((select count(*) from public_api.my_regularization_tenants()), 0::bigint, 'owner revoked ve zero na regularizacao');
reset role;

select table_privs_are('private', 'login_handoffs', 'anon', ARRAY[]::name[], 'anon sem privilegio em login_handoffs');
select table_privs_are('private', 'login_handoffs', 'authenticated', ARRAY[]::name[], 'authenticated sem privilegio em login_handoffs');
select table_privs_are('private', 'login_handoffs', 'service_role', ARRAY[]::name[], 'service_role sem privilegio em login_handoffs');
select table_privs_are('private', 'login_handoffs', 'backup_reader', ARRAY['SELECT']::name[], 'backup_reader so select em login_handoffs');
select ok(
  has_table_privilege('backup_reader', 'private.login_handoffs', 'select'),
  'backup_reader le a tabela para o pg_dump conseguir trava-la'
);
select ok(
  not has_function_privilege('backup_reader', 'server_api.purge_login_handoffs()', 'execute'),
  'backup_reader nao executa a limpeza'
);

select lives_ok($$create extension if not exists dblink with schema extensions$$, 'dblink do consume concorrente');
select lives_ok(
  $$select extensions.dblink_connect('h1', 'host=' || host(inet_server_addr()) || ' dbname=' || current_database() || ' user=' || current_user || ' password=' || current_setting('barberclub.dblink_password'))$$,
  'sessao 1 do consume'
);
select lives_ok(
  $$select extensions.dblink_connect('h2', 'host=' || host(inet_server_addr()) || ' dbname=' || current_database() || ' user=' || current_user || ' password=' || current_setting('barberclub.dblink_password'))$$,
  'sessao 2 do consume'
);
select lives_ok(
  $q$select extensions.dblink_exec('h1', $setup$
    delete from public.memberships where tenant_id = '66666666-6666-4666-8666-666666666661';
    delete from private.login_handoffs where tenant_id = '66666666-6666-4666-8666-666666666661';
    delete from public.tenants where id = '66666666-6666-4666-8666-666666666661';
    delete from public.profiles where id = '66666666-6666-4666-8666-666666666662';
    delete from auth.users where id = '66666666-6666-4666-8666-666666666662';
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666662',
      'authenticated', 'authenticated', 'm4-race@example.test',
      extensions.crypt('password', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into public.profiles (id, full_name) values ('66666666-6666-4666-8666-666666666662', 'race');
    insert into public.tenants (id, slug, display_name, status) values ('66666666-6666-4666-8666-666666666661', 'racetenant', 'Race', 'active');
    insert into public.memberships (tenant_id, user_id, role, status) values ('66666666-6666-4666-8666-666666666661', '66666666-6666-4666-8666-666666666662', 'staff', 'active');
    insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
    values (extensions.digest('race-code', 'sha256'), '66666666-6666-4666-8666-666666666662', '66666666-6666-4666-8666-666666666661', '/', '\x01', now() + interval '30 seconds');
  $setup$)$q$,
  'fixture commitada do consume concorrente'
);
select extensions.dblink_exec('h1', 'begin');
select is(
  (select count(*) from extensions.dblink('h1', 'select user_id from server_api.consume_login_handoff(''racetenant'', ''race-code'')') as t(user_id uuid)),
  1::bigint,
  'h1 devolve uma linha e segura o lock'
);
select extensions.dblink_send_query('h2', 'select user_id from server_api.consume_login_handoff(''racetenant'', ''race-code'')');
select lives_ok($$do $w$
declare
  i integer := 0;
begin
  loop
    perform pg_stat_clear_snapshot();
    exit when exists (
      select 1 from pg_stat_activity
       where wait_event_type = 'Lock'
         and query like '%consume_login_handoff%'
         and pid <> pg_backend_pid()
    );
    i := i + 1;
    if i > 100 then
      raise exception 'h2 nao ficou em Lock';
    end if;
    perform pg_sleep(0.05);
  end loop;
end
$w$ $$, 'h2 espera no lock');
select extensions.dblink_exec('h1', 'commit');
create temp table pg_temp_race2 (user_id uuid);
insert into pg_temp_race2 select * from extensions.dblink_get_result('h2') as t(user_id uuid);
select is((select count(*) from pg_temp_race2), 0::bigint, 'a segunda consume espera o lock e perde');
select extensions.dblink_connect('h3', 'host=' || host(inet_server_addr()) || ' dbname=' || current_database() || ' user=' || current_user || ' password=' || current_setting('barberclub.dblink_password'));
select lives_ok(
  $$select extensions.dblink_exec('h3', 'delete from public.memberships where tenant_id = ''66666666-6666-4666-8666-666666666661''; delete from private.login_handoffs where tenant_id = ''66666666-6666-4666-8666-666666666661''; delete from public.tenants where id = ''66666666-6666-4666-8666-666666666661''; delete from public.profiles where id = ''66666666-6666-4666-8666-666666666662''; delete from auth.users where id = ''66666666-6666-4666-8666-666666666662'';')$$,
  'limpa a fixture concorrente'
);
select extensions.dblink_disconnect('h3');

select * from finish();
rollback;
