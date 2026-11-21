#!/usr/bin/env bash
# Confere o passo do supabase_admin entrando direto como backup_reader (LOGIN).
# Não usa SET ROLE. Sai diferente de 0 e diz o que falta.
# Rede: BARBERCLUB_PG_ENV_FILE=/run/secrets/backup-reader.pgpass.
# O fallback docker exec + trust só existe com BARBERCLUB_VERIFY_LOCAL=1 (CI).
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
  if [[ "${BARBERCLUB_VERIFY_LOCAL:-}" == "1" ]]; then
    local cid
    cid="$(docker ps -qf name=supabase_db_ | head -1)"
    if [[ -z "$cid" ]]; then
      echo "verify-superuser-grants: container do Postgres local não está no ar" >&2
      exit 1
    fi
    docker exec -i -u postgres "$cid" \
      psql -h 127.0.0.1 -U backup_reader -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"
    return
  fi
  if [[ -z "${BARBERCLUB_PG_ENV_FILE:-}" ]]; then
    echo "verify-superuser-grants: defina BARBERCLUB_PG_ENV_FILE=/run/secrets/backup-reader.pgpass" >&2
    exit 2
  fi
  "$root/scripts/psql-from-env-file.sh" -tA -c "${sql}"
}

session_super="$(query "select rolsuper::text from pg_roles where rolname = session_user")"
if [[ "$session_super" != "false" ]]; then
  note "a conexão é de superusuário; use um papel de leitura"
fi

reader="$(query "select current_user")"
if [[ "$reader" != "backup_reader" ]]; then
  note "a checagem não rodou como backup_reader (current_user=${reader})"
fi

# Só as quatro policies nomeadas. Policy de outro bucket não entra na conta.
expr_norm="$(printf '%s' "((bucket_id = 'tenant-files'::text) and ((storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'::text) and private.has_role(((storage.foldername(name))[1])::uuid, array['owner'::text, 'manager'::text, 'staff'::text]))" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')"
got="$(query "select policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('tenant_objects_delete', 'tenant_objects_insert', 'tenant_objects_select', 'tenant_objects_update') order by policyname")"
norm_expr() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//'
}
policy_line() {
  local name="$1" line
  while IFS= read -r line; do
    if [[ "${line%%|*}" == "$name" ]]; then
      printf '%s' "$line"
      return 0
    fi
  done <<< "$got"
  return 0
}
check_policy() {
  local name="$1" cmd="$2" need_qual="$3" need_check="$4" line perm got_cmd roles qual check
  line="$(policy_line "$name")"
  if [[ -z "$line" ]]; then
    note "falta: ${name}=${cmd}"
    return
  fi
  IFS='|' read -r _ perm got_cmd roles qual check <<< "$line"
  if [[ "$perm" != "PERMISSIVE" || "$got_cmd" != "$cmd" || "$roles" != "{authenticated}" ]]; then
    note "diverge: ${name} permissive=${perm} cmd=${got_cmd} roles=${roles}"
  fi
  if [[ "$need_qual" == "1" ]]; then
    if [[ "$(norm_expr "$qual")" != "$expr_norm" || "$qual" =~ [Oo][Rr][[:space:]]+[Tt][Rr][Uu][Ee] ]]; then
      note "rejeitado: ${name} qual"
    fi
  elif [[ -n "$qual" ]]; then
    note "rejeitado: ${name} qual"
  fi
  if [[ "$need_check" == "1" ]]; then
    if [[ "$(norm_expr "$check")" != "$expr_norm" || "$check" =~ [Oo][Rr][[:space:]]+[Tt][Rr][Uu][Ee] ]]; then
      note "rejeitado: ${name} with_check"
    fi
  elif [[ -n "$check" ]]; then
    note "rejeitado: ${name} with_check"
  fi
}
check_policy tenant_objects_delete DELETE 1 0
check_policy tenant_objects_insert INSERT 0 1
check_policy tenant_objects_select SELECT 1 0
check_policy tenant_objects_update UPDATE 1 1

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

objects_sel="$(query "select has_table_privilege('backup_reader', 'storage.objects', 'SELECT')::text")"
if [[ "$objects_sel" != "false" ]]; then
  note "backup_reader não pode ter SELECT em storage.objects (está ${objects_sel})"
fi

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi
echo "verify-superuser-grants: ok"
