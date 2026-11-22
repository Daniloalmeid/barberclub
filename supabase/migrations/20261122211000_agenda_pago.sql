-- Colunas de retorno mudaram: create or replace não altera OUT parameters, então derruba antes.
drop function if exists server_api.panel_agenda(uuid, timestamptz, timestamptz);
-- A agenda precisa mostrar o que já entrou: sem isso o barbeiro cobra duas vezes ou
-- não cobra. pago_cents > 0 significa recebido; metodo diz por onde.
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
  price_cents bigint,
  pago_cents bigint,
  metodo text
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.starts_at, a.ends_at, a.status, c.full_name, c.phone, s.name, st.display_name, s.price_cents,
         coalesce(pg.amount_cents, 0)::bigint, pg.method
    from public.appointments a
    left join public.customers c on c.id = a.customer_id
    left join public.services s on s.id = a.service_id
    left join public.staff st on st.id = a.staff_id
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
   order by a.starts_at;
$$;
revoke all on function server_api.panel_agenda(uuid, timestamptz, timestamptz) from public, anon, authenticated, backup_reader;
grant execute on function server_api.panel_agenda(uuid, timestamptz, timestamptz) to service_role;
