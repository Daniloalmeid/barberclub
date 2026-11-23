-- Correção do fechamento automático: cliente que não veio.
--
-- O fechamento automático credita BBT ao fim do horário. Se o cliente não apareceu, o
-- crédito é indevido — e 'completed' era estado final, sem caminho de volta.
--
-- Aqui existe o caminho, restrito a quem foi fechado automaticamente (quem concluiu de
-- próprio punho viu o cliente sentado na cadeira). O estorno é contábil, não um delete:
-- o extrato do cliente tem de contar a história inteira.

create or replace function server_api.estornar_cashback(p_appointment uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_customer uuid;
  v_valor bigint;
  v_saldo bigint;
begin
  select e.tenant_id, e.customer_id, e.amount_cents
    into v_tenant, v_customer, v_valor
    from public.cashback_entries e
   where e.appointment_id = p_appointment
     and e.kind = 'credit';

  if v_valor is null then
    return 0;
  end if;

  -- Um débito por atendimento (índice único). Se já existe, o BBT foi usado naquele mesmo
  -- atendimento: devolver o crédito agora embaralharia as duas histórias.
  if exists (select 1 from public.cashback_entries e where e.appointment_id = p_appointment and e.kind = 'debit') then
    raise exception 'bbt_ja_usado' using errcode = '22023';
  end if;

  select ca.balance_cents into v_saldo
    from public.cashback_accounts ca
   where ca.tenant_id = v_tenant and ca.customer_id = v_customer;

  if coalesce(v_saldo, 0) < v_valor then
    raise exception 'saldo_insuficiente_para_estorno' using errcode = '22023';
  end if;

  insert into public.cashback_entries (tenant_id, customer_id, appointment_id, kind, amount_cents, memo)
  values (v_tenant, v_customer, p_appointment, 'debit', v_valor, 'estorno: cliente não compareceu');

  update public.cashback_accounts ca
     set balance_cents = ca.balance_cents - v_valor,
         updated_at = now()
   where ca.tenant_id = v_tenant and ca.customer_id = v_customer;

  -- Contrapartida do crédito (5.1.03 despesa / 2.1.03 passivo), agora invertida.
  begin
    perform server_api.ensure_chart_of_accounts(v_tenant);
    perform ledger.post_journal_entry(
      v_tenant,
      'cashback_debit',
      'cashback_entry',
      p_appointment,
      now(),
      jsonb_build_array(
        jsonb_build_object('code', '2.1.03', 'debit_cents', v_valor),
        jsonb_build_object('code', '5.1.03', 'credit_cents', v_valor)
      ),
      'Estorno de BBT: cliente não compareceu'
    );
  exception
    when others then null;
  end;

  return v_valor;
end
$$;

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

  -- Só o fechamento automático é corrigível: quem tocou em Concluir afirmou que atendeu.
  if v_auto is null then
    raise exception 'fechamento_manual' using errcode = '22023';
  end if;

  perform server_api.estornar_cashback(p_appointment);

  update public.appointments a
     set status = 'no_show'
   where a.id = p_appointment;

  update public.staff_busy b set active = false where b.appointment_id = p_appointment;

  return 'no_show';
end
$$;

revoke all on function server_api.estornar_cashback(uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.marcar_falta(uuid, uuid) from public, anon, authenticated, backup_reader;
grant execute on function server_api.estornar_cashback(uuid) to service_role;
grant execute on function server_api.marcar_falta(uuid, uuid) to service_role;
