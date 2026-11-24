-- Preço do atendimento é o combinado no agendamento, não a tabela de hoje.
--
-- record_payment e credit_cashback liam s.price_cents (preço ATUAL do serviço) e ignoravam
-- a.price_cents. Consequência medida: um atendimento gravado a R$ 45,00 num serviço que hoje
-- custa R$ 20,00 recebeu R$ 20,00 no caixa, e o BBT saiu sobre R$ 20,00.
--
-- Quem manda é o preço do atendimento; a tabela é só o fallback de quem nasceu sem preço.

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
  select a.tenant_id, a.customer_id, a.status, coalesce(a.price_cents, s.price_cents)
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
      null;
  end;

  return v_inserido;
end
$$;
