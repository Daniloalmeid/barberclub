-- Local e CI: supabase_admin, trust dentro do container.
-- Self-hosted na rede: o mesmo arquivo, pelo .pgpass do supabase_admin.
-- Cloud: a tentativa é o papel postgres do projeto. Se CREATE POLICY falhar
-- porque o dono é supabase_storage_admin, o deploy continua bloqueado.
-- O papel da migration não tem GRANT OPTION em auth nem é dono de storage.objects.
-- Idempotente. Não é script de backup.
-- BEGIN/COMMIT: o drop/create das policies não pode parar no meio, senão o storage fecha.

begin;

grant usage on schema auth to backup_reader;
grant select on auth.users, auth.identities to backup_reader;

-- Só a tabela de buckets, para o verificador de leitura enxergar o nome e public.
-- Não concede SELECT em storage.objects.
grant usage on schema storage to backup_reader;
grant select on storage.buckets to backup_reader;

insert into storage.buckets (id, name, public)
values ('tenant-files', 'tenant-files', false)
on conflict (id) do nothing;

grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists tenant_objects_select on storage.objects;
drop policy if exists tenant_objects_insert on storage.objects;
drop policy if exists tenant_objects_update on storage.objects;
drop policy if exists tenant_objects_delete on storage.objects;

create policy tenant_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenant-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager', 'staff'])
  );

create policy tenant_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager', 'staff'])
  );

create policy tenant_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tenant-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager', 'staff'])
  )
  with check (
    bucket_id = 'tenant-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager', 'staff'])
  );

create policy tenant_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenant-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager', 'staff'])
  );

commit;
