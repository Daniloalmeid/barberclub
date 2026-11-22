-- Receber com BBT: o caixa registra só o dinheiro que entrou.
--
-- Se o serviço é R$ 45 e o cliente abate 4,50 em BBT, o caixa recebe R$ 40,50. A parte
-- em BBT já virou receita no lançamento do resgate (D 2.1.03 / C 4.1.01) — registrar
-- R$ 45 aqui contaria a mesma receita duas vezes.
--
-- Cobre também o caso de 100% em BBT: não existe pagamento de zero real, então a função
-- devolve pagamento nulo e valor zero em vez de gravar uma linha falsa no caixa.

drop function if exists server_api.record_payment(uuid, uuid, text, bigint);

create or replace function server_api.record_payment(
  p_actor uuid,
  p_appointment uuid,
  p_method text,
  p_amount_cents bigint default null,
  p_bbt_cents bigint default 0
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

  v_valor := coalesce(p_amount_cents, greatest(0, coalesce(v_price, 0) - coalesce(p_bbt_cents, 0)));

  if v_valor <= 0 then
    -- Tudo pago em BBT: não há dinheiro a registrar.
    return query select null::uuid, 0::bigint, v_metodo;
    return;
  end if;

  perform server_api.ensure_chart_of_accounts(v_tenant);

  insert into public.payments (tenant_id, appointment_id, amount_cents, fee_cents, status, provider, method, paid_at)
  values (v_tenant, p_appointment, v_valor, 0, 'paid', 'manual', v_metodo, now())
  returning id into v_payment;

  perform private.post_payment(v_tenant, v_payment, 'revenue');

  return query select v_payment, v_valor, v_metodo;
end
$$;

revoke all on function server_api.record_payment(uuid, uuid, text, bigint, bigint) from public, anon, authenticated, backup_reader;
grant execute on function server_api.record_payment(uuid, uuid, text, bigint, bigint) to service_role;
