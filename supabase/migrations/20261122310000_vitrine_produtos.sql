-- Vitrine de produtos da barbearia.
--
-- O cliente hoje só vê serviços. Pomada, shampoo, óleo de barba e vale-presente ficam no
-- balcão e não existem no app. Sem gateway de pagamento aqui: a vitrine mostra o produto e
-- o botão leva para o WhatsApp da barbearia — reserva no balcão, que é como barbearia
-- vende.
--
-- Sem foto inventada: product.image_url existe e fica nulo até a barbearia subir a foto
-- dela. Card sem foto é melhor que card com foto de produto que não existe.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  category text not null default 'produto',
  price_cents bigint not null check (price_cents >= 0),
  compare_price_cents bigint check (compare_price_cents is null or compare_price_cents > price_cents),
  image_url text,
  active boolean not null default true,
  display_order integer,
  created_at timestamptz not null default now(),
  constraint products_name_len check (char_length(name) between 2 and 80)
);

create unique index if not exists products_tenant_name_key on public.products (tenant_id, lower(name));
create index if not exists products_tenant_active_idx on public.products (tenant_id, active, display_order);

alter table public.products enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_tenant_read') then
    create policy products_tenant_read on public.products
      for select to authenticated
      using (exists (
        select 1 from public.memberships m
         where m.tenant_id = products.tenant_id and m.user_id = auth.uid() and m.status = 'active'
      ));
  end if;
end
$$;

create or replace function public_api.list_products(p_slug text)
returns table (
  product_id uuid,
  name text,
  description text,
  category text,
  price_cents bigint,
  compare_price_cents bigint,
  image_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.description, p.category, p.price_cents, p.compare_price_cents, p.image_url
    from public.products p
    join public.tenants t on t.id = p.tenant_id
   where t.slug = p_slug
     and p.active
   order by p.display_order nulls last, p.name;
$$;

create or replace function server_api.panel_products(p_tenant uuid, p_actor uuid)
returns table (
  product_id uuid,
  name text,
  description text,
  category text,
  price_cents bigint,
  compare_price_cents bigint,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  return query
    select p.id, p.name, p.description, p.category, p.price_cents, p.compare_price_cents, p.active
      from public.products p
     where p.tenant_id = p_tenant
     order by p.active desc, p.display_order nulls last, p.name;
end
$$;

create or replace function server_api.upsert_product(
  p_tenant uuid,
  p_actor uuid,
  p_product uuid,
  p_name text,
  p_description text,
  p_category text,
  p_price_cents bigint,
  p_compare_price_cents bigint default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents <= 0 then
    raise exception 'preco_invalido' using errcode = '22023';
  end if;
  -- Preço "de" só vale se for MAIOR que o preço: riscado falso é propaganda enganosa.
  if p_compare_price_cents is not null and p_compare_price_cents <= p_price_cents then
    raise exception 'preco_de_invalido' using errcode = '22023';
  end if;

  if p_product is null then
    insert into public.products (tenant_id, name, description, category, price_cents, compare_price_cents,
                                 display_order, active)
    values (p_tenant, v_nome, nullif(btrim(coalesce(p_description, '')), ''),
            coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'produto'),
            p_price_cents, p_compare_price_cents,
            (select coalesce(max(pr.display_order), 0) + 1 from public.products pr where pr.tenant_id = p_tenant),
            true)
    returning id into v_id;
  else
    update public.products p
       set name = v_nome,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           category = coalesce(nullif(btrim(coalesce(p_category, '')), ''), p.category),
           price_cents = p_price_cents,
           compare_price_cents = p_compare_price_cents
     where p.id = p_product and p.tenant_id = p_tenant
     returning p.id into v_id;
    if v_id is null then
      raise exception 'produto_nao_encontrado' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end
$$;

create or replace function server_api.set_product_active(p_tenant uuid, p_actor uuid, p_product uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  update public.products p set active = p_active
   where p.id = p_product and p.tenant_id = p_tenant;
  if not found then
    raise exception 'produto_nao_encontrado' using errcode = 'P0002';
  end if;
  return p_active;
end
$$;

revoke all on function public_api.list_products(text) from public;
revoke all on function server_api.panel_products(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.upsert_product(uuid, uuid, uuid, text, text, text, bigint, bigint) from public, anon, authenticated, backup_reader;
revoke all on function server_api.set_product_active(uuid, uuid, uuid, boolean) from public, anon, authenticated, backup_reader;

grant execute on function public_api.list_products(text) to anon, authenticated;
grant execute on function server_api.panel_products(uuid, uuid) to service_role;
grant execute on function server_api.upsert_product(uuid, uuid, uuid, text, text, text, bigint, bigint) to service_role;
grant execute on function server_api.set_product_active(uuid, uuid, uuid, boolean) to service_role;

-- 10 produtos de demonstração na barbearia-demo. Só nela: nenhuma outra barbearia recebe
-- catálogo inventado.
do $$
declare
  v_tenant uuid;
  r record;
  v_ordem integer := 0;
begin
  select t.id into v_tenant from public.tenants t where t.slug = 'barbearia-demo';
  if v_tenant is null then
    return;
  end if;

  for r in
    select * from (values
      ('Pomada Modeladora Matte', 'Fixação média com acabamento seco, sem brilho. 120g.', 'Cabelo', 3990::bigint, 4990::bigint),
      ('Cera Capilar Efeito Molhado', 'Brilho intenso e remoldável durante o dia. 100g.', 'Cabelo', 3490, null),
      ('Shampoo Anticaspa 300ml', 'Controle de caspa e coceira, uso diário.', 'Cabelo', 2990, 3590),
      ('Condicionador para Barba 200ml', 'Amacia e alinha os fios, perfume amadeirado.', 'Barba', 3200, null),
      ('Óleo para Barba 30ml', 'Hidrata e controla o frizz. Amêndoas e argan.', 'Barba', 4500, null),
      ('Balm Pós-Barba', 'Acama a pele depois da navalha, sem álcool.', 'Barba', 2750, null),
      ('Minoxidil 60ml', 'Uso tópico para fortalecer a barba. Leia a bula.', 'Tratamento', 8990, 9990),
      ('Gel Fixador Forte', 'Fixação extra para o dia inteiro. 250g.', 'Cabelo', 2490, null),
      ('Escova de Barba em Madeira', 'Cerdas naturais, cabo de madeira maciça.', 'Barba', 1990, null),
      ('Vale-presente Corte + Barba', 'Um corte e uma barba para presentear. Sem validade curta.', 'Presente', 10000, null)
    ) as t(nome, descricao, categoria, preco, preco_de)
  loop
    v_ordem := v_ordem + 1;
    insert into public.products (tenant_id, name, description, category, price_cents, compare_price_cents, display_order, active)
    values (v_tenant, r.nome, r.descricao, r.categoria, r.preco, r.preco_de, v_ordem, true)
    on conflict (tenant_id, lower(name)) do nothing;
  end loop;
end
$$;
