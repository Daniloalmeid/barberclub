-- Conta do cliente: ver os próprios dados, ver as próprias reservas, e confirmar
-- reserva cujo pagamento é no local.
--
-- Por que confirmar: book_appointment cria a reserva como 'hold' com prazo de
-- hold_minutes (default 10) e um processo de expiração a derruba. Para barbearia que
-- recebe no balcão (payment_mode = pay_at_location) não existe nada a esperar — a
-- reserva tem de virar 'confirmed' na hora, senão o horário do cliente evapora em
-- 10 minutos. Foi exatamente o que aconteceu nas primeiras reservas de teste.

create or replace function server_api.customer_me(p_tenant uuid, p_user uuid)
returns table (customer_id uuid, full_name text, phone text, email text)
language sql
security definer
set search_path = ''
as $$
  select c.id, c.full_name, c.phone, c.email
    from public.customers c
   where c.tenant_id = p_tenant
     and c.user_id = p_user
   limit 1;
$$;

create or replace function server_api.customer_appointments(p_tenant uuid, p_user uuid)
returns table (
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  service_name text,
  staff_name text,
  price_cents bigint
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.starts_at, a.ends_at, a.status, s.name, st.display_name, s.price_cents
    from public.appointments a
    join public.customers c on c.id = a.customer_id
    left join public.services s on s.id = a.service_id
    left join public.staff st on st.id = a.staff_id
   where a.tenant_id = p_tenant
     and c.user_id = p_user
     and a.starts_at > now() - interval '1 day'
   order by a.starts_at
   limit 30;
$$;

-- Só de hold/pending_payment para confirmed. Reserva já expirada não volta: o horário
-- pode ter sido pego por outra pessoa, e ressuscitar seria vender o mesmo slot duas
-- vezes.
create or replace function server_api.confirm_appointment(p_appointment uuid)
returns table (status text, starts_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_hold timestamptz;
begin
  select a.status, a.hold_expires_at into v_status, v_hold
    from public.appointments a
   where a.id = p_appointment
   for update;

  if v_status is null then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'confirmed' then
    return query select a.status, a.starts_at from public.appointments a where a.id = p_appointment;
    return;
  end if;

  if v_status not in ('hold', 'pending_payment') then
    raise exception 'appointment_not_confirmable' using errcode = '22023';
  end if;
  if v_hold is not null and v_hold < now() then
    raise exception 'hold_expired' using errcode = '22023';
  end if;

  update public.appointments
     set status = 'confirmed', hold_expires_at = null
   where id = p_appointment;

  return query select a.status, a.starts_at from public.appointments a where a.id = p_appointment;
end
$$;

revoke all on function server_api.customer_me(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.customer_appointments(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.confirm_appointment(uuid) from public, anon, authenticated, backup_reader;

grant execute on function server_api.customer_me(uuid, uuid) to service_role;
grant execute on function server_api.customer_appointments(uuid, uuid) to service_role;
grant execute on function server_api.confirm_appointment(uuid) to service_role;
