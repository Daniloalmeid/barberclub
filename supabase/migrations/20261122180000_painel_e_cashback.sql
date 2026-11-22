-- Painel do barbeiro e cashback do cliente.
--
-- Não existia nada de fidelidade no banco: nem conta, nem lançamento, nem coluna de
-- percentual. E o painel precisava de leitura de agenda por tenant com permissão
-- verificada — hoje memberships existe, mas nada checava o papel de quem age.
--
-- Regra do cashback: crédito só em atendimento CONCLUÍDO, um por atendimento, sobre o
-- preço do serviço no momento da conclusão. Percentual configurável por barbearia
-- (tenant_settings.cashback_percent), default 0 = desligado. Nada de cashback em
-- reserva cancelada, faltou ou expirada.

alter table public.tenant_settings
  add column if not exists cashback_percent numeric(5, 2) not null default 0
    check (cashback_percent >= 0 and cashback_percent <= 100);

create table if not exists public.cashback_accounts (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, customer_id)
);

create table if not exists public.cashback_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  kind text not null check (kind in ('credit', 'debit')),
  amount_cents bigint not null check (amount_cents > 0),
  memo text,
  created_at timestamptz not null default now()
);

-- Um crédito por atendimento: chamar duas vezes não paga duas vezes.
create unique index if not exists cashback_credit_once
  on public.cashback_entries (appointment_id) where kind = 'credit';
create index if not exists cashback_entries_por_cliente
  on public.cashback_entries (tenant_id, customer_id, created_at desc);

alter table public.cashback_accounts enable row level security;
alter table public.cashback_entries enable row level security;
revoke all on public.cashback_accounts from public, anon, authenticated;
revoke all on public.cashback_entries from public, anon, authenticated;
grant select on public.cashback_accounts to backup_reader;
grant select on public.cashback_entries to backup_reader;

-- ---------- painel ----------

-- Papel de quem está logado nesta barbearia. Só conta membership ativa: convite não
-- aceito e acesso revogado não abrem o painel.
create or replace function server_api.panel_role(p_tenant uuid, p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select m.role
    from public.memberships m
   where m.tenant_id = p_tenant
     and m.user_id = p_user
     and m.status = 'active'
   limit 1;
$$;

create or replace function server_api.panel_agenda(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  customer_name text,
  customer_phone text,
  service_name text,
  staff_name text,
  price_cents bigint
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.starts_at, a.ends_at, a.status, c.full_name, c.phone, s.name, st.display_name, s.price_cents
    from public.appointments a
    left join public.customers c on c.id = a.customer_id
    left join public.services s on s.id = a.service_id
    left join public.staff st on st.id = a.staff_id
   where a.tenant_id = p_tenant
     and a.starts_at >= p_from
     and a.starts_at < p_to
   order by a.starts_at;
$$;

create or replace function server_api.panel_resumo(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  total bigint,
  confirmados bigint,
  concluidos bigint,
  cancelados bigint,
  faturamento_cents bigint
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
    coalesce(sum(s.price_cents) filter (where a.status in ('confirmed', 'completed')), 0)::bigint
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.tenant_id = p_tenant
    and a.starts_at >= p_from
    and a.starts_at < p_to;
$$;

-- Mudança de status com o ator verificado aqui dentro. O servidor chama com a chave
-- secreta, então a checagem não pode ficar só na aplicação: a função confere o papel
-- e, para staff, se o atendimento é dele.
create or replace function server_api.set_appointment_status(
  p_actor uuid,
  p_appointment uuid,
  p_status text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_atual text;
  v_papel text;
  v_staff_id uuid;
  v_staff_user uuid;
  v_permitido boolean;
begin
  -- FOR UPDATE não pode ser aplicado ao lado anulável de um outer join: primeiro
  -- travamos a linha do atendimento, depois lemos o dono do profissional.
  select a.tenant_id, a.status, a.staff_id
    into v_tenant, v_atual, v_staff_id
    from public.appointments a
   where a.id = p_appointment
   for update;

  select st.user_id into v_staff_user from public.staff st where st.id = v_staff_id;

  if v_tenant is null then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;

  select server_api.panel_role(v_tenant, p_actor) into v_papel;
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_papel = 'staff' and v_staff_user is distinct from p_actor then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  -- transições aceitas
  v_permitido := case
    when p_status = v_atual then true
    when v_atual = 'hold' and p_status in ('confirmed', 'canceled') then true
    when v_atual = 'confirmed' and p_status in ('completed', 'canceled', 'no_show') then true
    when v_atual = 'pending_payment' and p_status in ('confirmed', 'canceled') then true
    else false
  end;
  if not v_permitido then
    raise exception 'transicao_invalida: % -> %', v_atual, p_status using errcode = '22023';
  end if;

  update public.appointments a
     set status = p_status,
         hold_expires_at = case when p_status = 'confirmed' then null else a.hold_expires_at end
   where a.id = p_appointment;

  -- Ao sair de ativo (concluído, cancelado, faltou), o bloqueio da agenda tem de cair:
  -- o constraint trigger private.check_appointment_busy recusa no commit um atendimento
  -- inativo que ainda segura o profissional.
  if p_status not in ('hold', 'pending_payment', 'confirmed') then
    update public.staff_busy b set active = false where b.appointment_id = p_appointment;
  end if;

  return p_status;
end
$$;

-- Crédito de cashback do atendimento concluído. Idempotente pelo índice único.
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
  -- pode somar no saldo. Antes desta correção o saldo somava duas vezes com um único
  -- lançamento gravado — cashback fantasma.
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

  return v_inserido;
end
$$;

create or replace function server_api.customer_cashback(p_tenant uuid, p_user uuid)
returns table (balance_cents bigint, entries jsonb)
language sql
security definer
set search_path = ''
as $$
  select
    coalesce((
      select a.balance_cents from public.cashback_accounts a
       join public.customers c on c.id = a.customer_id
      where a.tenant_id = p_tenant and c.user_id = p_user
    ), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', e.kind,
               'amount_cents', e.amount_cents,
               'memo', e.memo,
               'created_at', e.created_at) order by e.created_at desc)
        from public.cashback_entries e
        join public.customers c on c.id = e.customer_id
       where e.tenant_id = p_tenant and c.user_id = p_user
    ), '[]'::jsonb);
$$;

revoke all on function server_api.panel_role(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_agenda(uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_resumo(uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;
revoke all on function server_api.set_appointment_status(uuid, uuid, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.credit_cashback(uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.customer_cashback(uuid, uuid) from public, anon, authenticated, backup_reader;

grant execute on function server_api.panel_role(uuid, uuid) to service_role;
grant execute on function server_api.panel_agenda(uuid, timestamptz, timestamptz) to service_role;
grant execute on function server_api.panel_resumo(uuid, timestamptz, timestamptz) to service_role;
grant execute on function server_api.set_appointment_status(uuid, uuid, text) to service_role;
grant execute on function server_api.credit_cashback(uuid) to service_role;
grant execute on function server_api.customer_cashback(uuid, uuid) to service_role;
