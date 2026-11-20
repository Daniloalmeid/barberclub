-- Suíte T01–T26 e G01–G13. A transação desfaz a fixture.
begin;

select * from no_plan();

create temp table fx (name text primary key, id uuid not null);
grant select on fx to public;

create or replace function pg_temp.user_id(p_email text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  );
  insert into public.profiles (id, full_name) values (v_id, p_email);
  return v_id;
end $$;

insert into fx (name, id) values
  ('owner_a', pg_temp.user_id('owner-a@example.test')),
  ('manager_a', pg_temp.user_id('manager-a@example.test')),
  ('staff_a1', pg_temp.user_id('staff-a1@example.test')),
  ('staff_a2', pg_temp.user_id('staff-a2@example.test')),
  ('cliente_a1', pg_temp.user_id('cliente-a1@example.test')),
  ('cliente_a2', pg_temp.user_id('cliente-a2@example.test')),
  ('owner_b', pg_temp.user_id('owner-b@example.test')),
  ('staff_b1', pg_temp.user_id('staff-b1@example.test'));

insert into public.plans (id, code, name, price_cents)
values (gen_random_uuid(), 'm1', 'Plano M1', 0);

insert into public.tenants (id, slug, display_name, status, timezone)
values
  (gen_random_uuid(), 'barbearia-a', 'Barbearia A', 'active', 'America/Sao_Paulo'),
  (gen_random_uuid(), 'barbearia-b', 'Barbearia B', 'active', 'America/Sao_Paulo'),
  (gen_random_uuid(), 'barbearia-c', 'Barbearia C', 'suspended', 'America/Sao_Paulo'),
  (gen_random_uuid(), 'barbearia-d', 'Barbearia D', 'past_due', 'America/Sao_Paulo');

insert into fx (name, id)
select 'tenant_' || lower(right(slug, 1)), id
  from public.tenants
 where slug in ('barbearia-a', 'barbearia-b', 'barbearia-c', 'barbearia-d');

insert into public.tenant_branding (
  tenant_id, logo_url, banner_urls, color_primary, color_secondary, color_accent,
  address_line, city, state, phone_public, whatsapp_public, instagram_handle,
  opening_hours, booking_policy_text
)
select id, 'https://example.test/logo.png', '[]'::jsonb, '#111111', '#222222', '#333333',
       'Rua 1', 'Sao Paulo', 'SP', '1133334444', '11999998888', 'barbearia',
       '[]'::jsonb, 'Chegar no horario'
  from public.tenants
 where slug in ('barbearia-a', 'barbearia-b', 'barbearia-c', 'barbearia-d');

insert into public.tenant_settings (tenant_id)
select id from public.tenants
 where slug in ('barbearia-a', 'barbearia-b', 'barbearia-c', 'barbearia-d');

insert into public.subscriptions (tenant_id, plan_id, status)
select t.id, p.id,
       case t.slug
         when 'barbearia-c' then 'suspended'
         when 'barbearia-d' then 'past_due'
         else 'active'
       end
  from public.tenants t
  cross join public.plans p
 where t.slug in ('barbearia-a', 'barbearia-b', 'barbearia-c', 'barbearia-d');

insert into public.memberships (tenant_id, user_id, role)
select (select id from fx where name = 'tenant_a'), id, role
  from (values
    ('owner_a', 'owner'),
    ('manager_a', 'manager'),
    ('staff_a1', 'staff'),
    ('staff_a2', 'staff')
  ) v(name, role)
  join fx on fx.name = v.name;

insert into public.memberships (tenant_id, user_id, role)
select (select id from fx where name = 'tenant_b'), (select id from fx where name = 'owner_b'), 'owner';
insert into public.memberships (tenant_id, user_id, role)
select (select id from fx where name = 'tenant_b'), (select id from fx where name = 'staff_b1'), 'staff';

insert into public.customers (id, tenant_id, user_id, full_name, email)
select gen_random_uuid(), (select id from fx where name = 'tenant_a'), id, name, name || '@example.test'
  from fx where name in ('cliente_a1', 'cliente_a2');
insert into fx (name, id)
select 'customer_' || name, c.id
  from public.customers c
  join fx u on u.id = c.user_id;

insert into public.staff (id, tenant_id, user_id, display_name, active, photo_url, short_bio, commission_bps)
values
  (gen_random_uuid(), (select id from fx where name = 'tenant_a'), (select id from fx where name = 'staff_a1'), 'A1', true, 'https://example.test/a1.png', 'bio', 4000),
  (gen_random_uuid(), (select id from fx where name = 'tenant_a'), (select id from fx where name = 'staff_a2'), 'A2', true, null, null, 0),
  (gen_random_uuid(), (select id from fx where name = 'tenant_b'), (select id from fx where name = 'staff_b1'), 'B1', true, null, null, 0);
insert into fx (name, id)
select 'staffrow_' || u.name, s.id
  from public.staff s
  join fx u on u.id = s.user_id;

insert into public.services (id, tenant_id, name, description, duration_min, buffer_min, price_cents, category, display_order, active)
values
  (gen_random_uuid(), (select id from fx where name = 'tenant_a'), 'Corte', 'Corte simples', 30, 0, 5000, 'cabelo', 1, true),
  (gen_random_uuid(), (select id from fx where name = 'tenant_a'), 'Barba', 'Barba', 30, 0, 4000, 'barba', 2, true),
  (gen_random_uuid(), (select id from fx where name = 'tenant_a'), 'Inativo', null, 30, 0, 1000, null, 9, false),
  (gen_random_uuid(), (select id from fx where name = 'tenant_b'), 'Corte B', null, 30, 0, 5000, null, 1, true),
  (gen_random_uuid(), (select id from fx where name = 'tenant_c'), 'Corte C', null, 30, 0, 5000, null, 1, true);
insert into fx (name, id)
select 'service_' || t.slug || '_' || s.name, s.id
  from public.services s
  join public.tenants t on t.id = s.tenant_id;

insert into public.staff_services (tenant_id, staff_id, service_id, active)
values
  ((select id from fx where name = 'tenant_a'), (select id from fx where name = 'staffrow_staff_a1'), (select id from fx where name = 'service_barbearia-a_Corte'), true),
  ((select id from fx where name = 'tenant_a'), (select id from fx where name = 'staffrow_staff_a1'), (select id from fx where name = 'service_barbearia-a_Barba'), false),
  ((select id from fx where name = 'tenant_a'), (select id from fx where name = 'staffrow_staff_a2'), (select id from fx where name = 'service_barbearia-a_Corte'), true),
  ((select id from fx where name = 'tenant_b'), (select id from fx where name = 'staffrow_staff_b1'), (select id from fx where name = 'service_barbearia-b_Corte B'), true);

insert into public.work_schedules (tenant_id, staff_id, weekday, start_time, end_time)
select s.tenant_id, s.id, d, time '08:00', time '18:00'
  from public.staff s
  cross join generate_series(0, 6) d
 where s.tenant_id in (select id from fx where name like 'tenant_%');

insert into ledger.accounts (tenant_id, code, name, type)
select t.id, v.code, v.name, v.type
  from public.tenants t
  cross join (values
    ('1.1.01', 'Recebiveis', 'asset'),
    ('1.1.02', 'Saldo disponivel', 'asset'),
    ('1.1.03', 'Caixa', 'asset'),
    ('2.1.01', 'Comissoes a pagar', 'liability'),
    ('2.1.02', 'Reembolsos a pagar', 'liability'),
    ('4.1.01', 'Receita de servicos', 'revenue'),
    ('4.9.01', 'Devolucoes', 'contra_revenue'),
    ('5.1.01', 'Taxas do gateway', 'expense'),
    ('5.1.02', 'Despesa de comissoes', 'expense')
  ) as v(code, name, type)
 where t.slug in ('barbearia-a', 'barbearia-b', 'barbearia-c', 'barbearia-d');

-- Agenda visível para T05 e T06.
insert into public.appointments (
  id, tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
  hold_expires_at, idempotency_key, request_hash, price_cents
)
values (
  gen_random_uuid(),
  (select id from fx where name = 'tenant_a'),
  (select id from fx where name = 'staffrow_staff_a1'),
  (select id from fx where name = 'customer_cliente_a1'),
  (select id from fx where name = 'service_barbearia-a_Corte'),
  timestamptz '2027-01-05 10:00:00-03', timestamptz '2027-01-05 10:30:00-03',
  'confirmed', now() + interval '1 day', 'fix-a1',
  private.request_hash(
    (select id from fx where name = 'staffrow_staff_a1'),
    (select id from fx where name = 'service_barbearia-a_Corte'),
    timestamptz '2027-01-05 10:00:00-03'
  ),
  5000
), (
  gen_random_uuid(),
  (select id from fx where name = 'tenant_a'),
  (select id from fx where name = 'staffrow_staff_a2'),
  (select id from fx where name = 'customer_cliente_a2'),
  (select id from fx where name = 'service_barbearia-a_Corte'),
  timestamptz '2027-01-05 11:00:00-03', timestamptz '2027-01-05 11:30:00-03',
  'confirmed', now() + interval '1 day', 'fix-a2',
  private.request_hash(
    (select id from fx where name = 'staffrow_staff_a2'),
    (select id from fx where name = 'service_barbearia-a_Corte'),
    timestamptz '2027-01-05 11:00:00-03'
  ),
  5000
);
insert into fx (name, id)
select 'appt_' || idempotency_key, id
  from public.appointments
 where tenant_id = (select id from fx where name = 'tenant_a')
   and idempotency_key in ('fix-a1', 'fix-a2');

insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id
  from public.appointments
 where id in (select id from fx where name in ('appt_fix-a1', 'appt_fix-a2'));

insert into public.payments (tenant_id, appointment_id, amount_cents, fee_cents, status, provider)
select tenant_id, id, 5000, 0, 'paid', 'local'
  from public.appointments
 where id in (select id from fx where name in ('appt_fix-a1', 'appt_fix-a2'));

create or replace function pg_temp.uid(p_name text) returns uuid language sql stable as $$
  select id from fx where name = p_name
$$;
grant execute on function pg_temp.uid(text) to public, anon, authenticated, service_role, backup_reader, ledger_owner;

create or replace function pg_temp.err(sql text, code text, descr text) returns text
language plpgsql as $$
begin
  return extensions.throws_ok(sql, code::char(5), null::text, descr);
end $$;
grant execute on function pg_temp.err(text, text, text) to public, anon, authenticated, service_role, backup_reader, ledger_owner;

-- T01
select set_config('request.jwt.claim.sub', pg_temp.uid('owner_a')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('owner_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty(format('select 1 from public.services where tenant_id = %L', pg_temp.uid('tenant_b')), 'T01 services de B');
select is_empty(format('select 1 from public.customers where tenant_id = %L', pg_temp.uid('tenant_b')), 'T01 customers de B');
select is_empty(format('select 1 from public.appointments where tenant_id = %L', pg_temp.uid('tenant_b')), 'T01 appointments de B');
select is_empty(format('select 1 from public.payments where tenant_id = %L', pg_temp.uid('tenant_b')), 'T01 payments de B');
reset role;

-- T02
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.services (tenant_id, name, duration_min, price_cents)
      values (%L, 'Invasao', 30, 5000);
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('owner_a'), pg_temp.uid('owner_a'), pg_temp.uid('tenant_b')),
  '42501',
  'T02 escrita cruzada'
);

-- T03
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.services set tenant_id = %L where id = %L;
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('owner_a'), pg_temp.uid('owner_a'), pg_temp.uid('tenant_b'), pg_temp.uid('service_barbearia-a_Corte')),
  '42501',
  'T03 tenant_id imutavel'
);

-- T04
select pg_temp.err(
  format($f$
    insert into public.appointments (
      tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
      idempotency_key, request_hash
    ) values (
      %L, %L, %L, %L, timestamptz '2027-01-06 10:00:00-03', timestamptz '2027-01-06 10:30:00-03',
      'hold', 'cross', '\x00'
    )
  $f$, pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_b1'), pg_temp.uid('customer_cliente_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  '23503',
  'T04 FK composta'
);

-- T05
select set_config('request.jwt.claim.sub', pg_temp.uid('staff_a1')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('staff_a1'), 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  format('select staff_id::text from public.appointments order by 1'),
  array[pg_temp.uid('staffrow_staff_a1')::text],
  'T05 staff vê só a própria agenda'
);
reset role;

-- T06
select set_config('request.jwt.claim.sub', pg_temp.uid('cliente_a1')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('cliente_a1'), 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  'select customer_id::text from public.appointments',
  array[pg_temp.uid('customer_cliente_a1')::text],
  'T06 appointments do cliente'
);
select is(
  (select count(*) from public.payments),
  1::bigint,
  'T06 payments do cliente'
);
reset role;

-- T07
set local role anon;
select pg_temp.err('select * from public.services', '42501', 'T07 anon sem services');
select pg_temp.err('select * from public.customers', '42501', 'T07 anon sem customers');
select is(
  (select count(*) from public_api.list_services('barbearia-a')),
  2::bigint,
  'T07 catalogo de A sem inativos'
);
select is_empty($$select 1 from public_api.list_services('barbearia-c')$$, 'T07 tenant suspenso some do catalogo');
reset role;

-- T08
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.appointments (
        tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status, idempotency_key, request_hash
      ) values (%L, %L, %L, %L, now(), now() + interval '30 min', 'hold', 'x', '\x00');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('customer_cliente_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  '42501',
  'T08 cliente nao insere appointment'
);
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      set local role authenticated;
      insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
      values (%L, %L, tstzrange(now(), now() + interval '30 min', '[)'), %L);
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('appt_fix-a1')),
  '42501',
  'T08 cliente nao insere staff_busy'
);
set local role service_role;
select pg_temp.err(
  format($f$
    insert into public.appointments (
      tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status, idempotency_key, request_hash
    ) values (%L, %L, %L, %L, now(), now() + interval '30 min', 'hold', 'sr', '\x00')
  $f$, pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('customer_cliente_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  '42501',
  'T08 service_role nao insere appointment'
);
select pg_temp.err('insert into public.staff_busy (tenant_id, staff_id, period, time_off_id) values (gen_random_uuid(), gen_random_uuid(), tstzrange(now(), now() + interval ''30 min''), gen_random_uuid())', '42501', 'T08 service_role nao insere staff_busy');
reset role;

-- T09 sequencial; a corrida real é o C01.
select lives_ok(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-07 13:00:00-03', 't09-a');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  'T09 primeira reserva'
);
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-07 13:00:00-03', 't09-b');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a2'), pg_temp.uid('cliente_a2'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  '23P01',
  'T09 segunda reserva colide'
);
select is(
  (select count(*) from public.staff_busy b join public.appointments a on a.id = b.appointment_id where a.idempotency_key = 't09-a' and b.active),
  1::bigint,
  'T09 uma ocupacao ativa'
);

-- T10
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.create_time_off(%L, %L, timestamptz '2027-01-05 10:00:00-03', timestamptz '2027-01-05 12:00:00-03', 'bloqueio');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('owner_a'), pg_temp.uid('owner_a'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1')),
  '23P01',
  'T10 bloqueio sobre agenda'
);

-- T11
insert into public.appointments (
  id, tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
  hold_expires_at, idempotency_key, request_hash
) values (
  gen_random_uuid(),
  pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('customer_cliente_a1'),
  pg_temp.uid('service_barbearia-a_Corte'),
  timestamptz '2027-01-08 13:00:00-03', timestamptz '2027-01-08 13:30:00-03',
  'hold', now() - interval '2 minutes', 't11-old',
  private.request_hash(pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte'), timestamptz '2027-01-08 13:00:00-03')
);
insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id
  from public.appointments where idempotency_key = 't11-old';
select lives_ok(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-08 13:00:00-03', 't11-new');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a2'), pg_temp.uid('cliente_a2'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  'T11 nova reserva no horario liberado'
);
select is((select status from public.appointments where idempotency_key = 't11-old'), 'expired', 'T11 hold anterior expired');
select is((select active from public.staff_busy where appointment_id = (select id from public.appointments where idempotency_key = 't11-old')), false, 'T11 ocupacao anterior inativa');

-- T12
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.change_member_role(%L, %L, 'superadmin');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('owner_a'), pg_temp.uid('owner_a'), pg_temp.uid('tenant_a'), pg_temp.uid('staff_a1')),
  '42501',
  'T12 papel superadmin recusado'
);
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      set local role authenticated;
      insert into public.platform_admins (user_id) values (%L);
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('owner_a'), pg_temp.uid('owner_a')),
  '42501',
  'T12 platform_admins fechado'
);

-- T13
set local role anon;
select pg_temp.err($$select server_api.process_payment_event('asaas','e', gen_random_uuid(), 'paid', 1)$$, '42501', 'T13 anon sem webhook');
select pg_temp.err($$select ledger.post_journal_entry(gen_random_uuid(), 'payment', 'payment', gen_random_uuid(), now(), '[]'::jsonb, null)$$, '42501', 'T13 anon sem ledger');
reset role;
select set_config('request.jwt.claim.sub', pg_temp.uid('owner_a')::text, true);
set local role authenticated;
select pg_temp.err($$select server_api.process_payment_event('asaas','e2', gen_random_uuid(), 'paid', 1)$$, '42501', 'T13 authenticated sem webhook');
select pg_temp.err($$select ledger.post_journal_entry(gen_random_uuid(), 'payment', 'payment', gen_random_uuid(), now(), '[]'::jsonb, null)$$, '42501', 'T13 authenticated sem ledger');
reset role;

-- T14
select pg_temp.err(
  $q$
    do $body$
    declare v uuid := gen_random_uuid();
    begin
      set local role ledger_owner;
      insert into ledger.journal_entries (id, tenant_id, occurred_at, kind, source_type, source_id, entry_hash)
      values (v, (select id from fx where name = 'tenant_a'), now(), 'payment', 't14', gen_random_uuid(), '\x11');
      insert into ledger.journal_lines (tenant_id, entry_id, account_id, debit_cents, credit_cents)
      select (select id from fx where name = 'tenant_a'), v, id, 100, 0 from ledger.accounts
       where tenant_id = (select id from fx where name = 'tenant_a') and code = '1.1.01';
      insert into ledger.journal_lines (tenant_id, entry_id, account_id, debit_cents, credit_cents)
      select (select id from fx where name = 'tenant_a'), v, id, 0, 40 from ledger.accounts
       where tenant_id = (select id from fx where name = 'tenant_a') and code = '4.1.01';
      set constraints ledger.journal_lines_balanced, ledger.journal_entries_has_lines immediate;
      reset role;
    end
    $body$;
  $q$,
  '23514',
  'T14 desbalanceado'
);
select pg_temp.err(
  $q$
    do $body$
    declare v uuid := gen_random_uuid();
    begin
      set local role ledger_owner;
      insert into ledger.journal_entries (id, tenant_id, occurred_at, kind, source_type, source_id, entry_hash)
      values (v, (select id from fx where name = 'tenant_a'), now(), 'payment', 't14b', gen_random_uuid(), '\x11');
      insert into ledger.journal_lines (tenant_id, entry_id, account_id, debit_cents, credit_cents)
      select (select id from fx where name = 'tenant_a'), v, id, 100, 0 from ledger.accounts
       where tenant_id = (select id from fx where name = 'tenant_a') and code = '1.1.01';
      set constraints ledger.journal_lines_balanced, ledger.journal_entries_has_lines immediate;
      reset role;
    end
    $body$;
  $q$,
  '23514',
  'T14 uma linha'
);
select pg_temp.err(
  $q$
    do $body$
    begin
      set local role ledger_owner;
      insert into ledger.journal_entries (tenant_id, occurred_at, kind, source_type, source_id, entry_hash)
      values ((select id from fx where name = 'tenant_a'), now(), 'payment', 't14c', gen_random_uuid(), '\x11');
      set constraints ledger.journal_lines_balanced, ledger.journal_entries_has_lines immediate;
      reset role;
    end
    $body$;
  $q$,
  '23514',
  'T14 sem linhas'
);

-- T15
select lives_ok(
  format($q$
    select ledger.post_journal_entry(
      %L, 'platform_fee', 't15', %L, now(),
      jsonb_build_array(
        jsonb_build_object('code','5.1.01','debit_cents',100,'credit_cents',0),
        jsonb_build_object('code','1.1.01','debit_cents',0,'credit_cents',100)
      ),
      't15'
    )
  $q$, pg_temp.uid('tenant_a'), gen_random_uuid()),
  'T15 lancamento valido'
);
select pg_temp.err(
  $$update ledger.journal_entries set memo = 'x' where memo = 't15'$$,
  '42501',
  'T15 update bloqueado'
);
select pg_temp.err(
  $$delete from ledger.journal_lines where entry_id in (select id from ledger.journal_entries where memo = 't15')$$,
  '42501',
  'T15 delete bloqueado'
);
set constraints ledger.journal_lines_balanced, ledger.journal_entries_has_lines immediate;
set local role ledger_owner;
select pg_temp.err('truncate ledger.journal_lines', '42501', 'T15 truncate bloqueado');
reset role;
set constraints ledger.journal_lines_balanced, ledger.journal_entries_has_lines deferred;
select lives_ok(
  $$select ledger.reverse_journal_entry((select id from ledger.journal_entries where memo = 't15'), 'estorno')$$,
  'T15 primeiro estorno'
);
select pg_temp.err(
  $$select ledger.reverse_journal_entry((select id from ledger.journal_entries where memo = 't15'), 'de novo')$$,
  '23505',
  'T15 segundo estorno'
);

-- T16
select pg_temp.err(
  format($q$
    select ledger.post_journal_entry(
      %L, 'payment', 't16', %L, now(),
      jsonb_build_array(
        jsonb_build_object('account_id', (select id from ledger.accounts where tenant_id = %L and code = '1.1.01'), 'debit_cents', 100, 'credit_cents', 0),
        jsonb_build_object('account_id', (select id from ledger.accounts where tenant_id = %L and code = '4.1.01'), 'debit_cents', 0, 'credit_cents', 100)
      ),
      't16'
    )
  $q$, pg_temp.uid('tenant_a'), gen_random_uuid(), pg_temp.uid('tenant_b'), pg_temp.uid('tenant_b')),
  '23503',
  'T16 conta de outro tenant'
);

-- T17 e G09
select is_empty(
  $$
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef
       and n.nspname in ('public', 'public_api', 'server_api', 'private', 'ledger')
       and (
         p.proowner <> case when n.nspname = 'ledger' then 'ledger_owner'::regrole else 'postgres'::regrole end
         or not exists (
           select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
            where cfg in ('search_path=', 'search_path=""')
         )
       )
  $$,
  'T17 security definer com search_path vazio e dono esperado'
);

-- T18
insert into storage.objects (bucket_id, name)
values
  ('tenant-files', pg_temp.uid('tenant_a')::text || '/a.txt'),
  ('tenant-files', pg_temp.uid('tenant_b')::text || '/b.txt');
select set_config('request.jwt.claim.sub', pg_temp.uid('owner_a')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('owner_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty(
  format('select 1 from storage.objects where name like %L', pg_temp.uid('tenant_b')::text || '/%'),
  'T18 nao le o outro tenant'
);
select pg_temp.err(
  format($q$insert into storage.objects (bucket_id, name) values ('tenant-files', %L)$q$, pg_temp.uid('tenant_b')::text || '/novo.txt'),
  '42501',
  'T18 nao grava no outro tenant'
);
select pg_temp.err(
  format($q$delete from storage.objects where name = %L$q$, pg_temp.uid('tenant_b')::text || '/b.txt'),
  '42501',
  'T18 nao remove o outro tenant'
);
reset role;

-- T19
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-12 13:00:00-03', 't19');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_c'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  'P0001',
  'T19 suspenso'
);
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-12 14:00:00-03', 't19b');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_d'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte')),
  'P0001',
  'T19 past_due'
);

-- T20
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-12 15:00:00-03', 't20');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Barba')),
  'P0001',
  'T20 vinculo inativo'
);
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-12 16:00:00-03', 't20b');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a2'), pg_temp.uid('service_barbearia-a_Inativo')),
  'P0001',
  'T20 vinculo inexistente'
);

-- T21
select lives_ok(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-13 13:00:00-03', 't21');
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-13 13:00:00-03', 't21');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a2'), pg_temp.uid('service_barbearia-a_Corte'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a2'), pg_temp.uid('service_barbearia-a_Corte')),
  'T21 mesma chave e mesmo pedido'
);
select is((select count(*) from public.appointments where idempotency_key = 't21'), 1::bigint, 'T21 uma linha');
select pg_temp.err(
  format($f$
    do $body$
    begin
      perform set_config('request.jwt.claim.sub', %L, true);
      perform set_config('request.jwt.claims', json_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public_api.book_appointment(%L, %L, %L, timestamptz '2027-01-13 15:00:00-03', 't21');
      reset role;
    end
    $body$;
  $f$, pg_temp.uid('cliente_a1'), pg_temp.uid('cliente_a1'), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a2'), pg_temp.uid('service_barbearia-a_Corte')),
  '22023',
  'T21 chave reutilizada com outro pedido'
);

-- T22
select pg_temp.err(
  format($q$insert into public.staff_busy (tenant_id, staff_id, period) values (%L, %L, tstzrange(now(), now() + interval '30 min'))$q$, pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1')),
  '23514',
  'T22 sem origem'
);
select pg_temp.err(
  format($q$insert into public.staff_busy (tenant_id, staff_id, period, appointment_id, time_off_id) values (%L, %L, tstzrange(now(), now() + interval '30 min'), gen_random_uuid(), gen_random_uuid())$q$, pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1')),
  '23514',
  'T22 duas origens'
);
select pg_temp.err(
  format($q$
    do $body$
    begin
      insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
      values (%L, %L, tstzrange(timestamptz '2027-03-01 10:00:00-03', timestamptz '2027-03-01 10:30:00-03'), %L);
      set constraints staff_busy_tenant_id_appointment_id_staff_id_fkey immediate;
    end
    $body$;
  $q$, pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'), gen_random_uuid()),
  '23503',
  'T22 orfao'
);
select pg_temp.err(
  format($q$
    do $body$
    begin
      update public.staff_busy
         set period = tstzrange(timestamptz '2027-01-05 10:00:00-03', timestamptz '2027-01-05 12:00:00-03')
       where appointment_id = %L;
      set constraints staff_busy_matches_source immediate;
    end
    $body$;
  $q$, pg_temp.uid('appt_fix-a1')),
  '23514',
  'T22 periodo divergente'
);

-- T23
insert into public.appointments (
  id, tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
  hold_expires_at, idempotency_key, request_hash
) values (
  gen_random_uuid(), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a2'),
  pg_temp.uid('customer_cliente_a2'), pg_temp.uid('service_barbearia-a_Corte'),
  timestamptz '2027-01-14 13:00:00-03', timestamptz '2027-01-14 13:30:00-03',
  'expired', now() - interval '5 minutes', 't23',
  private.request_hash(pg_temp.uid('staffrow_staff_a2'), pg_temp.uid('service_barbearia-a_Corte'), timestamptz '2027-01-14 13:00:00-03')
);
insert into public.staff_busy (tenant_id, staff_id, period, appointment_id, active)
select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id, false
  from public.appointments where idempotency_key = 't23';
insert into public.payments (id, tenant_id, appointment_id, amount_cents, fee_cents, status, provider)
values (gen_random_uuid(), pg_temp.uid('tenant_a'), (select id from public.appointments where idempotency_key = 't23'), 5000, 0, 'pending', 'asaas');
insert into fx (name, id) select 'pay_t23', id from public.payments where appointment_id = (select id from public.appointments where idempotency_key = 't23');
set local role service_role;
select is(
  server_api.process_payment_event('asaas', 'evt-t23', pg_temp.uid('pay_t23'), 'paid', 5000),
  'confirmed_late',
  'T23 confirmed_late'
);
reset role;
select is((select status from public.appointments where idempotency_key = 't23'), 'confirmed', 'T23 confirmado');
select ok(
  exists (
    select 1
      from ledger.journal_lines l
      join ledger.accounts a on a.id = l.account_id
      join ledger.journal_entries e on e.id = l.entry_id
     where e.source_id = pg_temp.uid('pay_t23')
       and a.code = '4.1.01'
       and l.credit_cents = 5000
  ),
  'T23 receita lancada'
);

-- T24
insert into public.appointments (
  id, tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
  hold_expires_at, idempotency_key, request_hash
) values (
  gen_random_uuid(), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'),
  pg_temp.uid('customer_cliente_a1'), pg_temp.uid('service_barbearia-a_Corte'),
  timestamptz '2027-01-15 13:00:00-03', timestamptz '2027-01-15 13:30:00-03',
  'confirmed', now() + interval '1 day', 't24-ocupa',
  private.request_hash(pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte'), timestamptz '2027-01-15 13:00:00-03')
);
insert into public.staff_busy (tenant_id, staff_id, period, appointment_id, active)
select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id, true
  from public.appointments where idempotency_key = 't24-ocupa';
insert into public.appointments (
  id, tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
  hold_expires_at, idempotency_key, request_hash
) values (
  gen_random_uuid(), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a1'),
  pg_temp.uid('customer_cliente_a2'), pg_temp.uid('service_barbearia-a_Corte'),
  timestamptz '2027-01-15 13:00:00-03', timestamptz '2027-01-15 13:30:00-03',
  'expired', now() - interval '5 minutes', 't24-atrasado',
  private.request_hash(pg_temp.uid('staffrow_staff_a1'), pg_temp.uid('service_barbearia-a_Corte'), timestamptz '2027-01-15 13:00:00-03')
);
insert into public.staff_busy (tenant_id, staff_id, period, appointment_id, active)
select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id, false
  from public.appointments where idempotency_key = 't24-atrasado';
insert into public.payments (id, tenant_id, appointment_id, amount_cents, fee_cents, status, provider)
values (gen_random_uuid(), pg_temp.uid('tenant_a'), (select id from public.appointments where idempotency_key = 't24-atrasado'), 5000, 0, 'pending', 'asaas');
insert into fx (name, id)
select 'pay_t24', id from public.payments
 where appointment_id = (select id from public.appointments where idempotency_key = 't24-atrasado');
set local role service_role;
select is(
  server_api.process_payment_event('asaas', 'evt-t24', pg_temp.uid('pay_t24'), 'paid', 5000),
  'refund_requested',
  'T24 pede reembolso'
);
reset role;
select is((select status from public.appointments where idempotency_key = 't24-atrasado'), 'payment_conflict', 'T24 payment_conflict');
select is((select status from public.payments where id = pg_temp.uid('pay_t24')), 'paid_unallocated', 'T24 paid_unallocated');
select ok(exists (select 1 from public.refund_requests where payment_id = pg_temp.uid('pay_t24')), 'T24 refund_request');
select ok(exists (select 1 from public.admin_cases where ref_id = pg_temp.uid('pay_t24') and kind = 'late_payment_slot_taken'), 'T24 admin_case');
select ok(
  exists (
    select 1 from ledger.journal_lines l
    join ledger.accounts a on a.id = l.account_id
    join ledger.journal_entries e on e.id = l.entry_id
   where e.source_id = pg_temp.uid('pay_t24') and a.code = '2.1.02' and l.credit_cents = 5000
  ),
  'T24 passivo'
);
select ok(
  not exists (
    select 1 from ledger.journal_lines l
    join ledger.accounts a on a.id = l.account_id
    join ledger.journal_entries e on e.id = l.entry_id
   where e.source_id = pg_temp.uid('pay_t24') and a.code = '4.1.01'
  ),
  'T24 sem receita'
);

-- T25
insert into public.appointments (
  id, tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
  hold_expires_at, idempotency_key, request_hash
) values (
  gen_random_uuid(), pg_temp.uid('tenant_a'), pg_temp.uid('staffrow_staff_a2'),
  pg_temp.uid('customer_cliente_a1'), pg_temp.uid('service_barbearia-a_Corte'),
  timestamptz '2027-01-16 13:00:00-03', timestamptz '2027-01-16 13:30:00-03',
  'pending_payment', now() + interval '10 minutes', 't25',
  private.request_hash(pg_temp.uid('staffrow_staff_a2'), pg_temp.uid('service_barbearia-a_Corte'), timestamptz '2027-01-16 13:00:00-03')
);
insert into public.staff_busy (tenant_id, staff_id, period, appointment_id)
select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id
  from public.appointments where idempotency_key = 't25';
insert into public.payments (id, tenant_id, appointment_id, amount_cents, status, provider)
values (gen_random_uuid(), pg_temp.uid('tenant_a'), (select id from public.appointments where idempotency_key = 't25'), 5000, 'pending', 'asaas');
insert into fx (name, id)
select 'pay_t25', id from public.payments
 where appointment_id = (select id from public.appointments where idempotency_key = 't25');
set local role service_role;
select is(server_api.process_payment_event('asaas', 'evt-t25', pg_temp.uid('pay_t25'), 'paid', 5000), 'confirmed', 'T25 primeiro evento');
select is(server_api.process_payment_event('asaas', 'evt-t25', pg_temp.uid('pay_t25'), 'paid', 5000), 'duplicate_event', 'T25 evento repetido');
select is(server_api.process_payment_event('asaas', 'evt-t25-b', pg_temp.uid('pay_t25'), 'paid', 5000), 'already_processed', 'T25 outro evento do mesmo pagamento');
reset role;
select is(
  (select count(*) from ledger.journal_entries where source_id = pg_temp.uid('pay_t25') and kind = 'payment'),
  1::bigint,
  'T25 um conjunto de lancamentos'
);

-- T26
select is(
  (select array_agg(u.n order by u.o) filter (where u.m = 't')::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(n, m, o)
    where n.nspname = 'public_api' and p.proname = 'get_tenant_public'),
  '{slug,display_name,logo_url,banner_urls,color_primary,color_secondary,color_accent,address_line,city,state,phone_public,whatsapp_public,instagram_handle,timezone,opening_hours,booking_policy_text}',
  'T26 get_tenant_public'
);
select is(
  (select array_agg(u.n order by u.o) filter (where u.m = 't')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(n, m, o)
    where n.nspname = 'public_api' and p.proname = 'list_services'),
  '{service_id,name,description,duration_min,price_cents,category,display_order}',
  'T26 list_services'
);
select is(
  (select array_agg(u.n order by u.o) filter (where u.m = 't')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(n, m, o)
    where n.nspname = 'public_api' and p.proname = 'list_staff'),
  '{staff_id,display_name,photo_url,short_bio,service_ids}',
  'T26 list_staff'
);
select is(
  (select array_agg(u.n order by u.o) filter (where u.m = 't')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(n, m, o)
    where n.nspname = 'public_api' and p.proname = 'list_free_slots'),
  '{staff_id,starts_at,ends_at}',
  'T26 list_free_slots'
);

-- G01
select ok(
  not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private', 'ledger')
       and c.relkind = 'r'
       and (
         has_table_privilege('anon', c.oid, 'select')
         or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update')
         or has_table_privilege('anon', c.oid, 'delete')
         or has_table_privilege('anon', c.oid, 'truncate')
       )
  ),
  'G01 anon sem tabelas'
);

-- G02
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'public_api', 'server_api', 'private', 'ledger')
       and has_function_privilege('anon', p.oid, 'execute')
       and p.proname not in ('get_tenant_public', 'list_services', 'list_staff', 'list_free_slots')
  ),
  'G02 anon só executa o catálogo'
);
select ok(has_function_privilege('anon', 'public_api.list_services(text)', 'execute'), 'G02 list_services');
select ok(has_function_privilege('anon', 'public_api.get_tenant_public(text)', 'execute'), 'G02 get_tenant_public');
select ok(has_function_privilege('anon', 'public_api.list_staff(text)', 'execute'), 'G02 list_staff');
select ok(has_function_privilege('anon', 'public_api.list_free_slots(text,uuid,uuid,date)', 'execute'), 'G02 list_free_slots');

-- G03
select ok(
  not exists (
    select 1
      from (values
        ('public.staff_busy'), ('public.appointments'), ('public.payments'), ('public.audit_log'),
        ('public.refunds'), ('public.refund_requests'), ('public.admin_cases'), ('public.webhook_events'),
        ('public.subscriptions'), ('public.platform_admins'), ('public.outbox_events'), ('public.rate_limits'),
        ('public.time_off')
      ) t(rel)
      cross join (values ('insert'), ('update'), ('delete'), ('truncate')) p(priv)
     where has_table_privilege('authenticated', t.rel, p.priv)
  ),
  'G03 authenticated sem escrita nas tabelas criticas'
);

-- G04
select ok(
  not has_schema_privilege('anon', 'ledger', 'usage')
  and not has_schema_privilege('authenticated', 'ledger', 'usage')
  and not has_schema_privilege('service_role', 'ledger', 'usage')
  and not has_table_privilege('anon', 'ledger.journal_lines', 'select')
  and not has_table_privilege('service_role', 'ledger.journal_lines', 'insert'),
  'G04 ledger fechado para a API'
);

-- G05
select ok(
  not has_table_privilege('service_role', 'public.staff_busy', 'insert')
  and not has_table_privilege('service_role', 'public.appointments', 'update')
  and not has_table_privilege('service_role', 'public.payments', 'delete')
  and not has_table_privilege('service_role', 'public.audit_log', 'truncate'),
  'G05 service_role sem escrita critica'
);

-- G06
select ok(has_schema_privilege('authenticated', 'private', 'usage'), 'G06 authenticated usa private');
select ok(has_schema_privilege('backup_reader', 'private', 'usage'), 'G06 backup_reader usa private');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'G06 anon sem private');
select ok(not has_schema_privilege('service_role', 'private', 'usage'), 'G06 service_role sem private');

-- G07: D37 dá USAGE em server_api ao backup_reader, sem EXECUTE.
select ok(has_schema_privilege('service_role', 'server_api', 'usage'), 'G07 service_role usa server_api');
select ok(not has_schema_privilege('anon', 'server_api', 'usage'), 'G07 anon sem server_api');
select ok(not has_schema_privilege('authenticated', 'server_api', 'usage'), 'G07 authenticated sem server_api');
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'server_api'
     and (
       not has_function_privilege('service_role', p.oid, 'execute')
       or has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('backup_reader', p.oid, 'execute')
     )
  ),
  'G07 execute de server_api só para service_role'
);

-- G08
select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public_api', 'server_api', 'private', 'ledger')
       and has_function_privilege('public', p.oid, 'execute')$$,
  'G08 nada executavel por PUBLIC'
);

-- G09
select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef
       and n.nspname in ('public', 'public_api', 'server_api', 'private', 'ledger')
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
          where cfg in ('search_path=', 'search_path=""')
       )$$,
  'G09 search_path vazio'
);

-- G10
create table public.g10_probe (id integer);
create function public.g10_probe() returns integer
language sql
set search_path = ''
as $$ select 1 $$;
select ok(not has_table_privilege('anon', 'public.g10_probe', 'select'), 'G10 anon sem tabela nova');
select ok(not has_table_privilege('authenticated', 'public.g10_probe', 'insert'), 'G10 authenticated sem tabela nova');
select ok(not has_table_privilege('service_role', 'public.g10_probe', 'select'), 'G10 service_role sem tabela nova');
select ok(not has_function_privilege('public', 'public.g10_probe()', 'execute'), 'G10 funcao nova sem PUBLIC');
select ok(has_table_privilege('backup_reader', 'public.g10_probe', 'select'), 'G10 backup_reader le tabela nova');

-- G11
select ok(
  not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'ledger')
       and c.relkind = 'r'
       and (
         not has_table_privilege('backup_reader', c.oid, 'select')
         or has_table_privilege('backup_reader', c.oid, 'insert')
         or has_table_privilege('backup_reader', c.oid, 'update')
         or has_table_privilege('backup_reader', c.oid, 'delete')
         or has_table_privilege('backup_reader', c.oid, 'truncate')
       )
  ),
  'G11 backup_reader só lê'
);

-- G12
select ok(
  not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ledger'
       and c.relkind in ('r', 'S')
       and c.relowner <> 'ledger_owner'::regrole
  ),
  'G12 tabelas e sequences do ledger'
);
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'ledger'
       and p.proowner <> 'ledger_owner'::regrole
  ),
  'G12 funcoes do ledger'
);
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public_api', 'server_api', 'private')
       and p.proowner <> 'postgres'::regrole
  ),
  'G12 funcoes do postgres'
);

-- G13
select ok(
  (select rolbypassrls and rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
     from pg_roles where rolname = 'backup_reader'),
  'G13 login sem superuser e com bypassrls'
);
select lives_ok(
  format($q$
    do $body$
    declare
      n bigint;
      u bigint;
    begin
      set local role backup_reader;
      select count(*) into n from public.appointments;
      select count(*) into u from auth.users;
      if n <> %s then
        raise exception 'appointments divergiram';
      end if;
      if u < 8 then
        raise exception 'auth.users incompleto';
      end if;
      perform 1 from public.services limit 1;
      perform 1 from ledger.journal_entries limit 1;
      perform 1 from auth.identities limit 1;
      reset role;
    end
    $body$;
  $q$, (select count(*) from public.appointments)),
  'G13 le public, ledger e auth, inclusive com RLS'
);
select pg_temp.err(
  format($q$
    do $body$
    begin
      set local role backup_reader;
      insert into public.services (tenant_id, name, duration_min, price_cents) values (%L, 'x', 30, 1);
    end
    $body$;
  $q$, pg_temp.uid('tenant_a')),
  '42501', 'G13 insert'
);
select pg_temp.err($$do $body$ begin set local role backup_reader; update public.services set name = name; end $body$;$$, '42501', 'G13 update');
select pg_temp.err($$do $body$ begin set local role backup_reader; delete from public.services; end $body$;$$, '42501', 'G13 delete');
select pg_temp.err($$do $body$ begin set local role backup_reader; truncate public.services; end $body$;$$, '42501', 'G13 truncate');
select pg_temp.err($$do $body$ begin set local role backup_reader; create table public.g13_forbidden (id int); end $body$;$$, '42501', 'G13 create');
select pg_temp.err($$do $body$ begin set local role backup_reader; create temp table g13_temp (id int); end $body$;$$, '42501', 'G13 temp');
select pg_temp.err($$do $body$ begin set local role backup_reader; perform server_api.health(); end $body$;$$, '42501', 'G13 nao chama server_api');
select pg_temp.err($$do $body$ begin set local role backup_reader; perform ledger.post_journal_entry(gen_random_uuid(), 'payment', 'x', gen_random_uuid(), now(), '[]'::jsonb, null); end $body$;$$, '42501', 'G13 nao chama ledger');
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef
       and n.nspname in ('public_api', 'server_api', 'private', 'ledger')
       and has_function_privilege('backup_reader', p.oid, 'execute')
  ),
  'G13 sem execute em security definer nosso'
);

select * from finish();
rollback;
