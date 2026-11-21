#!/usr/bin/env bash
# Confere o passo do supabase_admin com papel de leitura (backup_reader).
# A sessão que conecta não pode ser superusuário. Sai diferente de 0 e diz o que falta.
# CI/local: docker exec + trust. Rede: BARBERCLUB_PG_ENV_FILE aponta um arquivo, nunca um DSN.
set -euo pipefail

for arg in "$@"; do
  case "$arg" in
    *postgres://*|*postgresql://*|*PASSWORD*)
      echo "verify-superuser-grants: não passe DSN nem senha por argumento" >&2
      exit 2
      ;;
  esac
done

root="$(cd "$(dirname "$0")/.." && pwd)"
missing=0
note() {
  echo "verify-superuser-grants: $*" >&2
  missing=1
}

query() {
  local sql="$1"
  if [[ -n "${BARBERCLUB_PG_ENV_FILE:-}" ]]; then
    BARBERCLUB_PGOPTIONS='-c role=backup_reader' \
      "$root/scripts/psql-from-env-file.sh" -tA -c "${sql}"
  else
    local cid
    cid="$(docker ps -qf name=supabase_db_ | head -1)"
    if [[ -z "$cid" ]]; then
      echo "verify-superuser-grants: container do Postgres local não está no ar" >&2
      exit 1
    fi
    docker exec -e PGOPTIONS='-c role=backup_reader' -i -u postgres "$cid" \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"
  fi
}

session_super="$(query "select rolsuper::text from pg_roles where rolname = session_user")"
if [[ "$session_super" != "false" ]]; then
  note "a conexão é de superusuário; use um papel de leitura"
fi

reader="$(query "select current_user")"
if [[ "$reader" != "backup_reader" ]]; then
  note "a checagem não rodou como backup_reader (current_user=${reader})"
fi

expected=$'tenant_objects_delete=DELETE\ntenant_objects_insert=INSERT\ntenant_objects_select=SELECT\ntenant_objects_update=UPDATE'
got="$(query "select policyname || '=' || cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname")"
if [[ "$got" != "$expected" ]]; then
  note "policies de storage.objects divergiram"
  note "esperado:"
  note "$expected"
  note "encontrado:"
  note "$got"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$got" != *"$line"* ]]; then
      note "falta: $line"
    fi
  done <<< "$expected"
fi

bucket="$(query "select count(*)::text from storage.buckets where id = 'tenant-files' and name = 'tenant-files' and public = false")"
if [[ "$bucket" != "1" ]]; then
  note "bucket tenant-files ausente ou público (contagem=${bucket})"
fi

rls="$(query "select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'objects'")"
if [[ "$rls" != "true" ]]; then
  note "RLS desligado em storage.objects"
fi

usage="$(query "select has_schema_privilege('backup_reader', 'auth', 'USAGE')::text")"
if [[ "$usage" != "true" ]]; then
  note "backup_reader sem USAGE em auth"
fi

users_sel="$(query "select has_table_privilege('backup_reader', 'auth.users', 'SELECT')::text")"
if [[ "$users_sel" != "true" ]]; then
  note "backup_reader sem SELECT em auth.users"
fi

ident_sel="$(query "select has_table_privilege('backup_reader', 'auth.identities', 'SELECT')::text")"
if [[ "$ident_sel" != "true" ]]; then
  note "backup_reader sem SELECT em auth.identities"
fi

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi
echo "verify-superuser-grants: ok"
