-- BBT saindo: o cliente gasta o que acumulou.
--
-- Até aqui o programa de fidelidade só somava. A /conta do cliente prometia "use na
-- próxima visita, no balcão" e não havia como o balcão descontar. Promessa na tela sem
-- entrega é pior que não ter programa.
--
-- Contabilmente o BBT é passivo, não desconto solto: ao conceder, a barbearia assume a
-- obrigação de dar desconto depois. O regime certo é
--   conceder:  D 5.1.03 BBT concedido   C 2.1.03 BBT a resgatar
--   resgatar:  D 2.1.03 BBT a resgatar  C 4.1.01 Receita de serviços
-- Assim a receita do serviço fica inteira (parte em dinheiro, parte em BBT) e o dono
-- enxerga quanto já prometeu dar. Tratar como desconto no ato esconderia esse passivo.
--
-- Regras decididas: não vence · uso parcial permitido · até 100% do serviço ·
-- não credita cashback sobre a parte paga em BBT · um resgate por atendimento.

-- 0. O plano do ledger não previa movimento de BBT: sem isso o lançamento é recusado
-- com "invalid journal kind" e o débito do cliente aconteceria sem contrapartida.
alter table ledger.journal_entries drop constraint if exists journal_entries_kind_check;
alter table ledger.journal_entries add constraint journal_entries_kind_check
  check (kind in ('payment', 'payment_unallocated', 'gateway_fee', 'settlement', 'commission',
                  'commission_payout', 'refund', 'platform_fee', 'reversal',
                  'cashback_credit', 'cashback_debit'));

-- 1b. A função do ledger também tem lista própria de tipos — recriada com os dois novos.
create or replace function ledger.post_journal_entry(
  p_tenant uuid,
  p_kind text,
  p_source_type text,
  p_source_id uuid,
  p_occurred_at timestamptz,
  p_lines jsonb,
  p_memo text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_prev bytea;
  v_hash bytea;
  v_canonical text;
  v_line jsonb;
  v_account uuid;
  v_debit bigint;
  v_credit bigint;
  v_sum_d bigint := 0;
  v_sum_c bigint := 0;
  v_n integer := 0;
  v_reverses uuid;
begin
  if p_kind not in (
    'payment', 'payment_unallocated', 'gateway_fee', 'settlement',
    'commission', 'commission_payout', 'refund', 'platform_fee', 'reversal',
    'cashback_credit', 'cashback_debit'
  ) then
    raise exception 'invalid journal kind' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger:' || p_tenant::text, 0));

  v_canonical := concat_ws(
    '|',
    p_tenant::text,
    p_kind,
    p_source_type,
    p_source_id::text,
    to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(p_memo, '')
  );

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_debit := coalesce((v_line ->> 'debit_cents')::bigint, 0);
    v_credit := coalesce((v_line ->> 'credit_cents')::bigint, 0);
    if (v_debit > 0) = (v_credit > 0) or v_debit < 0 or v_credit < 0 then
      raise exception 'line must be debit xor credit' using errcode = '23514';
    end if;
    if v_line ? 'account_id' then
      v_account := (v_line ->> 'account_id')::uuid;
    else
      select a.id into v_account
        from ledger.accounts a
       where a.tenant_id = p_tenant
         and a.code = v_line ->> 'code';
      if v_account is null then
        raise exception 'unknown account' using errcode = '23503';
      end if;
    end if;
    v_sum_d := v_sum_d + v_debit;
    v_sum_c := v_sum_c + v_credit;
    v_n := v_n + 1;
    v_canonical := v_canonical || '|' || v_account::text || ':' || v_debit::text || ':' || v_credit::text;
  end loop;

  if v_n < 2 or v_sum_d <> v_sum_c then
    raise exception 'journal entry is not balanced' using errcode = '23514';
  end if;

  select e.entry_hash into v_prev
    from ledger.journal_entries e
   where e.tenant_id = p_tenant
   order by e.created_at desc, e.id desc
   limit 1;

  v_hash := extensions.digest(
    coalesce(v_prev, ''::bytea) || convert_to(v_canonical, 'UTF8'),
    'sha256'
  );

  v_reverses := nullif(current_setting('barberclub.reverses_entry', true), '')::uuid;

  insert into ledger.journal_entries (
    tenant_id, occurred_at, kind, source_type, source_id,
    reverses_entry_id, memo, created_by, prev_hash, entry_hash
  ) values (
    p_tenant, p_occurred_at, p_kind, p_source_type, p_source_id,
    v_reverses,
    p_memo,
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid,
    v_prev,
    v_hash
  )
  returning id into v_entry;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_debit := coalesce((v_line ->> 'debit_cents')::bigint, 0);
    v_credit := coalesce((v_line ->> 'credit_cents')::bigint, 0);
    if v_line ? 'account_id' then
      v_account := (v_line ->> 'account_id')::uuid;
    else
      select a.id into v_account
        from ledger.accounts a
       where a.tenant_id = p_tenant
         and a.code = v_line ->> 'code';
    end if;
    insert into ledger.journal_lines (tenant_id, entry_id, account_id, debit_cents, credit_cents)
    values (p_tenant, v_entry, v_account, v_debit, v_credit);
  end loop;

  return v_entry;
end
$$;

-- 1. Duas contas novas no plano de contas.
create or replace function server_api.ensure_chart_of_accounts(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes integer;
begin
  select count(*) into v_antes from ledger.accounts a where a.tenant_id = p_tenant;

  insert into ledger.accounts (tenant_id, code, name, type)
  values
    (p_tenant, '1.1.01', 'Caixa',                     'asset'),
    (p_tenant, '1.1.02', 'Banco',                     'asset'),
    (p_tenant, '1.1.03', 'Valores a receber',         'asset'),
    (p_tenant, '2.1.01', 'Comissões a pagar',         'liability'),
    (p_tenant, '2.1.02', 'Reembolsos a pagar',        'liability'),
    (p_tenant, '2.1.03', 'BBT a resgatar',            'liability'),
    (p_tenant, '4.1.01', 'Receita de serviços',       'revenue'),
    (p_tenant, '4.9.01', 'Outras receitas',           'revenue'),
    (p_tenant, '5.1.01', 'Taxas de gateway',          'expense'),
    (p_tenant, '5.1.02', 'Comissões',                 'expense'),
    (p_tenant, '5.1.03', 'BBT concedido',             'expense')
  on conflict do nothing;

  return (select count(*) from ledger.accounts a where a.tenant_id = p_tenant) - v_antes;
end
$$;

-- 2. Um resgate por atendimento: clique duplo não gasta duas vezes.
create unique index if not exists cashback_one_debit_per_appointment
  on public.cashback_entries (appointment_id)
  where kind = 'debit' and appointment_id is not null;

-- 3. Conceder agora lança o passivo.
create or replace function server_api.credit_cashback(p_appointment uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_status text;
  v_price bigint;
  v_percent numeric;
  v_valor bigint;
  v_inserido bigint;
begin
  select a.tenant_id, a.customer_id, a.status, s.price_cents
    into v_tenant, v_customer, v_status, v_price
    from public.appointments a
    left join public.services s on s.id = a.service_id
   where a.id = p_appointment;

  if v_tenant is null then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'completed' then
    raise exception 'atendimento_nao_concluido' using errcode = '22023';
  end if;

  select ts.cashback_percent into v_percent from public.tenant_settings ts where ts.tenant_id = v_tenant;
  v_percent := coalesce(v_percent, 0);
  v_valor := floor(coalesce(v_price, 0) * v_percent / 100)::bigint;
  if v_valor <= 0 then
    return 0;
  end if;

  -- O lançamento é a fonte da verdade: se o índice único recusou (já creditado), não
  -- pode somar no saldo — senão vira cashback fantasma.
  insert into public.cashback_entries (tenant_id, customer_id, appointment_id, kind, amount_cents, memo)
  values (v_tenant, v_customer, p_appointment, 'credit', v_valor, 'cashback do atendimento')
  on conflict do nothing
  returning amount_cents into v_inserido;

  if v_inserido is null then
    return 0;
  end if;

  insert into public.cashback_accounts (tenant_id, customer_id, balance_cents)
  values (v_tenant, v_customer, v_inserido)
  on conflict (tenant_id, customer_id) do update
     set balance_cents = public.cashback_accounts.balance_cents + excluded.balance_cents,
         updated_at = now();

  begin
    perform server_api.ensure_chart_of_accounts(v_tenant);
    perform ledger.post_journal_entry(
      v_tenant,
      'cashback_credit',
      'cashback_entry',
      p_appointment,
      now(),
      jsonb_build_array(
        jsonb_build_object('code', '5.1.03', 'debit_cents', v_inserido),
        jsonb_build_object('code', '2.1.03', 'credit_cents', v_inserido)
      ),
      'BBT concedido no atendimento'
    );
  exception
    when others then
      -- Contabilidade indisponível não pode desfazer o crédito do cliente: o saldo já
      -- foi gravado e o extrato é a fonte da verdade.
      null;
  end;

  return v_inserido;
end
$$;

-- 4. Gastar o BBT.
create or replace function server_api.debit_cashback(
  p_actor uuid,
  p_tenant uuid,
  p_customer uuid,
  p_amount_cents bigint,
  p_appointment uuid,
  p_reason text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text;
  v_staff_user uuid;
  v_saldo bigint;
  v_preco bigint;
  v_cliente_appt uuid;
  v_staff_appt uuid;
  v_tenant_appt uuid;
  v_inserido bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;

  select a.tenant_id, a.customer_id, a.staff_id, coalesce(s.price_cents, 0)
    into v_tenant_appt, v_cliente_appt, v_staff_appt, v_preco
    from public.appointments a
    left join public.services s on s.id = a.service_id
   where a.id = p_appointment;
  if v_tenant_appt is null or v_tenant_appt <> p_tenant then
    raise exception 'atendimento_invalido' using errcode = '22023';
  end if;
  if p_customer is not null and v_cliente_appt <> p_customer then
    raise exception 'atendimento_invalido' using errcode = '22023';
  end if;
  -- O cliente pode vir do próprio atendimento: o balcão só conhece o agendamento.
  p_customer := coalesce(p_customer, v_cliente_appt);

  select m.role into v_papel
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active';
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_papel = 'staff' then
    select st.user_id into v_staff_user from public.staff st where st.id = v_staff_appt;
    if v_staff_user is distinct from p_actor then
      raise exception 'sem_permissao' using errcode = '42501';
    end if;
  end if;

  -- Teto de 100% do serviço: sem isso, saldo grande vira corte de graça e o barbeiro
  -- não vê dinheiro entrar.
  if v_preco > 0 and p_amount_cents > v_preco then
    raise exception 'acima_do_valor_do_servico' using errcode = '22023';
  end if;

  select ca.balance_cents into v_saldo
    from public.cashback_accounts ca
   where ca.tenant_id = p_tenant and ca.customer_id = p_customer
   for update;

  if coalesce(v_saldo, 0) < p_amount_cents then
    raise exception 'saldo_insuficiente: % de %', coalesce(v_saldo, 0), p_amount_cents using errcode = '22023';
  end if;

  begin
    insert into public.cashback_entries (tenant_id, customer_id, appointment_id, kind, amount_cents, memo)
    values (p_tenant, p_customer, p_appointment, 'debit', p_amount_cents,
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'BBT usado no atendimento'))
    returning amount_cents into v_inserido;
  exception
    when unique_violation then
      raise exception 'resgate_ja_registrado' using errcode = '23P01';
  end;

  update public.cashback_accounts ca
     set balance_cents = ca.balance_cents - p_amount_cents,
         updated_at = now()
   where ca.tenant_id = p_tenant and ca.customer_id = p_customer;

  begin
    perform server_api.ensure_chart_of_accounts(p_tenant);
    perform ledger.post_journal_entry(
      p_tenant,
      'cashback_debit',
      'cashback_entry',
      p_appointment,
      now(),
      jsonb_build_array(
        jsonb_build_object('code', '2.1.03', 'debit_cents', p_amount_cents),
        jsonb_build_object('code', '4.1.01', 'credit_cents', p_amount_cents)
      ),
      'BBT usado como pagamento'
    );
  exception
    when others then
      null;
  end;

  return v_inserido;
end
$$;

-- 5. Extrato do cliente: crédito e débito, com data.
create or replace function server_api.customer_cashback_extrato(p_tenant uuid, p_user uuid)
returns table (kind text, amount_cents bigint, memo text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select e.kind, e.amount_cents, e.memo, e.created_at
    from public.cashback_entries e
    join public.customers c on c.id = e.customer_id
   where e.tenant_id = p_tenant and c.user_id = p_user
   order by e.created_at desc
   limit 30;
$$;

-- 6. A agenda passa a saber o saldo do cliente e o id dele.
drop function if exists server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid);
create or replace function server_api.panel_agenda(
  p_tenant uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff uuid default null
) returns table (
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  customer_name text,
  customer_phone text,
  service_name text,
  staff_name text,
  staff_id uuid,
  price_cents bigint,
  pago_cents bigint,
  metodo text,
  customer_id uuid,
  bbt_cents bigint,
  bbt_usado_cents bigint
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.starts_at, a.ends_at, a.status, c.full_name, c.phone, s.name, st.display_name, a.staff_id,
         s.price_cents, coalesce(pg.amount_cents, 0)::bigint, pg.method,
         a.customer_id,
         coalesce(ca.balance_cents, 0)::bigint,
         coalesce((
           select sum(e.amount_cents) from public.cashback_entries e
            where e.appointment_id = a.id and e.kind = 'debit'
         ), 0)::bigint
    from public.appointments a
    left join public.customers c on c.id = a.customer_id
    left join public.services s on s.id = a.service_id
    left join public.staff st on st.id = a.staff_id
    left join public.cashback_accounts ca on ca.tenant_id = a.tenant_id and ca.customer_id = a.customer_id
    left join lateral (
      select p.amount_cents, p.method
        from public.payments p
       where p.appointment_id = a.id and p.status = 'paid'
       order by p.paid_at desc nulls last
       limit 1
    ) pg on true
   where a.tenant_id = p_tenant
     and a.starts_at >= p_from
     and a.starts_at < p_to
     and (p_staff is null or a.staff_id = p_staff)
   order by a.starts_at;
$$;

revoke all on function server_api.debit_cashback(uuid, uuid, uuid, bigint, uuid, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.customer_cashback_extrato(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated, backup_reader;
grant execute on function server_api.debit_cashback(uuid, uuid, uuid, bigint, uuid, text) to service_role;
grant execute on function server_api.customer_cashback_extrato(uuid, uuid) to service_role;
grant execute on function server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid) to service_role;

-- 7. Semeia as contas novas nas barbearias que já existem.
do $$
declare
  r record;
begin
  for r in select t.id from public.tenants t loop
    perform server_api.ensure_chart_of_accounts(r.id);
  end loop;
end
$$;

-- 8. Créditos anteriores à criação do passivo nunca lançaram a obrigação. Sem este
-- ajuste o passivo mostraria menos do que a barbearia deve em BBT.
do $$
declare
  r record;
begin
  for r in
    select e.tenant_id, e.appointment_id, sum(e.amount_cents) as total
      from public.cashback_entries e
     where e.kind = 'credit'
       and e.appointment_id is not null
       and not exists (
         select 1 from ledger.journal_entries je
          where je.source_id = e.appointment_id and je.kind = 'cashback_credit'
       )
     group by e.tenant_id, e.appointment_id
  loop
    perform ledger.post_journal_entry(
      r.tenant_id, 'cashback_credit', 'cashback_entry', r.appointment_id, now(),
      jsonb_build_array(
        jsonb_build_object('code', '5.1.03', 'debit_cents', r.total),
        jsonb_build_object('code', '2.1.03', 'credit_cents', r.total)
      ),
      'BBT concedido (ajuste retroativo)'
    );
  end loop;
end
$$;
