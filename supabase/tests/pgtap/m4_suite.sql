begin;
select * from plan(32);

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

select pg_temp.err(
  $$select server_api.create_login_handoff('44444444-4444-4444-8444-444444444443', 'ativo', '/', repeat('a', 64), '\\x01')$$,
  '42501',
  'handoff sem membership'
);

select * from finish();
rollback;
