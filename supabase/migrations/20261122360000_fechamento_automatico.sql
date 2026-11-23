-- Fechamento automático no horário de término.
--
-- O atendimento nascia 'confirmed' e só saía disso quando o barbeiro tocava em Concluir.
-- Quem esquecia ficava pendurado: não contava como concluído, não gerava BBT e a agenda
-- do dia seguinte carregava lixo do anterior.
--
-- Regra: passou do ends_at, vira 'completed' — o mesmo estado do botão Concluir, com as
-- mesmas consequências (libera o bloqueio do profissional e credita o BBT do atendimento).
-- Pagamento NÃO é automático: "aconteceu" e "entrou dinheiro" continuam sendo fatos
-- diferentes, e o caixa só registra o que o barbeiro confirma.

alter table public.appointments add column if not exists auto_completed_at timestamptz;

-- Índice para a varredura: só interessa quem está confirmado e já venceu.
create index if not exists appointments_a_fechar_idx
  on public.appointments (ends_at)
  where status = 'confirmed';

create or replace function server_api.fechar_atendimentos_vencidos(p_tenant uuid default null)
returns table (fechados integer, cashback_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_total integer := 0;
  v_credito bigint := 0;
begin
  select array_agg(x.id)
    into v_ids
    from (
      select a.id
        from public.appointments a
       where a.status = 'confirmed'
         and a.ends_at <= now()
         and (p_tenant is null or a.tenant_id = p_tenant)
       order by a.ends_at
       limit 500
    ) x;

  if v_ids is null then
    return query select 0, 0::bigint;
    return;
  end if;

  foreach v_id in array v_ids loop
    update public.appointments a
       set status = 'completed',
           auto_completed_at = now()
     where a.id = v_id
       and a.status = 'confirmed';

    if found then
      -- Sair de ativo tem de soltar o bloqueio: o constraint trigger
      -- private.check_appointment_busy recusa no commit um atendimento inativo que ainda
      -- segura o profissional.
      update public.staff_busy b set active = false where b.appointment_id = v_id;
      v_total := v_total + 1;

      -- BBT do atendimento. credit_cashback é idempotente por atendimento, então rodar a
      -- varredura duas vezes não duplica saldo. Contabilidade indisponível não pode
      -- derrubar o fechamento — o extrato do cliente é a fonte da verdade.
      begin
        v_credito := v_credito + coalesce(server_api.credit_cashback(v_id), 0);
      exception
        when others then null;
      end;
    end if;
  end loop;

  return query select v_total, v_credito;
end
$$;

revoke all on function server_api.fechar_atendimentos_vencidos(uuid) from public, anon, authenticated, backup_reader;
grant execute on function server_api.fechar_atendimentos_vencidos(uuid) to service_role;

-- A agenda do painel passa a dizer se o fechamento foi automático, para o barbeiro não
-- ficar sem saber quem concluiu. Assinatura e colunas preservadas; auto_completed_at entra
-- no fim.
drop function if exists server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid);

create or replace function server_api.panel_agenda(
  p_tenant uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff uuid default null
)
returns table (
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
  bbt_usado_cents bigint,
  auto_completed_at timestamptz
)
language sql
security definer
set search_path to ''
as $$
  select a.id, a.starts_at, a.ends_at, a.status, c.full_name, c.phone, s.name, st.display_name, a.staff_id,
         s.price_cents, coalesce(pg.amount_cents, 0)::bigint, pg.method,
         a.customer_id,
         coalesce(ca.balance_cents, 0)::bigint,
         coalesce((
           select sum(e.amount_cents) from public.cashback_entries e
            where e.appointment_id = a.id and e.kind = 'debit'
         ), 0)::bigint,
         a.auto_completed_at
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

revoke all on function server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated, backup_reader;
grant execute on function server_api.panel_agenda(uuid, timestamptz, timestamptz, uuid) to service_role;
