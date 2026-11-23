-- Logo da barbearia: upload pela tela.
--
-- O cabecalho do site do cliente ja mostrava logo_url em 2.25rem quando existia URL https.
-- O que faltava era o caminho: o dono tinha que colar um link de uma imagem hospedada
-- em outro lugar — coisa que ele nao tem.

create or replace function server_api.set_tenant_logo(p_tenant uuid, p_actor uuid, p_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if v_url is not null and v_url !~ '^https://' then
    raise exception 'url_invalida' using errcode = '22023';
  end if;

  insert into public.tenant_branding (tenant_id, logo_url)
  values (p_tenant, v_url)
  on conflict (tenant_id) do update set logo_url = excluded.logo_url;

  return v_url;
end
$$;

revoke all on function server_api.set_tenant_logo(uuid, uuid, text) from public, anon, authenticated, backup_reader;
grant execute on function server_api.set_tenant_logo(uuid, uuid, text) to service_role;
