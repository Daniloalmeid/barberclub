-- Campo em branco deixa de apagar dado.
--
-- O formulário de Minha barbearia manda todos os campos de uma vez. Quem abrisse a tela,
-- salvasse só a cor e tivesse qualquer campo de contato em branco apagava endereço,
-- telefone e WhatsApp sem perceber — e o site ficava sem botão de contato. Aconteceu
-- duas vezes nestes testes.
--
-- Agora string vazia significa "manter o que está gravado". Para limpar um campo, a tela
-- vai oferecer remoção explícita (não o simples apagar do texto).
-- Cores: já funcionavam assim (vazio ou inválido mantém a atual).

create or replace function server_api.update_branding(
  p_tenant uuid,
  p_actor uuid,
  p_display_name text,
  p_address_line text,
  p_city text,
  p_state text,
  p_phone_public text,
  p_whatsapp_public text,
  p_policy_text text,
  p_instagram text,
  p_color_primary text,
  p_color_secondary text,
  p_color_accent text,
  p_logo_url text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_cor1 text := nullif(btrim(coalesce(p_color_primary, '')), '');
  v_cor2 text := nullif(btrim(coalesce(p_color_secondary, '')), '');
  v_cor3 text := nullif(btrim(coalesce(p_color_accent, '')), '');
  v_zap text := nullif(regexp_replace(coalesce(p_whatsapp_public, ''), '\D', '', 'g'), '');
  v_logo text := nullif(btrim(coalesce(p_logo_url, '')), '');
begin
  perform private.assert_can_manage(p_tenant, p_actor);

  if v_nome is not null and (length(v_nome) < 2 or length(v_nome) > 80) then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if v_cor1 is not null and v_cor1 !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'cor_invalida' using errcode = '22023';
  end if;
  if v_cor2 is not null and v_cor2 !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'cor_invalida' using errcode = '22023';
  end if;
  if v_cor3 is not null and v_cor3 !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'cor_invalida' using errcode = '22023';
  end if;
  if v_zap is not null and (length(v_zap) < 10 or length(v_zap) > 15) then
    raise exception 'whatsapp_invalido' using errcode = '22023';
  end if;
  if v_logo is not null and v_logo !~ '^https://' then
    raise exception 'logo_invalida' using errcode = '22023';
  end if;

  if v_nome is not null then
    update public.tenants t set display_name = v_nome where t.id = p_tenant;
  end if;

  update public.tenant_branding b
     set address_line = coalesce(nullif(btrim(coalesce(p_address_line, '')), ''), b.address_line),
         city = coalesce(nullif(btrim(coalesce(p_city, '')), ''), b.city),
         state = coalesce(nullif(btrim(coalesce(p_state, '')), ''), b.state),
         phone_public = coalesce(nullif(btrim(coalesce(p_phone_public, '')), ''), b.phone_public),
         whatsapp_public = coalesce(v_zap, b.whatsapp_public),
         booking_policy_text = coalesce(nullif(btrim(coalesce(p_policy_text, '')), ''), b.booking_policy_text),
         instagram_handle = coalesce(nullif(regexp_replace(coalesce(p_instagram, ''), '^@', ''), ''), b.instagram_handle),
         color_primary = coalesce(v_cor1, b.color_primary),
         color_secondary = coalesce(v_cor2, b.color_secondary),
         color_accent = coalesce(v_cor3, b.color_accent),
         logo_url = coalesce(v_logo, b.logo_url)
   where b.tenant_id = p_tenant;

  if not found then
    insert into public.tenant_branding (tenant_id, address_line, city, state, phone_public,
      whatsapp_public, booking_policy_text, instagram_handle, color_primary, color_secondary,
      color_accent, logo_url)
    values (p_tenant,
      nullif(btrim(coalesce(p_address_line, '')), ''), nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_state, '')), ''), nullif(btrim(coalesce(p_phone_public, '')), ''), v_zap,
      nullif(btrim(coalesce(p_policy_text, '')), ''), nullif(regexp_replace(coalesce(p_instagram, ''), '^@', ''), ''),
      coalesce(v_cor1, '#6deaed'), coalesce(v_cor2, '#26262b'), coalesce(v_cor3, '#9ca3af'), v_logo);
  end if;
end
$$;

-- Remoção explícita de um campo de contato (o que o formulário não faz mais sozinho).
create or replace function server_api.clear_branding_field(p_tenant uuid, p_actor uuid, p_campo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campo text := lower(btrim(coalesce(p_campo, '')));
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if v_campo not in ('address_line', 'phone_public', 'whatsapp_public', 'instagram_handle', 'logo_url', 'booking_policy_text') then
    raise exception 'campo_invalido' using errcode = '22023';
  end if;

  execute format('update public.tenant_branding set %I = null where tenant_id = $1', v_campo)
    using p_tenant;
  return true;
end
$$;

revoke all on function server_api.clear_branding_field(uuid, uuid, text) from public, anon, authenticated, backup_reader;
grant execute on function server_api.clear_branding_field(uuid, uuid, text) to service_role;
