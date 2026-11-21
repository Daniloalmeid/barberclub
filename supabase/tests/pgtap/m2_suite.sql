-- M2-T01 em diante. A transação desfaz a fixture.
begin;

select * from plan(78);

create or replace function pg_temp.err(sql text, code text, descr text) returns text
language plpgsql as $$
begin
  return extensions.throws_ok(sql, code::char(5), null::text, descr);
end $$;

create or replace function pg_temp.errm(sql text, code text, msg text, descr text) returns text
language plpgsql as $$
begin
  return extensions.throws_ok(sql, code::char(5), msg, descr);
end $$;
grant execute on function pg_temp.errm(text, text, text, text) to public, anon, authenticated, service_role;

create or replace function pg_temp.user_id(p_id uuid, p_email text) returns uuid
language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  );
  insert into public.profiles (id, full_name) values (p_id, p_email);
  return p_id;
end $$;

select pg_temp.user_id('21212121-2121-4212-8212-212121212111', 'm2-owner-a@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212112', 'm2-manager-a@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212113', 'm2-staff-a@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212114', 'm2-owner-b@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212115', 'm2-outsider@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212116', 'm2-newcomer@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212117', 'm2-guest@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212118', 'm2-pending@example.test');
select pg_temp.user_id('21212121-2121-4212-8212-212121212119', 'm2-admin@example.test');

insert into public.tenants (id, slug, display_name, status) values
  ('21212121-2121-4212-8212-212121212101', 'm2-alfa', 'Alfa', 'active'),
  ('21212121-2121-4212-8212-212121212102', 'm2-beta', 'Beta', 'active');

insert into public.memberships (tenant_id, user_id, role, status) values
  ('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'owner', 'active'),
  ('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212112', 'manager', 'active'),
  ('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'staff', 'active'),
  ('21212121-2121-4212-8212-212121212102', '21212121-2121-4212-8212-212121212114', 'owner', 'active');

insert into public.platform_admins (user_id)
values ('21212121-2121-4212-8212-212121212119');

-- T01 isolamento: owner de B não escreve em A
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212114', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212114","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'M2-T01 owner de B nao convida em A');
select is_empty($$select 1 from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212115'$$, 'M2-T01 sem membership em A');

select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212114', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212114","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113');
end $b$ $$, '42501', 'M2-T02 owner de B nao revoga em A');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'active', 'M2-T02 staff de A segue active');

select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212114', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212114","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'manager');
end $b$ $$, '42501', 'M2-T03 owner de B nao muda papel em A');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'staff', 'M2-T03 staff de A segue staff');

-- T04 usuário errado
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'M2-T04 staff nao convida');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212112', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212112","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'M2-T05 manager nao convida');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'staff');
end $b$ $$, '42501', 'not_allowed', 'M2-T06 owner nao se convida como staff');
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212111'), 'owner', 'M2-T06 papel segue owner');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'manager');
end $b$ $$, '42501', 'not_allowed', 'M2-T07 owner nao se convida como manager');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212111'), 'active', 'M2-T07 status segue active');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212112');
end $b$ $$, '42501', 'M2-T35 staff nao revoga');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212112', 'staff');
end $b$ $$, '42501', 'M2-T36 staff nao muda papel');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff'); end $b$ $$, '42501', 'M2-T08 anon nao convida');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.accept_invite('21212121-2121-4212-8212-212121212101'); end $b$ $$, '42501', 'M2-T09 anon nao aceita');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113'); end $b$ $$, '42501', 'M2-T10 anon nao revoga');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'manager'); end $b$ $$, '42501', 'M2-T11 anon nao muda papel');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116'); end $b$ $$, '42501', 'M2-T12 anon nao nomeia owner');
select pg_temp.err($$do $b$ begin set local role service_role; perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff'); end $b$ $$, '42501', 'M2-T13 service_role nao convida');

-- T14 K15
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'manager');
end $b$ $$, '23505', 'already_member', 'M2-T14 membro ativo');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'staff', 'M2-T14 papel do staff nao muda');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'active', 'M2-T14 status do staff nao muda');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'owner', 'M2-T15 papel do owner nao muda');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'active', 'M2-T15 status do owner nao muda');

-- T16 último owner e promoção
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'manager');
end $b$ $$, '42501', 'M2-T16 ultimo owner nao e rebaixado');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'owner', 'M2-T16 papel segue owner');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111');
end $b$ $$, '42501', 'M2-T37 ultimo owner nao e revogado');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'active', 'M2-T37 status segue active');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'owner');
end $b$ $$, '42501', 'M2-T38 change_member_role nao promove a owner');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'staff', 'M2-T38 staff segue staff');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116', 'owner');
end $b$ $$, '42501', 'M2-T39 invite_member nao cria owner');
select is_empty($$select 1 from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'$$, 'M2-T39 newcomer sem membership');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116');
end $b$ $$, '42501', 'M2-T20 owner nao nomeia owner');

-- T21 superadmin e aceite
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212119', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212119","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116')$$, 'M2-T21 superadmin nomeia owner');
reset role;
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212116'), 'owner', 'M2-T21 papel owner');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212116'), 'invited', 'M2-T21 status invited');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116', 'staff');
end $b$ $$, '42501', 'not_allowed', 'M2-T40 invite nao rebaixa owner convidado');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116', 'manager');
end $b$ $$, '42501', 'not_allowed', 'M2-T41 change nao rebaixa owner convidado');
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'owner', 'M2-T41 papel segue owner');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'invited', 'M2-T41 status segue invited');

select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.accept_invite('21212121-2121-4212-8212-212121212101');
end $b$ $$, 'P0002', 'invite_not_found', 'M2-T22 staff nao aceita o convite de outro');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'invited', 'M2-T22 convite do newcomer segue invited');

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212116', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212116","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public_api.accept_invite('21212121-2121-4212-8212-212121212101')$$, 'M2-T23 o convidado aceita');
reset role;
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'active', 'M2-T23 newcomer fica active');

select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116');
end $b$ $$, '42501', 'not_allowed', 'M2-T24 nao revoga outro owner');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'active', 'M2-T24 newcomer segue active');
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'owner', 'M2-T24 newcomer segue owner');

select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116', 'manager');
end $b$ $$, '42501', 'not_allowed', 'M2-T26 nao rebaixa outro owner');
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'owner', 'M2-T26 newcomer segue owner');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'staff');
end $b$ $$, '42501', 'M2-T27 o ultimo owner restante nao e rebaixado');

-- T28 convite, aceite e revogação de quem não é owner
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212118', 'staff')$$, 'M2-T28 convida pending como staff');
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212118', 'manager')$$, 'M2-T29 troca o papel do convite pendente');
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212117', 'staff')$$, 'M2-T30 convida guest');
reset role;
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212118'), 'manager', 'M2-T29 pending fica manager');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212118'), 'invited', 'M2-T29 pending segue invited');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.accept_invite('21212121-2121-4212-8212-212121212101');
end $b$ $$, 'P0002', 'invite_not_found', 'M2-T31 owner nao aceita o convite do guest');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'invited', 'M2-T31 guest segue invited');

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212117', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212117","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public_api.accept_invite('21212121-2121-4212-8212-212121212101')$$, 'M2-T32 guest aceita');
reset role;
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'active', 'M2-T32 guest fica active');

insert into public.staff (tenant_id, user_id, display_name, active)
values ('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212117', 'Guest', true);
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212117')$$, 'M2-T33 revoga guest');
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212117', 'manager')$$, 'M2-T34 reconvida guest revogado');
reset role;
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'invited', 'M2-T34 guest volta a invited');
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'manager', 'M2-T34 guest volta como manager');
select is((select active from public.staff where user_id = '21212121-2121-4212-8212-212121212117'), false, 'M2-T42 profissional do revogado fica inativo');

-- §12.3
select ok(
  not has_function_privilege('backup_reader', 'public_api.invite_member(uuid,uuid,text)', 'execute')
  and not has_function_privilege('backup_reader', 'public_api.accept_invite(uuid)', 'execute')
  and not has_function_privilege('backup_reader', 'public_api.revoke_member(uuid,uuid)', 'execute')
  and not has_function_privilege('backup_reader', 'public_api.change_member_role(uuid,uuid,text)', 'execute')
  and not has_function_privilege('backup_reader', 'public_api.appoint_owner(uuid,uuid)', 'execute'),
  'M2-T17 backup_reader sem EXECUTE'
);
select ok(
  (
    select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public_api'
       and p.proname in ('invite_member', 'accept_invite', 'revoke_member', 'change_member_role', 'appoint_owner')
  ),
  'M2-T18 prosecdef e search_path vazio'
);
select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'insert')
  and not has_table_privilege('authenticated', 'public.memberships', 'update'),
  'M2-T19 authenticated sem INSERT nem UPDATE em memberships'
);

-- AAL1
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal1"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'not_allowed', 'M2-T43 invite com AAL1');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal1"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113');
end $b$ $$, '42501', 'not_allowed', 'M2-T44 revoke com AAL1');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal1"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'manager');
end $b$ $$, '42501', 'not_allowed', 'M2-T45 change com AAL1');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212119', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212119","role":"authenticated","aal":"aal1"}', true);
  set local role authenticated;
  perform public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115');
end $b$ $$, '42501', 'not_allowed', 'M2-T46 appoint com AAL1');
select is_empty($$select 1 from public.memberships where user_id = '21212121-2121-4212-8212-212121212115'$$, 'M2-T43 AAL1 nao criou membership');

-- tenant suspenso
insert into public.tenants (id, slug, display_name, status)
values ('21212121-2121-4212-8212-212121212103', 'm2-suspenso', 'Suspenso', 'suspended');
insert into public.memberships (tenant_id, user_id, role, status) values
  ('21212121-2121-4212-8212-212121212103', '21212121-2121-4212-8212-212121212111', 'owner', 'active'),
  ('21212121-2121-4212-8212-212121212103', '21212121-2121-4212-8212-212121212113', 'staff', 'active');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212103', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'not_allowed', 'M2-T47 convite em tenant suspenso');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212103', '21212121-2121-4212-8212-212121212113');
end $b$ $$, '42501', 'not_allowed', 'M2-T48 revogacao em tenant suspenso');
select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212103', '21212121-2121-4212-8212-212121212113', 'manager');
end $b$ $$, '42501', 'not_allowed', 'M2-T49 troca de papel em tenant suspenso');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212103' and user_id = '21212121-2121-4212-8212-212121212113'), 'active', 'M2-T48 staff suspenso segue active');

select pg_temp.errm($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212115', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212115","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  perform public_api.accept_invite('21212121-2121-4212-8212-212121212101');
end $b$ $$, 'P0002', 'invite_not_found', 'M2-T50 sem convite');
