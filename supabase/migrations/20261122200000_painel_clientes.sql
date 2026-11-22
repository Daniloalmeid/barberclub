-- Clientes no painel: a lista que o barbeiro precisa para trabalhar (quem voltou,
-- quem sumiu, quanto gasta). Não existia nenhuma leitura de clientes por tenant.
--
-- Só conta como visita o atendimento CONCLUÍDO: reserva cancelada, falta e expirada
-- não inflam o histórico, senão o cliente parece frequente sem ter aparecido.

create or replace function server_api.panel_customers(
  p_tenant uuid,
  p_actor uuid,
  p_busca text default null
) returns table (
  customer_id uuid,
  nome text,
  telefone text,
  email text,
  visitas bigint,
  ultima_visita timestamptz,
  total_cents bigint,
  ticket_medio_cents bigint,
  dias_sem_voltar integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text;
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_digitos text := nullif(regexp_replace(coalesce(p_busca, ''), '\D', '', 'g'), '');
begin
  select m.role into v_papel
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_actor and m.status = 'active';
  if v_papel is null then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  return query
    select c.id,
           c.full_name,
           c.phone,
           c.email,
           count(a.id) filter (where a.status = 'completed')::bigint,
           max(a.starts_at) filter (where a.status = 'completed'),
           coalesce(sum(s.price_cents) filter (where a.status = 'completed'), 0)::bigint,
           case
             when count(a.id) filter (where a.status = 'completed') > 0
             then (coalesce(sum(s.price_cents) filter (where a.status = 'completed'), 0)
                   / count(a.id) filter (where a.status = 'completed'))::bigint
             else 0::bigint
           end,
           (current_date - (max(a.starts_at) filter (where a.status = 'completed'))::date)::integer
      from public.customers c
      left join public.appointments a on a.customer_id = c.id
      left join public.services s on s.id = a.service_id
     where c.tenant_id = p_tenant
       and (
         v_busca is null
         or c.full_name ilike '%' || v_busca || '%'
         or (v_digitos is not null and c.phone like '%' || v_digitos || '%')
       )
     group by c.id, c.full_name, c.phone, c.email
     order by max(a.starts_at) desc nulls last, c.created_at desc
     limit 100;
end
$$;

revoke all on function server_api.panel_customers(uuid, uuid, text) from public, anon, authenticated, backup_reader;
grant execute on function server_api.panel_customers(uuid, uuid, text) to service_role;
