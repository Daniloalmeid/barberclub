#!/usr/bin/env bash
# Prova que o verificador falha quando uma policy some, e devolve o estado.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cid="$(docker ps -qf name=supabase_db_ | head -1)"
if [[ -z "$cid" ]]; then
  echo "container do Postgres local não está no ar" >&2
  exit 1
fi

restore() {
  bash "$root/scripts/apply-superuser-grants.sh"
  bash "$root/scripts/verify-superuser-grants.sh"
}
trap restore EXIT

docker exec -i -u postgres "$cid" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  -c "drop policy if exists tenant_objects_select on storage.objects;"

set +e
out="$(bash "$root/scripts/verify-superuser-grants.sh" 2>&1)"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  echo "o verificador passou sem tenant_objects_select" >&2
  exit 1
fi
if [[ "$out" != *"falta: tenant_objects_select=SELECT"* ]]; then
  echo "o verificador não apontou a policy removida" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi
echo "verify-superuser-grants-negative: ok"
