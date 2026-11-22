-- Cliente de balcão não pode sobrar quando a marcação falha.
--
-- clienteDeBalcao cria a identidade antes de tentar marcar (a tabela customers exige
-- user_id). Se o horário estava ocupado, sobrava um cliente sem nenhuma visita no CRM,
-- e o e-mail derivado do telefone ficava ocupado para sempre.
--
-- Esta função apaga o cliente só se ele não tem nada pendurado: nenhum agendamento,
-- nenhuma conta de cashback. Qualquer histórico e ela se recusa a apagar — apagar
-- cliente com histórico estragaria relatório.

create or replace function server_api.drop_customer_if_unused(p_tenant uuid, p_customer uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = p_tenant) then
    return false;
  end if;

  if exists (select 1 from public.appointments a where a.customer_id = p_customer) then
    return false;
  end if;

  if exists (select 1 from public.cashback_accounts ca where ca.customer_id = p_customer) then
    return false;
  end if;

  delete from public.customers c where c.id = p_customer and c.tenant_id = p_tenant;
  return true;
end
$$;

revoke all on function server_api.drop_customer_if_unused(uuid, uuid) from public, anon, authenticated, backup_reader;
grant execute on function server_api.drop_customer_if_unused(uuid, uuid) to service_role;
