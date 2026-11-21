#!/usr/bin/env bash
# Define barberclub.dblink_password como supabase_admin e roda o pgTAP.
# A senha não entra em argumento: no stack local sai de POSTGRES_PASSWORD
# do container (trust, psql -U supabase_admin). Na rede, sai do .pgpass
# em BARBERCLUB_PG_ENV_FILE, gravada num SQL em tmpfs (não em argumento).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

set_local_password() {
  local cid
  cid="$(docker ps -qf name=supabase_db_ | head -1)"
  if [[ -z "$cid" ]]; then
    echo "run-pgtap: container do Postgres local não está no ar. Rode supabase start." >&2
    exit 1
  fi
  docker exec -i -u postgres "$cid" sh -s <<'EOS'
set -eu
pw="${POSTGRES_PASSWORD:-}"
if [ -z "$pw" ]; then
  echo "run-pgtap: POSTGRES_PASSWORD ausente no container" >&2
  exit 1
fi
escaped=$(printf '%s' "$pw" | sed "s/'/''/g")
psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<SQL
alter database postgres set barberclub.dblink_password = '${escaped}';
SQL
EOS
}

set_remote_password() {
  local file="$BARBERCLUB_PG_ENV_FILE" pw="" line sql dir
  if [[ ! -f "$file" ]]; then
    echo "run-pgtap: BARBERCLUB_PG_ENV_FILE não é arquivo" >&2
    exit 1
  fi
  if grep -q '^[A-Za-z_][A-Za-z0-9_]*=' "$file"; then
    line="$(grep -E '^PGPASSWORD=' "$file" | head -1 || true)"
    pw="${line#*=}"
    pw="${pw%\"}"
    pw="${pw#\"}"
  else
    IFS=: read -r _ _ _ _ pw < "$file"
    pw="${pw//\\:/:}"
    pw="${pw//\\\\/\\}"
  fi
  if [[ -z "$pw" ]]; then
    echo "run-pgtap: senha ausente no arquivo de credencial" >&2
    exit 1
  fi
  local escaped="${pw//\'/\'\'}"
  pw=""
  if findmnt -n -o FSTYPE -T /run 2>/dev/null | grep -qx tmpfs; then
    install -d -m 700 /run/secrets
    dir=/run/secrets
  else
    dir=/dev/shm
  fi
  sql="${dir}/barberclub-dblink-$$.sql"
  install -m 600 /dev/null "$sql"
  printf "alter database postgres set barberclub.dblink_password = '%s';\n" "$escaped" > "$sql"
  escaped=""
  "$root/scripts/psql-from-env-file.sh" "$sql"
  shred -u "$sql" 2>/dev/null || rm -f "$sql"
}

if [[ -n "${BARBERCLUB_PG_ENV_FILE:-}" ]]; then
  set_remote_password
else
  set_local_password
fi

cd "$root"
supabase test db supabase/tests/pgtap
