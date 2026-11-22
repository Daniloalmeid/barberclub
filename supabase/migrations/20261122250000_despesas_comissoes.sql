-- Despesas e comissões: transformar "entrou" em "sobrou".
--
-- Até aqui o painel mostrava dinheiro entrando e nunca dinheiro saindo. Faturamento sem
-- despesa é a mentira mais comum em gestão de barbearia — o dono acha que está lucrando.
--
-- Despesa: sai do caixa de verdade (D 5.9.01 Despesas operacionais, C 1.1.01 Caixa).
-- Comissão: é dívida com o barbeiro no momento em que o atendimento conclui, e só sai do
-- caixa quando é paga (D 2.1.01, C 1.1.01). Somar comissão como despesa na hora do
-- pagamento esconde que ela existe desde o atendimento.
--
-- A taxa da comissão mora em staff.commission_bps (base points: 4000 = 40%), coluna que
-- já existia e nunca era usada.

-- 0. A constraint da tabela também precisa aceitar despesa (a função tem lista própria,
-- e as duas precisam concordar — senão o lançamento morre no insert).
alter table ledger.journal_entries drop constraint if exists journal_entries_kind_check;
alter table ledger.journal_entries add constraint journal_entries_kind_check
  check (kind in ('payment', 'payment_unallocated', 'gateway_fee', 'settlement', 'commission',
                  'commission_payout', 'refund', 'platform_fee', 'reversal',
                  'cashback_credit', 'cashback_debit', 'expense'));

-- 1. O ledger precisa aceitar lançamento de despesa.
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
    'cashback_credit', 'cashback_debit', 'expense'
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

-- 2. Conta de despesa operacional.
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
    (p_tenant, '5.1.03', 'BBT concedido',             'expense'),
    (p_tenant, '5.9.01', 'Despesas operacionais',     'expense')
  on conflict do nothing;

  return (select count(*) from ledger.accounts a where a.tenant_id = p_tenant) - v_antes;
end
$$;

-- 3. Despesas.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  description text not null,
  category text not null,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'dinheiro',
  spent_on date not null default (now() at time zone 'utc')::date,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint expenses_category_check check (category in (
    'aluguel', 'produtos', 'energia', 'agua', 'internet', 'salario',
    'marketing', 'manutencao', 'impostos', 'outros'
  )),
  constraint expenses_method_check check (method in ('pix', 'dinheiro', 'cartao', 'boleto', 'outro'))
);

create index if not exists expenses_tenant_day_idx on public.expenses (tenant_id, spent_on);

alter table public.expenses enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'expenses_tenant_read') then
    create policy expenses_tenant_read on public.expenses
      for select to authenticated
      using (exists (
        select 1 from public.memberships m
         where m.tenant_id = expenses.tenant_id and m.user_id = auth.uid() and m.status = 'active'
      ));
  end if;
end
$$;

create or replace function server_api.add_expense(
  p_actor uuid,
  p_tenant uuid,
  p_description text,
  p_category text,
  p_amount_cents bigint,
  p_spent_on date,
  p_method text default 'dinheiro'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_desc text := btrim(coalesce(p_description, ''));
  v_cat text := lower(btrim(coalesce(p_category, 'outros')));
  v_met text := lower(btrim(coalesce(p_method, 'dinheiro')));
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if length(v_desc) < 2 or length(v_desc) > 120 then
    raise exception 'descricao_invalida' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;
  if p_spent_on is null then
    raise exception 'data_invalida' using errcode = '22023';
  end if;

  insert into public.expenses (tenant_id, description, category, amount_cents, method, spent_on, created_by)
  values (p_tenant, v_desc, v_cat, p_amount_cents, v_met, p_spent_on, p_actor)
  returning id into v_id;

  perform server_api.ensure_chart_of_accounts(p_tenant);
  perform ledger.post_journal_entry(
    p_tenant, 'expense', 'expense', v_id, (p_spent_on + time '12:00') at time zone 'America/Sao_Paulo',
    jsonb_build_array(
      jsonb_build_object('code', '5.9.01', 'debit_cents', p_amount_cents),
      jsonb_build_object('code', '1.1.01', 'credit_cents', p_amount_cents)
    ),
    v_cat || ': ' || v_desc
  );

  return v_id;
end
$$;

-- Cancelar em vez de apagar: o extrato do mês passado não pode mudar sozinho.
create or replace function server_api.cancel_expense(p_actor uuid, p_tenant uuid, p_expense uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  select * into v_row from public.expenses e
   where e.id = p_expense and e.tenant_id = p_tenant and e.cancelled_at is null;
  if v_row.id is null then
    raise exception 'despesa_nao_encontrada' using errcode = 'P0002';
  end if;

  update public.expenses set cancelled_at = now() where id = p_expense;

  perform ledger.post_journal_entry(
    p_tenant, 'reversal', 'expense', p_expense, now(),
    jsonb_build_array(
      jsonb_build_object('code', '1.1.01', 'debit_cents', v_row.amount_cents),
      jsonb_build_object('code', '5.9.01', 'credit_cents', v_row.amount_cents)
    ),
    'cancelamento de despesa: ' || v_row.description
  );

  return true;
end
$$;

create or replace function server_api.panel_expenses(p_tenant uuid, p_from date, p_to date)
returns table (
  expense_id uuid,
  description text,
  category text,
  amount_cents bigint,
  method text,
  spent_on date
)
language sql
security definer
set search_path = ''
as $$
  select e.id, e.description, e.category, e.amount_cents, e.method, e.spent_on
    from public.expenses e
   where e.tenant_id = p_tenant
     and e.cancelled_at is null
     and e.spent_on >= p_from and e.spent_on <= p_to
   order by e.spent_on desc, e.created_at desc;
$$;

-- 4. Comissões.
create or replace function server_api.set_commission(p_actor uuid, p_tenant uuid, p_staff uuid, p_bps integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if p_bps is null or p_bps < 0 or p_bps > 10000 then
    raise exception 'percentual_invalido' using errcode = '22023';
  end if;

  update public.staff st set commission_bps = p_bps
   where st.id = p_staff and st.tenant_id = p_tenant;
  if not found then
    raise exception 'profissional_nao_encontrado' using errcode = 'P0002';
  end if;
  return p_bps;
end
$$;

create or replace function server_api.panel_commissions(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  staff_id uuid,
  staff_name text,
  commission_bps integer,
  atendimentos bigint,
  base_cents bigint,
  comissao_cents bigint
)
language sql
security definer
set search_path = ''
as $$
  select st.id, st.display_name, coalesce(st.commission_bps, 0),
         count(a.id) filter (where a.status = 'completed'),
         coalesce(sum(s.price_cents) filter (where a.status = 'completed'), 0)::bigint,
         coalesce(floor(sum(s.price_cents) filter (where a.status = 'completed') * coalesce(st.commission_bps, 0) / 10000.0), 0)::bigint
    from public.staff st
    left join public.appointments a
      on a.staff_id = st.id and a.tenant_id = p_tenant
     and a.starts_at >= p_from and a.starts_at < p_to
    left join public.services s on s.id = a.service_id
   where st.tenant_id = p_tenant and st.active
   group by st.id, st.display_name, st.commission_bps
   order by st.display_name;
$$;

-- 5. O número que interessa: entrou, saiu, sobrou.
create or replace function server_api.panel_resultado(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  recebido_cents bigint,
  despesas_cents bigint,
  comissoes_cents bigint,
  bbt_concedido_cents bigint,
  sobrou_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec bigint;
  v_desp bigint;
  v_com bigint;
  v_bbt bigint;
begin
  select coalesce(sum(p.amount_cents), 0) into v_rec
    from public.payments p
   where p.tenant_id = p_tenant and p.status = 'paid'
     and p.paid_at >= p_from and p.paid_at < p_to;

  select coalesce(sum(e.amount_cents), 0) into v_desp
    from public.expenses e
   where e.tenant_id = p_tenant and e.cancelled_at is null
     and e.spent_on >= (p_from at time zone 'America/Sao_Paulo')::date
     and e.spent_on <= (p_to at time zone 'America/Sao_Paulo')::date;

  select coalesce(sum(r.comissao_cents), 0) into v_com
    from server_api.panel_commissions(p_tenant, p_from, p_to) r;

  select coalesce(sum(ce.amount_cents), 0) into v_bbt
    from public.cashback_entries ce
   where ce.tenant_id = p_tenant and ce.kind = 'credit'
     and ce.created_at >= p_from and ce.created_at < p_to;

  return query select v_rec, v_desp, v_com, v_bbt, (v_rec - v_desp - v_com);
end
$$;

revoke all on function server_api.add_expense(uuid, uuid, text, text, bigint, date, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.cancel_expense(uuid, uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_expenses(uuid, date, date) from public, anon, authenticated, backup_reader;
revoke all on function server_api.set_commission(uuid, uuid, uuid, integer) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_commissions(uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_resultado(uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;

grant execute on function server_api.add_expense(uuid, uuid, text, text, bigint, date, text) to service_role;
grant execute on function server_api.cancel_expense(uuid, uuid, uuid) to service_role;
grant execute on function server_api.panel_expenses(uuid, date, date) to service_role;
grant execute on function server_api.set_commission(uuid, uuid, uuid, integer) to service_role;
grant execute on function server_api.panel_commissions(uuid, timestamptz, timestamptz) to service_role;
grant execute on function server_api.panel_resultado(uuid, timestamptz, timestamptz) to service_role;

-- 6. Semeia a conta nova nas barbearias existentes.
do $$
declare
  r record;
begin
  for r in select t.id from public.tenants t loop
    perform server_api.ensure_chart_of_accounts(r.id);
  end loop;
end
$$;
