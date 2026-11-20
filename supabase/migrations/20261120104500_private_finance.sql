-- Reversão: drop function private.post_payment, private.register_unallocated_payment,
-- private.request_refund_if_paid.

create or replace function private.post_payment(
  p_tenant uuid, p_payment uuid, p_mode text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount bigint;
  v_fee bigint;
begin
  select p.amount_cents, p.fee_cents
    into v_amount, v_fee
    from public.payments p
   where p.id = p_payment
     and p.tenant_id = p_tenant;
  if v_amount is null then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p_mode = 'revenue' then
    perform ledger.post_journal_entry(
      p_tenant, 'payment', 'payment', p_payment, now(),
      jsonb_build_array(
        jsonb_build_object('code', '1.1.01', 'debit_cents', v_amount, 'credit_cents', 0),
        jsonb_build_object('code', '4.1.01', 'debit_cents', 0, 'credit_cents', v_amount)
      ),
      'pagamento com receita'
    );
    if v_fee > 0 then
      perform ledger.post_journal_entry(
        p_tenant, 'gateway_fee', 'payment', p_payment, now(),
        jsonb_build_array(
          jsonb_build_object('code', '5.1.01', 'debit_cents', v_fee, 'credit_cents', 0),
          jsonb_build_object('code', '1.1.01', 'debit_cents', 0, 'credit_cents', v_fee)
        ),
        'taxa do gateway'
      );
    end if;
  elsif p_mode = 'refund_liability' then
    perform ledger.post_journal_entry(
      p_tenant, 'payment_unallocated', 'payment', p_payment, now(),
      jsonb_build_array(
        jsonb_build_object('code', '1.1.01', 'debit_cents', v_amount, 'credit_cents', 0),
        jsonb_build_object('code', '2.1.02', 'debit_cents', 0, 'credit_cents', v_amount)
      ),
      'pagamento sem reserva'
    );
  else
    raise exception 'invalid post_payment mode' using errcode = '22023';
  end if;
end
$$;

create or replace function private.register_unallocated_payment(
  p_tenant uuid, p_payment uuid, p_appointment uuid, p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
     set status = 'paid_unallocated',
         paid_at = now()
   where id = p_payment
     and tenant_id = p_tenant;

  perform private.post_payment(p_tenant, p_payment, 'refund_liability');

  insert into public.refund_requests (tenant_id, payment_id, reason, status, idempotency_key)
  values (p_tenant, p_payment, p_reason, 'pending', 'refund:' || p_payment::text)
  on conflict (payment_id) do nothing;

  perform private.open_admin_case(p_tenant, p_reason, p_payment);

  insert into public.outbox_events (tenant_id, type, ref_id)
  values (p_tenant, 'refund.requested', p_payment);
end
$$;

create or replace function private.request_refund_if_paid(
  p_tenant uuid, p_appointment uuid, p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
begin
  select * into v_pay
    from public.payments
   where tenant_id = p_tenant
     and appointment_id = p_appointment
   order by created_at
   for update;

  if not found or v_pay.status <> 'paid' then
    return;
  end if;

  update public.payments
     set status = 'refund_pending'
   where id = v_pay.id;

  insert into public.refund_requests (tenant_id, payment_id, reason, status, idempotency_key)
  values (p_tenant, v_pay.id, p_reason, 'pending', 'refund:' || v_pay.id::text)
  on conflict (payment_id) do nothing;

  perform ledger.post_journal_entry(
    p_tenant, 'refund', 'payment', v_pay.id, now(),
    jsonb_build_array(
      jsonb_build_object('code', '4.9.01', 'debit_cents', v_pay.amount_cents, 'credit_cents', 0),
      jsonb_build_object('code', '2.1.02', 'debit_cents', 0, 'credit_cents', v_pay.amount_cents)
    ),
    'reembolso por cancelamento'
  );

  insert into public.outbox_events (tenant_id, type, ref_id)
  values (p_tenant, 'refund.requested', v_pay.id);
end
$$;
