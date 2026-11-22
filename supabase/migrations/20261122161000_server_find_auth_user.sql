-- Identidade única (D3): o telefone identifica a pessoa dentro de uma barbearia, mas o
-- login é um só em auth.users. Quando alguém já tem conta por outra barbearia, o
-- servidor reaproveita o usuário em vez de tentar criar outro com o mesmo e-mail.
create or replace function server_api.find_auth_user(p_email text)
returns table (id uuid)
language sql
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   limit 1;
$$;

revoke all on function server_api.find_auth_user(text) from public, anon, authenticated, backup_reader;
grant execute on function server_api.find_auth_user(text) to service_role;
