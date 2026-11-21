#!/usr/bin/env bash
# psql contra o Postgres alvo. O DSN fica num arquivo chmod 600, nunca em argumento
# e nunca em -e PGPASSWORD. A cópia usada no comando é apagada no fim, e o
# container efêmero postgres:17 também.
#
#   BARBERCLUB_PG_ENV_FILE=/caminho/cred.env scripts/psql-from-env-file.sh supabase/admin/superuser.sql
#   BARBERCLUB_PG_ENV_FILE=/caminho/cred.env scripts/psql-from-env-file.sh -tA -c "select 1"
#
# cred.env é KEY=VALUE (PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD) e entra
# por --env-file. Alternativa: .pgpass (hostname:port:database:username:password),
# montado só de leitura. Senha com ':' usa o env-file.
set -euo pipefail

if [[ "$#" -lt 1 ]]; then
  echo "psql-from-env-file: informe um .sql ou os argumentos do psql" >&2
  exit 2
fi

for arg in "$@"; do
  case "$arg" in
    *postgres://*|*postgresql://*)
      echo "psql-from-env-file: não passe DSN por argumento" >&2
      exit 2
      ;;
  esac
done

file="${BARBERCLUB_PG_ENV_FILE:-}"
case "$file" in
  *postgres://*|*postgresql://*)
    echo "psql-from-env-file: BARBERCLUB_PG_ENV_FILE é um caminho, não um DSN" >&2
    exit 2
    ;;
esac
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "psql-from-env-file: defina BARBERCLUB_PG_ENV_FILE com o caminho do arquivo" >&2
  exit 2
fi
mode="$(stat -c %a "$file")"
if [[ "$mode" != "600" ]]; then
  echo "psql-from-env-file: o arquivo precisa estar em chmod 600 (está ${mode})" >&2
  exit 2
fi

tmp="$(mktemp)"
name="barberclub-psql-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if [[ -f "$tmp" ]]; then
    shred -u "$tmp" 2>/dev/null || rm -f "$tmp"
  fi
}
trap cleanup EXIT
cp "$file" "$tmp"
chmod 600 "$tmp"

psql_args=()
mounts=()
for arg in "$@"; do
  if [[ -f "$arg" ]]; then
    abs="$(cd "$(dirname "$arg")" && pwd)/$(basename "$arg")"
    mounts+=(-v "${abs}:/sql/input.sql:ro")
    psql_args+=(-f /sql/input.sql)
  else
    psql_args+=("$arg")
  fi
done

pgoptions=()
if [[ -n "${BARBERCLUB_PGOPTIONS:-}" ]]; then
  pgoptions=(-e "PGOPTIONS=${BARBERCLUB_PGOPTIONS}")
fi

if grep -q '^[A-Za-z_][A-Za-z0-9_]*=' "$tmp"; then
  docker run --name "$name" --network host \
    --env-file "$tmp" \
    "${pgoptions[@]}" \
    "${mounts[@]}" \
    postgres:17 \
    psql -v ON_ERROR_STOP=1 "${psql_args[@]}"
else
  IFS=: read -r host port db user _ < "$tmp"
  if [[ -z "${host:-}" || -z "${port:-}" || -z "${db:-}" || -z "${user:-}" ]]; then
    echo "psql-from-env-file: .pgpass incompleto" >&2
    exit 2
  fi
  docker run --name "$name" --network host \
    -e PGHOST="$host" \
    -e PGPORT="$port" \
    -e PGDATABASE="$db" \
    -e PGUSER="$user" \
    -e PGPASSFILE=/pgpass/pgpass \
    "${pgoptions[@]}" \
    -v "${tmp}:/pgpass/pgpass:ro" \
    "${mounts[@]}" \
    postgres:17 \
    psql -v ON_ERROR_STOP=1 "${psql_args[@]}"
fi
