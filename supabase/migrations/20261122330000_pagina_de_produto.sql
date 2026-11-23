-- Página de produto: cada item da vitrine passa a ter endereço próprio.
--
-- O card mostra duas linhas de descrição porque é vitrine. Para decidir a compra o
-- cliente precisa de mais: descrição completa, marca, tamanho, e um caminho de reserva
-- explícito. Endereço com slug (não id) porque link de produto circula no WhatsApp.

-- 1. Slugify simples: minúsculas, sem acento, hífen no lugar do resto.
create or replace function public.slugify_texto(txt text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(txt, ''), 'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

-- 1b. Função nasce executável por PUBLIC no Postgres. Slugify não é API pública:
--     o teste G02 do pgTAP barra qualquer função fora da lista branca, e com razão.
revoke all on function public.slugify_texto(text) from public, anon, authenticated, backup_reader;

-- 2. Campos novos: descrição completa, marca e tamanho.
alter table public.products add column if not exists slug text;
alter table public.products add column if not exists details text;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists size_label text;

-- 3. Slug de quem já existe (com sufixo curto quando o nome repete).
with base as (
  select p.id,
         p.tenant_id,
         coalesce(nullif(public.slugify_texto(p.name), ''), 'produto') as b
    from public.products p
   where p.slug is null
),
numerado as (
  select b.id,
         b.tenant_id,
         case
           when row_number() over (partition by b.tenant_id, b.b order by b.id) = 1 then b.b
           else b.b || '-' || substr(b.id::text, 1, 4)
         end as s
    from base b
)
update public.products p
   set slug = n.s
  from numerado n
 where p.id = n.id;

alter table public.products alter column slug set not null;

create unique index if not exists products_tenant_slug_key on public.products (tenant_id, slug);

-- 4. Vitrine passa a devolver o slug (o card vira link para a página).
drop function if exists public_api.list_products(text);
create or replace function public_api.list_products(p_slug text)
returns table (
  product_id uuid,
  slug text,
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
  select p.id, p.slug, p.name, p.description, p.category, p.price_cents, p.compare_price_cents, p.image_url
    from public.products p
    join public.tenants t on t.id = p.tenant_id
   where t.slug = p_slug
     and p.active
   order by p.display_order nulls last, p.name;
$$;

-- 5. Um produto, com os campos completos.
create or replace function public_api.get_product(p_slug text, p_product_slug text)
returns table (
  product_id uuid,
  slug text,
  name text,
  description text,
  details text,
  category text,
  brand text,
  size_label text,
  price_cents bigint,
  compare_price_cents bigint,
  image_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.slug, p.name, p.description, p.details, p.category, p.brand, p.size_label,
         p.price_cents, p.compare_price_cents, p.image_url
    from public.products p
    join public.tenants t on t.id = p.tenant_id
   where t.slug = p_slug
     and p.slug = p_product_slug
     and p.active;
$$;

-- 6. Painel: cria e edita com os campos novos, mantendo o slug estável em renomeação
--    (link publicado não pode morrer porque o dono corrigiu o nome).
drop function if exists server_api.upsert_product(uuid, uuid, uuid, text, text, text, bigint, bigint);

create or replace function server_api.upsert_product(
  p_tenant uuid,
  p_actor uuid,
  p_product uuid,
  p_name text,
  p_description text,
  p_category text,
  p_price_cents bigint,
  p_compare_price_cents bigint default null,
  p_details text default null,
  p_brand text default null,
  p_size_label text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_slug text;
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents <= 0 then
    raise exception 'preco_invalido' using errcode = '22023';
  end if;
  if p_compare_price_cents is not null and p_compare_price_cents <= p_price_cents then
    raise exception 'preco_de_invalido' using errcode = '22023';
  end if;

  if p_product is null then
    v_slug := coalesce(nullif(public.slugify_texto(v_nome), ''), 'produto');
    if exists (select 1 from public.products p where p.tenant_id = p_tenant and p.slug = v_slug) then
      v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
    end if;

    insert into public.products (tenant_id, name, slug, description, details, category, brand, size_label,
                                 price_cents, compare_price_cents, display_order, active)
    values (p_tenant, v_nome, v_slug,
            nullif(btrim(coalesce(p_description, '')), ''),
            nullif(btrim(coalesce(p_details, '')), ''),
            coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'produto'),
            nullif(btrim(coalesce(p_brand, '')), ''),
            nullif(btrim(coalesce(p_size_label, '')), ''),
            p_price_cents, p_compare_price_cents,
            (select coalesce(max(pr.display_order), 0) + 1 from public.products pr where pr.tenant_id = p_tenant),
            true)
    returning id into v_id;
  else
    update public.products p
       set name = v_nome,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           details = nullif(btrim(coalesce(p_details, '')), ''),
           category = coalesce(nullif(btrim(coalesce(p_category, '')), ''), p.category),
           brand = nullif(btrim(coalesce(p_brand, '')), ''),
           size_label = nullif(btrim(coalesce(p_size_label, '')), ''),
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

-- 7. Painel lista com slug e os campos novos.
drop function if exists server_api.panel_products(uuid, uuid);

create or replace function server_api.panel_products(p_tenant uuid, p_actor uuid)
returns table (
  product_id uuid,
  slug text,
  name text,
  description text,
  details text,
  category text,
  brand text,
  size_label text,
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
    select p.id, p.slug, p.name, p.description, p.details, p.category, p.brand, p.size_label,
           p.price_cents, p.compare_price_cents, p.active, p.image_url
      from public.products p
     where p.tenant_id = p_tenant
     order by p.active desc, p.display_order nulls last, p.name;
end
$$;

revoke all on function public_api.list_products(text) from public;
revoke all on function public_api.get_product(text, text) from public;
revoke all on function server_api.upsert_product(uuid, uuid, uuid, text, text, text, bigint, bigint, text, text, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_products(uuid, uuid) from public, anon, authenticated, backup_reader;

grant execute on function public_api.list_products(text) to anon, authenticated;
grant execute on function public_api.get_product(text, text) to anon, authenticated;
grant execute on function server_api.upsert_product(uuid, uuid, uuid, text, text, text, bigint, bigint, text, text, text) to service_role;
grant execute on function server_api.panel_products(uuid, uuid) to service_role;

-- 8. Detalhe nos 10 produtos de demonstração (sem inventar promessa de resultado).
update public.products p
   set details = d.details,
       brand = d.brand,
       size_label = d.size
  from (values
    ('Pomada Modeladora Matte', 'Fixação média com acabamento seco. Aplique uma porção do tamanho de uma ervilha nas mãos, espalhe e modele o cabelo seco. Sai com shampoo comum, sem deixar resíduo.', 'Barba Forte', '120 g'),
    ('Cera Capilar Efeito Molhado', 'Brilho intenso e efeito remoldável durante o dia. Use no cabelo seco para brilho alto ou no úmido para efeito mais discreto. Fixação forte.', 'Barba Forte', '100 g'),
    ('Shampoo Anticaspa 300ml', 'Limpeza diária com controle de caspa e coceira. Massageie o couro cabeludo, deixe agir por 2 minutos e enxágue. Uso contínuo.', 'Linha Limpa', '300 ml'),
    ('Condicionador para Barba 200ml', 'Amacia e alinha os fios da barba, com perfume amadeirado. Aplique na barba limpa e úmida, deixe 1 minuto e enxágue.', 'Linha Limpa', '200 ml'),
    ('Óleo para Barba 30ml', 'Hidrata a pele sob a barba e controla o frizz. Duas a três gotas na palma da mão, espalhe na barba seca. Uso diário.', 'Barba Forte', '30 ml'),
    ('Balm Pós-Barba', 'Acama a pele depois da navalha, sem álcool na fórmula. Aplique uma camada fina na região raspada, com a pele seca.', 'Barba Forte', '100 ml'),
    ('Minoxidil 60ml', 'Uso tópico para fortalecer a barba. Aplique conforme a bula e a orientação de um profissional de saúde. Não é cosmético e não garante resultado.', 'Farmacêutico', '60 ml'),
    ('Gel Fixador Forte', 'Fixação extra para o dia inteiro, sem endurecer. Aplique no cabelo úmido e modele. Segura bem em dia de calor.', 'Barba Forte', '250 g'),
    ('Escova de Barba em Madeira', 'Cerdas naturais com cabo de madeira maciça. Desembaraça e distribui o óleo pela barba. Use de manhã e depois do banho.', 'Barba Forte', '1 unidade'),
    ('Vale-presente Corte + Barba', 'Um corte e uma barba para presentear. Vale para qualquer profissional, sem prazo curto de validade. Emitimos no balcão com o nome de quem recebe.', 'Barbearia Demonstração', 'Cortesia')
  ) as d(nome, details, brand, size)
 where p.name = d.nome
   and p.tenant_id = (select t.id from public.tenants t where t.slug = 'barbearia-demo');
