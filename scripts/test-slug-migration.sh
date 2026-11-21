#!/usr/bin/env bash
# Prova a migration de slug num banco descartável copiado do postgres local.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cid="$(docker ps -qf name=supabase_db_ | head -1)"
file="$root/supabase/migrations/20261122130000_tenant_slug_min3.sql"
psql() { docker exec -i -u postgres "$cid" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
admin() { docker exec -i -u postgres "$cid" psql -U supabase_admin -d template1 -v ON_ERROR_STOP=1 "$@"; }
created=0
for _ in 1 2 3 4 5 6 7 8; do
  if admin <<'SQL' >/dev/null
select pg_terminate_backend(pid) from pg_stat_activity where datname in ('slugmig', 'postgres') and pid <> pg_backend_pid();
drop database if exists slugmig;
create database slugmig template postgres;
SQL
  then
    created=1
    break
  fi
  sleep 0.3
done
test "$created" = "1"
psql -d slugmig <<'SQL'
delete from supabase_migrations.schema_migrations where version = '20261122130000';
alter table public.tenants drop constraint tenants_slug_shape;
alter table public.tenants add constraint tenants_slug_shape check (
  slug ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$'
  and slug !~ '--'
  and slug !~ '^xn--'
);
insert into public.tenants (slug, display_name, status) values
  ('q', 'Curto Q', 'trial'),
  ('z', 'Curto Z', 'trial'),
  ('valido', 'Valido', 'trial');
SQL
set +e
out="$(psql -d slugmig --single-transaction -f - < "$file" 2>&1)"
status=$?
set -e
printf '%s\n' "$out" | grep -q 'tenants_slug_shape: 2 slug(s) fora da regra de 3 a 32 caracteres; migration abortada sem alterar dados'
test "$status" -ne 0
count="$(psql -d slugmig -tA -c "select count(*) from public.tenants where slug in ('q','z')")"
test "$count" = "2"
def="$(psql -d slugmig -tA -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'tenants_slug_shape'")"
printf '%s\n' "$def" | grep -F 'xn--' >/dev/null
ver="$(psql -d slugmig -tA -c "select count(*) from supabase_migrations.schema_migrations where version = '20261122130000'")"
test "$ver" = "0"
psql -d slugmig -c "delete from public.tenants where slug in ('q','z');"
psql -d slugmig --single-transaction -f - < "$file" >/dev/null
admin -c "drop database if exists slugmig;"
echo "migration de slug ok"
