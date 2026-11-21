#!/usr/bin/env bash
# Define a senha do backup_reader. A senha entra por arquivo em tmpfs,
# chmod 600. Não vai para argumento, nem para a saída. O psql usa -f
# de um SQL gerado no mesmo tmpfs, apagado com shred no fim.
#
#   BARBERCLUB_PG_ENV_FILE=/run/secrets/migrate.pgpass \
#   BARBERCLUB_BACKUP_READER_PASSWORD_FILE=/run/secrets/backup-reader.password \
#     scripts/set-backup-reader-password.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="${BARBERCLUB_BACKUP_READER_PASSWORD_FILE:-}"
if [[ -z "$src" || ! -f "$src" ]]; then
  echo "set-backup-reader-password: defina BARBERCLUB_BACKUP_READER_PASSWORD_FILE" >&2
  exit 2
fi
mode="$(stat -c %a "$src")"
if [[ "$mode" != "600" ]]; then
  echo "set-backup-reader-password: o arquivo precisa estar em chmod 600 (está ${mode})" >&2
  exit 2
fi
fstype="$(findmnt -n -o FSTYPE -T "$src" 2>/dev/null || true)"
case "$src" in
  /run/secrets/*|/dev/shm/*) ;;
  *)
    echo "set-backup-reader-password: a senha tem de estar em tmpfs (/run/secrets ou /dev/shm)" >&2
    exit 2
    ;;
esac
if [[ -n "$fstype" && "$fstype" != "tmpfs" ]]; then
  echo "set-backup-reader-password: ${src} não está em tmpfs (${fstype})" >&2
  exit 2
fi

dir="$(dirname "$src")"
sql="${dir}/backup-reader-alter-$$.sql"
out="${dir}/backup-reader-alter-$$.out"
cleanup() {
  if [[ -f "$sql" ]]; then
    shred -u "$sql" 2>/dev/null || rm -f "$sql"
  fi
  if [[ -f "$out" ]]; then
    shred -u "$out" 2>/dev/null || rm -f "$out"
  fi
}
trap cleanup EXIT

install -m 600 /dev/null "$sql"
pw="$(cat "$src")"
if [[ -z "$pw" || "$pw" == *$'\n'* ]]; then
  echo "set-backup-reader-password: senha vazia ou com quebra de linha" >&2
  exit 2
fi
escaped="${pw//\'/\'\'}"
pw=""
printf "alter role backup_reader with password '%s';\n" "$escaped" > "$sql"
escaped=""
chmod 600 "$sql"

set +e
"$root/scripts/psql-from-env-file.sh" "$sql" >"$out" 2>&1
status=$?
set -e
if [[ "$status" -ne 0 ]]; then
  exit "$status"
fi

dest="${BARBERCLUB_BACKUP_READER_PGPASS:-}"
if [[ -n "$dest" ]]; then
  if [[ -z "${PGHOST:-}" || -z "${PGPORT:-}" || -z "${PGDATABASE:-}" ]]; then
    echo "set-backup-reader-password: PGHOST, PGPORT e PGDATABASE definem o .pgpass" >&2
    exit 2
  fi
  install -d -m 700 "$(dirname "$dest")"
  install -m 600 /dev/null "$dest"
  pw="$(cat "$src")"
  esc="${pw//\\/\\\\}"
  esc="${esc//:/\\:}"
  pw=""
  printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$PGDATABASE" "backup_reader" "$esc" > "$dest"
  esc=""
  chmod 600 "$dest"
fi
printf '%s\n' 'senha definida'
