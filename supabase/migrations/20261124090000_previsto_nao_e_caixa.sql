-- "Previsto em caixa" era um nome mentiroso.
--
-- O número somava o PREÇO DE TABELA dos atendimentos do dia (confirmados + concluídos) e
-- aparecia com o rótulo de caixa. No dia 24/11 ele mostrava R$ 185,00 enquanto o caixa
-- mostrava R$ 0,00 — e os dois estavam certos:
--
--   6 atendimentos hoje · 1 falta
--   4 concluídos sem pagamento registrado ............ R$ 135,00 a receber
--   1 atendimento cujo dinheiro entrou em 22/11 ...... R$  45,00 já recebidos
--   preço de tabela do dia (o "previsto") ............ R$ 185,00
--
-- O que faltava era separar as três coisas. Agora o resumo devolve:
--   faturamento_cents   preço de tabela (o que os atendimentos valem)
--   a_receber_cents     atendimentos do dia sem nenhum pagamento registrado
--   pago_antes_cents    dinheiro de atendimentos do dia que entrou ANTES da janela

drop function if exists server_api.panel_resumo(uuid, timestamptz, timestamptz);

create or replace function server_api.panel_resumo(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  total bigint,
  confirmados bigint,
  concluidos bigint,
  cancelados bigint,
  faturamento_cents bigint,
  a_receber_cents bigint,
  pago_antes_cents bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (where a.status = 'confirmed')::bigint,
    count(*) filter (where a.status = 'completed')::bigint,
    count(*) filter (where a.status in ('canceled', 'no_show', 'expired'))::bigint,
    coalesce(sum(coalesce(a.price_cents, s.price_cents)) filter (where a.status in ('confirmed', 'completed')), 0)::bigint,
    coalesce(sum(coalesce(a.price_cents, s.price_cents)) filter (
      where a.status in ('confirmed', 'completed')
        and not exists (
          select 1 from public.payments p
           where p.appointment_id = a.id and p.status = 'paid'
        )
    ), 0)::bigint,
    coalesce((
      select sum(p.amount_cents)
        from public.payments p
        join public.appointments a2 on a2.id = p.appointment_id
       where p.tenant_id = p_tenant
         and p.status = 'paid'
         and a2.starts_at >= p_from and a2.starts_at < p_to
         and p.paid_at < p_from
    ), 0)::bigint
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.tenant_id = p_tenant
    and a.starts_at >= p_from
    and a.starts_at < p_to;
$$;

revoke all on function server_api.panel_resumo(uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;
grant execute on function server_api.panel_resumo(uuid, timestamptz, timestamptz) to service_role;

-- O caixa ganha as mesmas duas linhas, para a conta fechar na tela.
drop function if exists server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz);

create or replace function server_api.panel_financeiro(p_tenant uuid, p_actor uuid, p_from timestamptz, p_to timestamptz)
returns table (
  recebido_cents bigint,
  pagamentos bigint,
  ticket_medio_cents bigint,
  pix_cents bigint,
  dinheiro_cents bigint,
  cartao_cents bigint,
  outros_cents bigint,
  concluidos_cents bigint,
  sem_pagamento bigint,
  meta_cents bigint,
  a_receber_cents bigint,
  pago_antes_cents bigint
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
        select sum(coalesce(a.price_cents, s.price_cents))
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
           and not exists (
             select 1 from public.payments p
              where p.appointment_id = a.id and p.status = 'paid'
           )
      ), 0)::bigint,
      coalesce((select ts.meta_cents from public.tenant_settings ts where ts.tenant_id = p_tenant), 0)::bigint,
      coalesce((
        select sum(coalesce(a.price_cents, s.price_cents))
          from public.appointments a
          join public.services s on s.id = a.service_id
         where a.tenant_id = p_tenant
           and a.status in ('confirmed', 'completed')
           and a.starts_at >= p_from and a.starts_at < p_to
           and not exists (
             select 1 from public.payments p
              where p.appointment_id = a.id and p.status = 'paid'
           )
      ), 0)::bigint,
      coalesce((
        select sum(p.amount_cents)
          from public.payments p
          join public.appointments a on a.id = p.appointment_id
         where p.tenant_id = p_tenant
           and p.status = 'paid'
           and a.starts_at >= p_from and a.starts_at < p_to
           and p.paid_at < p_from
      ), 0)::bigint;
end
$$;

revoke all on function server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;
grant execute on function server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz) to service_role;
