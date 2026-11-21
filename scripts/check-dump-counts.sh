#!/usr/bin/env bash
# Confere a contagem de TABLE do pg_restore --list nos dois dumps da janela.
# Roda no CI local, depois dos grants, como backup_reader.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cid="$(docker ps -qf name=supabase_db_ | head -1)"
if [[ -z "$cid" ]]; then
  echo "check-dump-counts: container do Postgres local não está no ar" >&2
  exit 1
fi

docker exec -u postgres "$cid" pg_dump -h 127.0.0.1 -U backup_reader -d postgres -Fc \
  --exclude-table-data=private.login_handoffs \
  -n public -n private -n ledger -n public_api -n server_api -f /tmp/schemas.dump
docker exec -u postgres "$cid" pg_restore --list /tmp/schemas.dump | "$root/scripts/count-dump-tables.sh" 32
if docker exec -u postgres "$cid" pg_restore --list /tmp/schemas.dump | grep -F 'TABLE DATA private login_handoffs'; then
  echo "check-dump-counts: o dump inclui os tokens de login_handoffs" >&2
  exit 1
fi

docker exec -u postgres "$cid" pg_dump -h 127.0.0.1 -U backup_reader -d postgres -Fc \
  -t auth.users -t auth.identities -f /tmp/auth.dump
docker exec -u postgres "$cid" pg_restore --list /tmp/auth.dump | "$root/scripts/count-dump-tables.sh" 2

docker exec -u postgres "$cid" rm -f /tmp/schemas.dump /tmp/auth.dump
