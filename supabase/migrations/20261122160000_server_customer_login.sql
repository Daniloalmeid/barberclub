-- O cliente da barbearia não tem senha. Quem cria a linha em public.customers é o
-- servidor, com a chave secreta, depois de identificar o cliente pelo telefone.
--
-- Por que esta migration existe: public_api.book_appointment exige uma linha em
-- public.customers com user_id = auth.uid(). Nada no schema criava essa linha —
-- nenhuma função, nenhum trigger. Sem ela o agendamento sempre falhava com
-- not_a_customer, mesmo com sessão válida. Estas três funções fecham o buraco.
--
-- Todas são SECURITY DEFINER, com search_path vazio e EXECUTE só para service_role:
-- nenhuma delas fica exposta para anon ou authenticated.

-- 1. Slug -> tenant. O servidor conhece a barbearia pelo host, mas
--    book_appointment recebe uuid.
create or replace function server_api.tenant_by_slug(p_slug text)
returns table (id uuid, display_name text, timezone text, status text)
language sql
security definer
set search_path = ''
as $$
  select t.id, t.display_name, t.timezone, t.status
    from public.tenants t
   where t.slug = p_slug
   limit 1;
$$;

-- 2. Cliente que já se identificou antes, pelo telefone, dentro desta barbearia.
--    D3: uma identidade em auth.users, uma linha de customer por tenant.
create or replace function server_api.find_customer(p_tenant uuid, p_phone text)
returns table (customer_id uuid, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select c.id, c.user_id, c.full_name
    from public.customers c
   where c.tenant_id = p_tenant
     and c.phone = btrim(p_phone)
   order by c.created_at
   limit 1;
$$;

-- 3. Garante a linha do cliente. Idempotente por (tenant_id, user_id): chamar duas
--    vezes não duplica, só completa nome/telefone que estiverem em branco.
create or replace function server_api.ensure_customer(
  p_tenant uuid,
  p_user uuid,
  p_name text,
  p_phone text,
  p_email text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_tenant is null or p_user is null then
    raise exception 'tenant_e_user_obrigatorios' using errcode = '22023';
  end if;

  insert into public.customers (tenant_id, user_id, full_name, phone, email)
  values (p_tenant, p_user, nullif(btrim(p_name), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''))
  on conflict (tenant_id, user_id) do update
     set full_name = coalesce(excluded.full_name, public.customers.full_name),
         phone     = coalesce(excluded.phone, public.customers.phone),
         email     = coalesce(excluded.email, public.customers.email)
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function server_api.tenant_by_slug(text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.find_customer(uuid, text) from public, anon, authenticated, backup_reader;
revoke all on function server_api.ensure_customer(uuid, uuid, text, text, text) from public, anon, authenticated, backup_reader;

grant execute on function server_api.tenant_by_slug(text) to service_role;
grant execute on function server_api.find_customer(uuid, text) to service_role;
grant execute on function server_api.ensure_customer(uuid, uuid, text, text, text) to service_role;

comment on function server_api.ensure_customer(uuid, uuid, text, text, text) is
  'Cria/completa a linha do cliente. Sem esta linha public_api.book_appointment recusa com not_a_customer.';
