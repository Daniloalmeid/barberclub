-- M2-T01 em diante. A transação desfaz a fixture.
begin;

select * from plan(59);

create or replace function pg_temp.err(sql text, code text, descr text) returns text
language plpgsql as $$
begin
  return extensions.throws_ok(sql, code::char(5), null::text, descr);
end $$;

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
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212114","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'M2-T01 owner de B nao convida em A');
select is_empty($$select 1 from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212115'$$, 'M2-T01 sem membership em A');

select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212114', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212114","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113');
end $b$ $$, '42501', 'M2-T02 owner de B nao revoga em A');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'active', 'M2-T02 staff de A segue active');

select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212114', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212114","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'manager');
end $b$ $$, '42501', 'M2-T03 owner de B nao muda papel em A');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'staff', 'M2-T03 staff de A segue staff');

-- T04 usuário errado
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'M2-T04 staff nao convida');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212112', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212112","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff');
end $b$ $$, '42501', 'M2-T05 manager nao convida');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212112');
end $b$ $$, '42501', 'M2-T06 staff nao revoga');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212112', 'staff');
end $b$ $$, '42501', 'M2-T07 staff nao muda papel');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff'); end $b$ $$, '42501', 'M2-T08 anon nao convida');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.accept_invite('21212121-2121-4212-8212-212121212101'); end $b$ $$, '42501', 'M2-T09 anon nao aceita');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113'); end $b$ $$, '42501', 'M2-T10 anon nao revoga');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'manager'); end $b$ $$, '42501', 'M2-T11 anon nao muda papel');
select pg_temp.err($$do $b$ begin set local role anon; perform public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116'); end $b$ $$, '42501', 'M2-T12 anon nao nomeia owner');
select pg_temp.err($$do $b$ begin set local role service_role; perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212115', 'staff'); end $b$ $$, '42501', 'M2-T13 service_role nao convida');

-- T14 K15
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'manager')$$, 'M2-T14 convidar staff ativo');
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'staff')$$, 'M2-T15 convidar o proprio owner');
reset role;
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'staff', 'M2-T14 papel do staff nao muda');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'active', 'M2-T14 status do staff nao muda');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'owner', 'M2-T15 papel do owner nao muda');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'active', 'M2-T15 status do owner nao muda');

-- T16 último owner e promoção
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'manager');
end $b$ $$, '42501', 'M2-T16 ultimo owner nao e rebaixado');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'owner', 'M2-T16 papel segue owner');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111');
end $b$ $$, '42501', 'M2-T17 ultimo owner nao e revogado');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212111'), 'active', 'M2-T17 status segue active');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212113', 'owner');
end $b$ $$, '42501', 'M2-T18 change_member_role nao promove a owner');
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212113'), 'staff', 'M2-T18 staff segue staff');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116', 'owner');
end $b$ $$, '42501', 'M2-T19 invite_member nao cria owner');
select is_empty($$select 1 from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'$$, 'M2-T19 newcomer sem membership');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116');
end $b$ $$, '42501', 'M2-T20 owner nao nomeia owner');

-- T21 superadmin e aceite
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212119', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212119","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116')$$, 'M2-T21 superadmin nomeia owner');
reset role;
select is((select role from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212116'), 'owner', 'M2-T21 papel owner');
select is((select status from public.memberships where tenant_id = '21212121-2121-4212-8212-212121212101' and user_id = '21212121-2121-4212-8212-212121212116'), 'invited', 'M2-T21 status invited');

select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212113', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212113","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.accept_invite('21212121-2121-4212-8212-212121212101');
end $b$ $$, '42501', 'M2-T22 staff nao aceita o convite de outro');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'invited', 'M2-T22 convite do newcomer segue invited');

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212116', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212116","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.accept_invite('21212121-2121-4212-8212-212121212101')$$, 'M2-T23 o convidado aceita');
reset role;
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'active', 'M2-T23 newcomer fica active');

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116')$$, 'M2-T24 revoga o outro owner');
reset role;
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'revoked', 'M2-T24 newcomer revoked');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212111' and role = 'owner'), 'active', 'M2-T24 owner original segue active');

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212119', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212119","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.appoint_owner('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116')$$, 'M2-T25 superadmin reconvida owner revogado');
reset role;
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212116', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212116","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.accept_invite('21212121-2121-4212-8212-212121212101')$$, 'M2-T25 newcomer aceita de novo');
reset role;

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212116', 'manager')$$, 'M2-T26 rebaixa o segundo owner');
reset role;
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212116'), 'manager', 'M2-T26 newcomer vira manager');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.change_member_role('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212111', 'staff');
end $b$ $$, '42501', 'M2-T27 o ultimo owner restante nao e rebaixado');

-- T28 convite, aceite e revogação de quem não é owner
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212118', 'staff')$$, 'M2-T28 convida pending como staff');
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212118', 'manager')$$, 'M2-T29 troca o papel do convite pendente');
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212117', 'staff')$$, 'M2-T30 convida guest');
reset role;
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212118'), 'manager', 'M2-T29 pending fica manager');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212118'), 'invited', 'M2-T29 pending segue invited');
select pg_temp.err($$do $b$ begin
  perform set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
  perform set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
  set local role authenticated;
  perform public_api.accept_invite('21212121-2121-4212-8212-212121212101');
end $b$ $$, '42501', 'M2-T31 owner nao aceita o convite do guest');
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'invited', 'M2-T31 guest segue invited');

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212117', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212117","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.accept_invite('21212121-2121-4212-8212-212121212101')$$, 'M2-T32 guest aceita');
reset role;
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'active', 'M2-T32 guest fica active');

select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212111', true);
select set_config('request.jwt.claims', '{"sub":"21212121-2121-4212-8212-212121212111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public_api.revoke_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212117')$$, 'M2-T33 revoga guest');
select lives_ok($$select public_api.invite_member('21212121-2121-4212-8212-212121212101', '21212121-2121-4212-8212-212121212117', 'manager')$$, 'M2-T34 reconvida guest revogado');
reset role;
select is((select status from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'invited', 'M2-T34 guest volta a invited');
select is((select role from public.memberships where user_id = '21212121-2121-4212-8212-212121212117'), 'manager', 'M2-T34 guest volta como manager');
