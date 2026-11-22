-- Caixa: registrar o dinheiro que o cliente paga no balcão.
--
-- O desenho financeiro já existia e é de partida dobrada: um pagamento entra em
-- public.payments e private.post_payment lança no ledger (1.1.01 caixa contra 4.1.01
-- receita). Só que NADA criava as contas do plano de contas por barbearia — a tabela
-- ledger.accounts estava vazia, então todo lançamento morria em 'unknown account'.
-- Esta migration fecha isso e cria a porta de entrada do dinheiro manual.

create unique index if not exists accounts_tenant_code
  on ledger.accounts (tenant_id, code);

alter table public.payments
  add column if not exists method text
    check (method is null or method in ('pix', 'dinheiro', 'cartao', 'outro'));

-- Um atendimento recebe no máximo um pagamento pago: clique duplo não vira receita
-- dobrada.
create unique index if not exists payments_one_paid_per_appointment
  on public.payments (appointment_id) where status = 'paid';

-- Plano de contas mínimo. Idempotente: chamar de novo não duplica.
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
    (p_tenant, '4.1.01', 'Receita de serviços',       'revenue'),
    (p_tenant, '4.9.01', 'Outras receitas',           'revenue'),
    (p_tenant, '5.1.01', 'Taxas de gateway',          'expense'),
    (p_tenant, '5.1.02', 'Comissões',                 'expense')
  on conflict do nothing;

  return (select count(*) from ledger.accounts a where a.tenant_id = p_tenant) - v_antes;
end
$$;

-- Recebe o dinheiro de um atendimento. Não mexe no status do atendimento: quem diz
-- que o cliente foi atendido é o botão Concluir, e misturar as duas coisas faria
-- "recebi" virar "atendeu".
create or replace function server_api.record_payment(
  p_actor uuid,
  p_appointment uuid,
  p_method text,
  p_amount_cents bigint default null
) returns table (payment_id uuid, amount_cents bigint, method text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_price bigint;
  v_staff_user uuid;
  v_staff_id uuid;
  v_papel text;
  v_valor bigint;
  v_metodo text := lower(coalesce(nullif(btrim(p_method), ''), 'outro'));
  v_payment uuid;
begin
  select a.tenant_id, a.status, s.price_cents, a.staff_id
    into v_tenant, v_status, v_price, v_staff_id
    from public.appointments a
    left join public.services s on s.id = a.service_id
   where a.id = p_appointment;
  if v_tenant is null then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;

  select m.role into v_papel
    from public.memberships m
   where m.tenant_id = v_tenant and m.user_id = p_actor and m.status = 'active';
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_papel = 'staff' then
    select st.user_id into v_staff_user from public.staff st where st.id = v_staff_id;
    if v_staff_user is distinct from p_actor then
      raise exception 'sem_permissao' using errcode = '42501';
    end if;
  end if;

  if v_status not in ('confirmed', 'completed') then
    raise exception 'atendimento_nao_recebivel: %', v_status using errcode = '22023';
  end if;
  if v_metodo not in ('pix', 'dinheiro', 'cartao', 'outro') then
    raise exception 'meio_invalido' using errcode = '22023';
  end if;

  v_valor := coalesce(p_amount_cents, v_price);
  if v_valor is null or v_valor <= 0 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;

  perform server_api.ensure_chart_of_accounts(v_tenant);

  insert into public.payments (tenant_id, appointment_id, amount_cents, fee_cents, status, provider, method, paid_at)
  values (v_tenant, p_appointment, v_valor, 0, 'paid', 'manual', v_metodo, now())
  returning id into v_payment;

  perform private.post_payment(v_tenant, v_payment, 'revenue');

  return query select v_payment, v_valor, v_metodo;
end
$$;

-- Financeiro do período: o que entrou de verdade, por meio, e a meta do dia.
create or replace function server_api.panel_financeiro(
  p_tenant uuid,
  p_actor uuid,
  p_from timestamptz,
  p_to timestamptz
) returns table (
  recebido_cents bigint,
  pagamentos bigint,
  ticket_medio_cents bigint,
  pix_cents bigint,
  dinheiro_cents bigint,
  cartao_cents bigint,
  outros_cents bigint,
  concluidos_cents bigint,
  sem_pagamento bigint,
  meta_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text;
begin
  select m.role into v_papel
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active';
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  return query
    with pagos as (
      select p.amount_cents, p.method
        from public.payments p
       where p.tenant_id = p_tenant
         and p.status = 'paid'
         and p.paid_at >= p_from and p.paid_at < p_to
    )
    select
      coalesce(sum(pa.amount_cents), 0)::bigint,
      count(pa.*)::bigint,
      case when count(pa.*) > 0 then (coalesce(sum(pa.amount_cents), 0) / count(pa.*))::bigint else 0::bigint end,
      coalesce(sum(pa.amount_cents) filter (where pa.method = 'pix'), 0)::bigint,
      coalesce(sum(pa.amount_cents) filter (where pa.method = 'dinheiro'), 0)::bigint,
      coalesce(sum(pa.amount_cents) filter (where pa.method = 'cartao'), 0)::bigint,
      coalesce(sum(pa.amount_cents) filter (where pa.method is null or pa.method = 'outro'), 0)::bigint,
      coalesce((
        select sum(s.price_cents)
          from public.appointments a
          join public.services s on s.id = a.service_id
         where a.tenant_id = p_tenant
           and a.status = 'completed'
           and a.starts_at >= p_from and a.starts_at < p_to
      ), 0)::bigint,
      coalesce((
        select count(*)
          from public.appointments a
         where a.tenant_id = p_tenant
           and a.status = 'completed'
           and a.starts_at >= p_from and a.starts_at < p_to
           and not exists (select 1 from public.payments px where px.appointment_id = a.id and px.status = 'paid')
      ), 0)::bigint,
      coalesce((select ts.daily_revenue_goal_cents from public.tenant_settings ts where ts.tenant_id = p_tenant), 0)::bigint
    from (select 1) base
    left join pagos pa on true;
end
$$;

revoke all on function server_api.ensure_chart_of_accounts(uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.record_payment(uuid, uuid, text, bigint) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;

grant execute on function server_api.ensure_chart_of_accounts(uuid) to service_role;
grant execute on function server_api.record_payment(uuid, uuid, text, bigint) to service_role;
grant execute on function server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz) to service_role;

-- Toda barbearia existente passa a ter o plano de contas.
do $seed$
declare
  r record;
begin
  for r in select id from public.tenants loop
    perform server_api.ensure_chart_of_accounts(r.id);
  end loop;
end
$seed$;
