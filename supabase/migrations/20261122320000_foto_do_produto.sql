-- Foto do produto: upload de verdade, não campo de URL.
--
-- O card da vitrine já sabia mostrar imagem (image_url) e trocava as iniciais por ela.
-- Mas nada preenchia esse campo: o dono não tem como colar URL de foto que ele mesmo
-- tirou no celular.
--
-- Bucket público por desenho: foto de vitrine é material de propaganda, tem que abrir sem
-- login. Escrita só pelo servidor com a chave secreta — anon não escreve nada aqui.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('barberclub-produtos', 'barberclub-produtos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Leitura pública (o bucket já é público; a policy documenta a intenção).
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'barberclub_produtos_leitura'
  ) then
    create policy barberclub_produtos_leitura on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'barberclub-produtos');
  end if;
end
$$;

create or replace function server_api.set_product_image(p_tenant uuid, p_actor uuid, p_product uuid, p_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if p_url is not null and p_url <> '' and p_url !~ '^https://' then
    raise exception 'url_invalida' using errcode = '22023';
  end if;

  update public.products p
     set image_url = nullif(btrim(coalesce(p_url, '')), '')
   where p.id = p_product and p.tenant_id = p_tenant;
  if not found then
    raise exception 'produto_nao_encontrado' using errcode = 'P0002';
  end if;

  return nullif(btrim(coalesce(p_url, '')), '');
end
$$;

revoke all on function server_api.set_product_image(uuid, uuid, uuid, text) from public, anon, authenticated, backup_reader;
grant execute on function server_api.set_product_image(uuid, uuid, uuid, text) to service_role;
