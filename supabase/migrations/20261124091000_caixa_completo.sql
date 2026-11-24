-- Correção: a versão anterior quebrou a função (faltou o FROM que liga a CTE pagos).
-- Restaura o corpo original inteiro e acrescenta as duas colunas novas no fim.

drop function if exists server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz);

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
           and not exists (select 1 from public.payments px where px.appointment_id = a.id and px.status = 'paid')
      ), 0)::bigint,
      coalesce((select ts.daily_revenue_goal_cents from public.tenant_settings ts where ts.tenant_id = p_tenant), 0)::bigint,
      -- A receber: atendimento do período (confirmado ou concluído) sem nenhum pagamento.
      coalesce((
        select sum(coalesce(a.price_cents, s.price_cents))
          from public.appointments a
          join public.services s on s.id = a.service_id
         where a.tenant_id = p_tenant
           and a.status in ('confirmed', 'completed')
           and a.starts_at >= p_from and a.starts_at < p_to
           and not exists (select 1 from public.payments px where px.appointment_id = a.id and px.status = 'paid')
      ), 0)::bigint,
      -- Já recebido antes: dinheiro de atendimentos do período que entrou fora da janela.
      coalesce((
        select sum(p.amount_cents)
          from public.payments p
          join public.appointments a on a.id = p.appointment_id
         where p.tenant_id = p_tenant
           and p.status = 'paid'
           and a.starts_at >= p_from and a.starts_at < p_to
           and p.paid_at < p_from
      ), 0)::bigint
    from (select 1) base
    left join pagos pa on true;
end
$$;

revoke all on function server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;
grant execute on function server_api.panel_financeiro(uuid, uuid, timestamptz, timestamptz) to service_role;
