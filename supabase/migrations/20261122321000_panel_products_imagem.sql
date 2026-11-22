-- O painel precisa saber se o produto já tem foto (para mostrar miniatura e o botão de
-- remover). A lista não devolvia image_url.

drop function if exists server_api.panel_products(uuid, uuid);

create or replace function server_api.panel_products(p_tenant uuid, p_actor uuid)
returns table (
  product_id uuid,
  name text,
  description text,
  category text,
  price_cents bigint,
  compare_price_cents bigint,
  active boolean,
  image_url text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  return query
    select p.id, p.name, p.description, p.category, p.price_cents, p.compare_price_cents, p.active, p.image_url
      from public.products p
     where p.tenant_id = p_tenant
     order by p.active desc, p.display_order nulls last, p.name;
end
$$;

revoke all on function server_api.panel_products(uuid, uuid) from public, anon, authenticated, backup_reader;
grant execute on function server_api.panel_products(uuid, uuid) to service_role;
