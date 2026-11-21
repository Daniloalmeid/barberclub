#!/usr/bin/env bash
# Aplica só as migrations ainda fora de supabase_migrations.schema_migrations.
# A versão entra na mesma transação do arquivo. A segunda execução aplica zero.
# CI: BARBERCLUB_MIGRATE_LOCAL=1. Rede: BARBERCLUB_PG_ENV_FILE do papel postgres.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="${BARBERCLUB_MIGRATIONS_DIR:-$root/supabase/migrations}"

run_sql() {
  if [[ "${BARBERCLUB_MIGRATE_LOCAL:-}" == "1" ]]; then
    local cid
    cid="$(docker ps -qf name=supabase_db_ | head -1)"
    if [[ -z "$cid" ]]; then
      echo "apply-migrations: container do Postgres local não está no ar" >&2
      exit 1
    fi
    docker exec -i -u postgres "$cid" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  else
    if [[ -z "${BARBERCLUB_PG_ENV_FILE:-}" ]]; then
      echo "apply-migrations: defina BARBERCLUB_PG_ENV_FILE ou BARBERCLUB_MIGRATE_LOCAL=1" >&2
      exit 2
    fi
    "$root/scripts/psql-from-env-file.sh" "$@"
  fi
}

run_file_and_record() {
  local file="$1" ver="$2" name="$3" insert
  insert="insert into supabase_migrations.schema_migrations (version, name) values ('${ver}', '${name}')"
  if [[ "${BARBERCLUB_MIGRATE_LOCAL:-}" == "1" ]]; then
    local cid
    cid="$(docker ps -qf name=supabase_db_ | head -1)"
    docker exec -i -u postgres "$cid" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      --single-transaction -f - -c "$insert" < "$file"
  else
    BARBERCLUB_PG_ENV_FILE="$BARBERCLUB_PG_ENV_FILE" \
      "$root/scripts/psql-from-env-file.sh" --single-transaction "$file" -c "$insert"
  fi
}

run_sql -c "create schema if not exists supabase_migrations;"
run_sql -c "create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);"

applied="$(run_sql -tA -c "select version from supabase_migrations.schema_migrations")" || exit 1

n=0
shopt -s nullglob
for file in "$dir"/*.sql; do
  base="$(basename "$file" .sql)"
  ver="${base%%_*}"
  name="${base#*_}"
  if [[ ! "$ver" =~ ^[0-9]+$ || "$name" == "$base" || ! "$name" =~ ^[A-Za-z0-9_]+$ ]]; then
    echo "apply-migrations: nome inválido $base" >&2
    exit 1
  fi
  if grep -qx "$ver" <<< "$applied"; then
    continue
  fi
  run_file_and_record "$file" "$ver" "$name"
  echo "aplicada=$ver"
  n=$((n + 1))
done

echo "aplicadas=$n"
