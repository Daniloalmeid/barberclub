-- Minha barbearia: o dono edita o próprio negócio sem passar pelo suporte.
--
-- Hoje marca, cor, preço, duração e horário só mudam por SQL nas minhas mãos. Isso
-- impede vender: nenhuma barbearia aceita depender de terceiro para trocar um preço.
--
-- Tudo aqui é SECURITY DEFINER com o ator verificado dentro (private.assert_can_manage
-- = owner/manager ativo naquele tenant). Validação de formato mora no banco porque a
-- tela não é a única porta.

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
  -- Logo por URL https ou vazio: nada de javascript: em campo que vai para o HTML.
  if v_logo is not null and v_logo !~ '^https://' then
    raise exception 'logo_invalida' using errcode = '22023';
  end if;

  if v_nome is not null then
    update public.tenants t set display_name = v_nome where t.id = p_tenant;
  end if;

  update public.tenant_branding b
     set address_line = nullif(btrim(coalesce(p_address_line, '')), ''),
         city = nullif(btrim(coalesce(p_city, '')), ''),
         state = nullif(btrim(coalesce(p_state, '')), ''),
         phone_public = nullif(btrim(coalesce(p_phone_public, '')), ''),
         whatsapp_public = v_zap,
         booking_policy_text = nullif(btrim(coalesce(p_policy_text, '')), ''),
         instagram_handle = nullif(regexp_replace(coalesce(p_instagram, ''), '^@', ''), ''),
         color_primary = coalesce(v_cor1, color_primary),
         color_secondary = coalesce(v_cor2, color_secondary),
         color_accent = coalesce(v_cor3, color_accent),
         logo_url = v_logo
   where b.tenant_id = p_tenant;

  if not found then
    insert into public.tenant_branding (tenant_id, address_line, city, state, phone_public,
      whatsapp_public, booking_policy_text, instagram_handle, color_primary, color_secondary,
      color_accent, logo_url)
    values (p_tenant, nullif(btrim(coalesce(p_address_line, '')), ''), nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_state, '')), ''), nullif(btrim(coalesce(p_phone_public, '')), ''), v_zap,
      nullif(btrim(coalesce(p_policy_text, '')), ''), nullif(regexp_replace(coalesce(p_instagram, ''), '^@', ''), ''),
      coalesce(v_cor1, '#6deaed'), coalesce(v_cor2, '#26262b'), coalesce(v_cor3, '#9ca3af'), v_logo);
  end if;
end
$$;

-- Horário de funcionamento: {"mon":"09:00-19:00", ..., "sun":null}
create or replace function server_api.set_hours(p_tenant uuid, p_actor uuid, p_hours jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia text;
  v_valor text;
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then
    raise exception 'horarios_invalidos' using errcode = '22023';
  end if;

  for v_dia, v_valor in select key, value #>> '{}' from jsonb_each(p_hours) loop
    if v_dia not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
      raise exception 'dia_invalido: %', v_dia using errcode = '22023';
    end if;
    if v_valor is not null and v_valor <> ''
       and v_valor !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'horario_invalido: %', v_dia using errcode = '22023';
    end if;
    if v_valor ~ '^..:..-..:..$' and substring(v_valor, 1, 5) >= substring(v_valor, 7, 5) then
      raise exception 'horario_invertido: %', v_dia using errcode = '22023';
    end if;
  end loop;

  insert into public.tenant_branding (tenant_id, opening_hours)
  values (p_tenant, p_hours)
  on conflict (tenant_id) do update set opening_hours = excluded.opening_hours;
end
$$;

create or replace function server_api.panel_services(p_tenant uuid, p_actor uuid)
returns table (
  service_id uuid,
  name text,
  description text,
  duration_min integer,
  price_cents bigint,
  display_order integer,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  return query
    select s.id, s.name, s.description, s.duration_min, s.price_cents, s.display_order, s.active
      from public.services s
     where s.tenant_id = p_tenant
     order by s.display_order nulls last, s.name;
end
$$;

create or replace function server_api.upsert_service(
  p_tenant uuid,
  p_actor uuid,
  p_service uuid,
  p_name text,
  p_description text,
  p_duration_min integer,
  p_price_cents bigint,
  p_display_order integer default null
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
  if length(v_nome) < 2 or length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'duracao_invalida' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 5000000 then
    raise exception 'preco_invalido' using errcode = '22023';
  end if;

  if p_service is null then
    insert into public.services (tenant_id, name, description, duration_min, price_cents, display_order, active)
    values (p_tenant, v_nome, nullif(btrim(coalesce(p_description, '')), ''), p_duration_min, p_price_cents,
            coalesce(p_display_order, (select coalesce(max(s.display_order), 0) + 1 from public.services s where s.tenant_id = p_tenant)), true)
    returning id into v_id;
  else
    update public.services s
       set name = v_nome,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           duration_min = p_duration_min,
           price_cents = p_price_cents,
           display_order = coalesce(p_display_order, s.display_order)
     where s.id = p_service and s.tenant_id = p_tenant
     returning s.id into v_id;
    if v_id is null then
      raise exception 'servico_nao_encontrado' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end
$$;

-- Desativar em vez de apagar: apagar quebraria o histórico de atendimentos que já
-- apontam para o serviço.
create or replace function server_api.set_service_active(p_tenant uuid, p_actor uuid, p_service uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  update public.services s set active = p_active
   where s.id = p_service and s.tenant_id = p_tenant;
  if not found then
    raise exception 'servico_nao_encontrado' using errcode = 'P0002';
  end if;
  return p_active;
end
$$;

revoke all on function server_api.update_branding(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.set_hours(uuid, uuid, jsonb) from public, anon, authenticated, backup_reader;
revoke all on function server_api.panel_services(uuid, uuid) from public, anon, authenticated, backup_reader;
revoke all on function server_api.upsert_service(uuid, uuid, uuid, text, text, integer, bigint, integer) from public, anon, authenticated, backup_reader;
revoke all on function server_api.set_service_active(uuid, uuid, uuid, boolean) from public, anon, authenticated, backup_reader;

grant execute on function server_api.update_branding(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function server_api.set_hours(uuid, uuid, jsonb) to service_role;
grant execute on function server_api.panel_services(uuid, uuid) to service_role;
grant execute on function server_api.upsert_service(uuid, uuid, uuid, text, text, integer, bigint, integer) to service_role;
grant execute on function server_api.set_service_active(uuid, uuid, uuid, boolean) to service_role;
