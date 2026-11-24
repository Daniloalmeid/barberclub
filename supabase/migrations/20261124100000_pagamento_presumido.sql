-- Fechamento automático presume pagamento.
--
-- Antes: passou do horário, o atendimento virava 'completed' e o dinheiro ficava em aberto
-- para sempre se o barbeiro esquecesse de lançar. A caixa do dia fechava no zero.
--
-- Agora: ao fechar automaticamente, o sistema registra o pagamento presumido (meio 'outro',
-- provedor 'auto', valor = preço do atendimento menos o BBT usado). O pagamento nasce
-- marcado como automático de propósito — é presunção, não fato, e por isso pode ser
-- desfeito: "Não veio (estornar BBT)" também estorna esse pagamento.
--
-- Pagamento lançado à mão nunca é estornado por aqui. O automático é o único revisável.

create or replace function server_api.fechar_com_pagamento(p_appointment uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_price bigint;
  v_bbt bigint;
  v_valor bigint;
  v_payment uuid;
begin
  select a.tenant_id, a.status, coalesce(a.price_cents, s.price_cents)
    into v_tenant, v_status, v_price
    from public.appointments a
    left join public.services s on s.id = a.service_id
   where a.id = p_appointment
   for update of a;

  if v_tenant is null then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if v_status not in ('confirmed', 'completed') then
    raise exception 'atendimento_nao_recebivel: %', v_status using errcode = '22023';
  end if;

  -- Já tem dinheiro registrado: não presume nada em cima.
  if exists (
    select 1 from public.payments p
     where p.appointment_id = p_appointment
       and p.status in ('paid', 'paid_unallocated')
  ) then
    return 0;
  end if;

  -- BBT gasto neste atendimento abate do valor (já virou receita no resgate).
  select coalesce(sum(e.amount_cents), 0) into v_bbt
    from public.cashback_entries e
   where e.appointment_id = p_appointment and e.kind = 'debit';

  v_valor := greatest(0, coalesce(v_price, 0) - v_bbt);
  if v_valor <= 0 then
    return 0;
  end if;

  perform server_api.ensure_chart_of_accounts(v_tenant);

  insert into public.payments (tenant_id, appointment_id, amount_cents, fee_cents, status, provider, method, paid_at)
  values (v_tenant, p_appointment, v_valor, 0, 'paid', 'auto', 'outro', now())
  returning id into v_payment;

  perform private.post_payment(v_tenant, v_payment, 'revenue');

  return v_valor;
end
$$;

-- Estorno do pagamento presumido. Só vale para provedor 'auto'.
create or replace function server_api.estornar_pagamento_auto(p_appointment uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_valor bigint;
  v_provider text;
  v_tenant uuid;
begin
  select p.id, p.amount_cents, p.provider, p.tenant_id
    into v_id, v_valor, v_provider, v_tenant
    from public.payments p
   where p.appointment_id = p_appointment
     and p.status = 'paid'
   for update of p;

  if v_id is null then
    return 0;
  end if;
  if coalesce(v_provider, 'manual') <> 'auto' then
    raise exception 'pagamento_manual_nao_estorna' using errcode = '22023';
  end if;

  update public.payments p set status = 'refunded' where p.id = v_id;

  begin
    perform ledger.post_journal_entry(
      v_tenant,
      'reversal',
      'payment',
      v_id,
      now(),
      jsonb_build_array(
        jsonb_build_object('code', '4.1.01', 'debit_cents', v_valor, 'credit_cents', 0),
        jsonb_build_object('code', '1.1.01', 'debit_cents', 0, 'credit_cents', v_valor)
      ),
      'Estorno de pagamento presumido (cliente não compareceu)'
    );
  exception
    when others then null;
  end;

  return v_valor;
end
$$;

-- Varredura: fecha, solta o bloqueio, credita o BBT e presume o pagamento.
-- A coluna nova muda o tipo de retorno: precisa dropar antes.
drop function if exists server_api.fechar_atendimentos_vencidos(uuid);

create or replace function server_api.fechar_atendimentos_vencidos(p_tenant uuid default null)
returns table (fechados integer, cashback_cents bigint, presumido_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_total integer := 0;
  v_credito bigint := 0;
  v_pago bigint := 0;
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
    return query select 0, 0::bigint, 0::bigint;
    return;
  end if;

  foreach v_id in array v_ids loop
    update public.appointments a
       set status = 'completed',
           auto_completed_at = now()
     where a.id = v_id
       and a.status = 'confirmed';

    if found then
      update public.staff_busy b set active = false where b.appointment_id = v_id;
      v_total := v_total + 1;

      begin
        v_credito := v_credito + coalesce(server_api.credit_cashback(v_id), 0);
      exception
        when others then null;
      end;

      -- Presunção de pagamento: o barbeiro não lançou, o dia não pode fechar vazio.
      begin
        v_pago := v_pago + coalesce(server_api.fechar_com_pagamento(v_id), 0);
      exception
        when others then null;
      end;
    end if;
  end loop;

  return query select v_total, v_credito, v_pago;
end
$$;

-- "Não veio" desfaz as duas presunções: o BBT e o pagamento.
create or replace function server_api.marcar_falta(p_actor uuid, p_appointment uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_auto timestamptz;
  v_papel text;
  v_staff_user uuid;
begin
  select a.tenant_id, a.status, a.auto_completed_at, st.user_id
    into v_tenant, v_status, v_auto, v_staff_user
    from public.appointments a
    left join public.staff st on st.id = a.staff_id
   where a.id = p_appointment
   for update of a;

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

  if v_status <> 'completed' then
    raise exception 'nao_esta_concluido' using errcode = '22023';
  end if;
  if v_auto is null then
    raise exception 'fechamento_manual' using errcode = '22023';
  end if;

  perform server_api.estornar_pagamento_auto(p_appointment);
  perform server_api.estornar_cashback(p_appointment);

  update public.appointments a set status = 'no_show' where a.id = p_appointment;
  update public.staff_busy b set active = false where b.appointment_id = p_appointment;

  return 'no_show';
end
$$;

revoke all on function server_api.fechar_com_pagamento(uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.estornar_pagamento_auto(uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.fechar_atendimentos_vencidos(uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.marcar_falta(uuid, uuid) from public, anon, authenticated, backup_reader;
grant execute on function server_api.fechar_com_pagamento(uuid) to service_role;
grant execute on function server_api.estornar_pagamento_auto(uuid) to service_role;
grant execute on function server_api.fechar_atendimentos_vencidos(uuid) to service_role;
grant execute on function server_api.marcar_falta(uuid, uuid) to service_role;
