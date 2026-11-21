#!/usr/bin/env bash
# psql contra o Postgres alvo. A senha fica num .pgpass chmod 600, montado :ro
# em PGPASSFILE. Não usa --env-file nem -e PGPASSWORD (os dois aparecem em
# docker inspect). Um env-file KEY=VALUE é convertido em .pgpass num tmpfs
# (/run ou /dev/shm), nunca em /tmp. O .pgpass original é montado direto.
#
#   BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.pgpass scripts/psql-from-env-file.sh arquivo.sql
#   BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.pgpass scripts/psql-from-env-file.sh -tA -c "select 1"
#
# Porta 6543 (transaction pooler) é recusada. Fora de localhost, PGSSLMODE
# vazio vira verify-full. No host do Supabase Cloud, verify-full é obrigatório.
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

name="barberclub-psql-$$"
generated=""
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if [[ -n "$generated" && -f "$generated" ]]; then
    shred -u "$generated" 2>/dev/null || rm -f "$generated"
  fi
}
trap cleanup EXIT

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

pgpass_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//:/\\:}"
  printf '%s' "$s"
}

env_value() {
  local key="$1" line
  line="$(grep -E "^${key}=" "$file" | head -1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "$line" == \"*\" && "$line" == *\" ]]; then
    line="${line:1:${#line}-2}"
  fi
  printf '%s' "$line"
}

tmpfs_dir() {
  local fstype
  fstype="$(findmnt -n -o FSTYPE -T /run 2>/dev/null || true)"
  if [[ "$fstype" == "tmpfs" ]]; then
    install -d -m 700 /run/secrets
    printf '%s' /run/secrets
    return
  fi
  fstype="$(findmnt -n -o FSTYPE -T /dev/shm 2>/dev/null || true)"
  if [[ "$fstype" == "tmpfs" ]]; then
    printf '%s' /dev/shm
    return
  fi
  echo "psql-from-env-file: sem tmpfs para converter o env-file" >&2
  exit 2
}

if grep -q '^[A-Za-z_][A-Za-z0-9_]*=' "$file"; then
  host="$(env_value PGHOST)"
  port="$(env_value PGPORT)"
  db="$(env_value PGDATABASE)"
  user="$(env_value PGUSER)"
  pass="$(env_value PGPASSWORD)"
  if [[ -z "$host" || -z "$port" || -z "$db" || -z "$user" || -z "$pass" ]]; then
    echo "psql-from-env-file: env-file sem PGHOST, PGPORT, PGDATABASE, PGUSER ou PGPASSWORD" >&2
    exit 2
  fi
  generated="$(tmpfs_dir)/barberclub-pgpass.$$"
  install -m 600 /dev/null "$generated"
  printf '%s:%s:%s:%s:%s\n' \
    "$(pgpass_escape "$host")" \
    "$(pgpass_escape "$port")" \
    "$(pgpass_escape "$db")" \
    "$(pgpass_escape "$user")" \
    "$(pgpass_escape "$pass")" > "$generated"
  pass=""
  chmod 600 "$generated"
  pgpass="$generated"
else
  IFS=: read -r host port db user _ < "$file"
  if [[ -z "${host:-}" || -z "${port:-}" || -z "${db:-}" || -z "${user:-}" ]]; then
    echo "psql-from-env-file: .pgpass incompleto" >&2
    exit 2
  fi
  pgpass="$file"
fi

if [[ "$port" == "6543" ]]; then
  echo "psql-from-env-file: porta 6543 é o transaction pooler; use 5432 direto ou o session pooler" >&2
  exit 2
fi

sslmode="${PGSSLMODE:-}"
case "$host" in
  localhost|127.0.0.1|::1) ;;
  *)
    if [[ -z "$sslmode" ]]; then
      sslmode=verify-full
    fi
    ;;
esac
case "$host" in
  *.supabase.co|*.pooler.supabase.com|*.supabase.com)
    if [[ "$sslmode" != "verify-full" ]]; then
      echo "psql-from-env-file: Cloud exige PGSSLMODE=verify-full" >&2
      exit 2
    fi
    ;;
esac

docker_env=(-e "PGHOST=${host}" -e "PGPORT=${port}" -e "PGDATABASE=${db}" -e "PGUSER=${user}" -e PGPASSFILE=/pgpass/pgpass)
if [[ -n "$sslmode" ]]; then
  docker_env+=(-e "PGSSLMODE=${sslmode}")
fi
if [[ -n "${PGSSLROOTCERT:-}" ]]; then
  if [[ ! -f "$PGSSLROOTCERT" ]]; then
    echo "psql-from-env-file: PGSSLROOTCERT não é arquivo" >&2
    exit 2
  fi
  mounts+=(-v "${PGSSLROOTCERT}:/pgssl/root.crt:ro")
  docker_env+=(-e PGSSLROOTCERT=/pgssl/root.crt)
fi

docker run --name "$name" --network host \
  "${docker_env[@]}" \
  -v "${pgpass}:/pgpass/pgpass:ro" \
  "${mounts[@]}" \
  postgres:17 \
  psql -v ON_ERROR_STOP=1 "${psql_args[@]}"
