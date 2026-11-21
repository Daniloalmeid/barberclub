-- Reversão: drop policy on public.*; disable row level security;
-- revoke os grants explícitos desta migration. O papel backup_reader permanece.

-- RLS em toda tabela de public. Sem FORCE: funções SECURITY DEFINER escrevem como donas.
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end
$$;

create policy services_select_team on public.services
  for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager', 'staff']));
create policy services_insert on public.services
  for insert to authenticated
  with check (private.has_role(tenant_id, array['owner', 'manager']));
create policy services_update on public.services
  for update to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager']))
  with check (private.has_role(tenant_id, array['owner', 'manager']));

create policy staff_select_team on public.staff
  for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager', 'staff']));

create policy staff_services_select on public.staff_services
  for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager', 'staff']));
create policy staff_services_insert on public.staff_services
  for insert to authenticated
  with check (private.has_role(tenant_id, array['owner', 'manager']));
create policy staff_services_update on public.staff_services
  for update to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager']))
  with check (private.has_role(tenant_id, array['owner', 'manager']));

create policy work_schedules_select on public.work_schedules
  for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager', 'staff']));
create policy work_schedules_insert on public.work_schedules
  for insert to authenticated
  with check (private.has_role(tenant_id, array['owner', 'manager']));
create policy work_schedules_update on public.work_schedules
  for update to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager']))
  with check (private.has_role(tenant_id, array['owner', 'manager']));

create policy branding_select on public.tenant_branding
  for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager', 'staff']));
create policy branding_insert on public.tenant_branding
  for insert to authenticated
  with check (private.has_role(tenant_id, array['owner', 'manager']));
create policy branding_update on public.tenant_branding
  for update to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager']))
  with check (private.has_role(tenant_id, array['owner', 'manager']));

create policy settings_select on public.tenant_settings
  for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager', 'staff']));
create policy settings_insert on public.tenant_settings
  for insert to authenticated
  with check (private.has_role(tenant_id, array['owner', 'manager']));
create policy settings_update on public.tenant_settings
  for update to authenticated
  using (private.has_role(tenant_id, array['owner', 'manager']))
  with check (private.has_role(tenant_id, array['owner', 'manager']));

create policy customers_select on public.customers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_role(tenant_id, array['owner', 'manager', 'staff'])
  );

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
        from public.memberships mine
        join public.memberships theirs
          on theirs.tenant_id = mine.tenant_id
       where mine.user_id = (select auth.uid())
         and theirs.user_id = profiles.id
         and mine.status = 'active'
    )
  );
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_role(tenant_id, array['owner'])
  );

create policy appt_select_customer on public.appointments
  for select to authenticated
  using (customer_id in (select private.my_customer_ids()));
create policy appt_select_team on public.appointments
  for select to authenticated
  using (
    private.has_role(tenant_id, array['owner', 'manager'])
    or staff_id in (select private.my_staff_ids(tenant_id))
  );

create policy payments_select on public.payments
  for select to authenticated
  using (
    private.has_role(tenant_id, array['owner', 'manager'])
    or exists (
      select 1
        from public.appointments a
        join public.customers c
          on c.tenant_id = a.tenant_id
         and c.id = a.customer_id
       where a.tenant_id = payments.tenant_id
         and a.id = payments.appointment_id
         and c.user_id = (select auth.uid())
    )
  );

create policy time_off_select on public.time_off
  for select to authenticated
  using (
    private.has_role(tenant_id, array['owner', 'manager'])
    or staff_id in (select private.my_staff_ids(tenant_id))
  );

create policy tenants_select on public.tenants
  for select to authenticated
  using (
    private.has_role(id, array['owner', 'manager', 'staff'])
    or exists (
      select 1 from public.customers c
       where c.tenant_id = tenants.id
         and c.user_id = (select auth.uid())
    )
  );

-- Fecha o que os privilégios padrão do Supabase tenham aberto e reaplica a matriz.
revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all tables in schema ledger from public, anon, authenticated, service_role;
revoke all on all sequences in schema ledger from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'public_api', 'server_api', 'private', 'ledger')
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role, backup_reader',
      r.signature
    );
  end loop;
end
$$;

grant select on
  public.services, public.staff, public.staff_services, public.work_schedules,
  public.tenant_branding, public.tenant_settings, public.customers, public.profiles,
  public.memberships, public.appointments, public.time_off, public.payments,
  public.tenants
  to authenticated;

grant insert, update on
  public.services, public.staff_services, public.work_schedules,
  public.tenant_branding, public.tenant_settings
  to authenticated;

grant update (full_name, phone, avatar_path) on public.profiles to authenticated;

grant select on all tables in schema public to service_role;
grant select on all tables in schema public to backup_reader;
grant select on all tables in schema ledger to backup_reader;

-- Leitura explícita para o backup_reader. Com BYPASSRLS o pg_dump ignora a policy;
-- sem o atributo, a policy é o que permite o SELECT sob RLS. Não há policy de escrita.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'ledger')
       and c.relkind = 'r'
  loop
    execute format(
      'create policy %I on %I.%I for select to backup_reader using (true)',
      r.relname || '_backup_select',
      r.nspname,
      r.relname
    );
  end loop;
end
$$;
grant select on all sequences in schema public to backup_reader;
grant select on all sequences in schema ledger to backup_reader;

grant execute on function private.has_role(uuid, text[]) to authenticated;
grant execute on function private.my_customer_ids() to authenticated;
grant execute on function private.my_staff_ids(uuid) to authenticated;

grant execute on function public_api.get_tenant_public(text) to anon, authenticated;
grant execute on function public_api.list_services(text) to anon, authenticated;
grant execute on function public_api.list_staff(text) to anon, authenticated;
grant execute on function public_api.list_free_slots(text, uuid, uuid, date) to anon, authenticated;

grant execute on function public_api.book_appointment(uuid, uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public_api.cancel_appointment(uuid, text) to authenticated;
grant execute on function public_api.create_time_off(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public_api.complete_appointment(uuid) to authenticated;
grant execute on function public_api.invite_member(uuid, uuid, text) to authenticated;
grant execute on function public_api.change_member_role(uuid, uuid, text) to authenticated;
grant execute on function public_api.record_commission_payout(uuid, uuid, bigint) to authenticated;

grant execute on function server_api.health() to service_role;
grant execute on function server_api.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function server_api.process_payment_event(text, text, uuid, text, bigint) to service_role;
grant execute on function server_api.record_refund_result(uuid, text, text) to service_role;
grant execute on function server_api.record_settlement(uuid, uuid, bigint) to service_role;
grant execute on function server_api.reverse_entry(uuid, text) to service_role;
grant execute on function server_api.expire_holds() to service_role;
grant execute on function server_api.run_reconciliation() to service_role;

-- D37: leitura de auth.users e auth.identities. Sem escrita e sem EXECUTE daqui.
grant usage on schema auth to backup_reader;
grant select on auth.users to backup_reader;
grant select on auth.identities to backup_reader;

-- USAGE em auth e as policies de storage.objects são do supabase_admin /
-- supabase_storage_admin. O papel da migration não tem GRANT OPTION nesses
-- objetos. O complemento idempotente está em supabase/admin/superuser.sql
-- e o CI aplica com psql -U supabase_admin depois das migrations.
