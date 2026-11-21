-- Reversão: drop function server_api.purge_login_handoffs();
-- restore do select completo do backup_reader não é necessário para o app.

create function server_api.purge_login_handoffs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from private.login_handoffs
   where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function server_api.purge_login_handoffs() from public, anon, authenticated, backup_reader;
grant execute on function server_api.purge_login_handoffs() to service_role;

-- O pg_dump trava a tabela inteira. Sem SELECT, o LOCK falha mesmo com
-- --exclude-table-data. O dump exclui os dados; o papel continua podendo ler.
grant select on table private.login_handoffs to backup_reader;
