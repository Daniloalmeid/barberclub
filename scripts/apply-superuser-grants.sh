#!/usr/bin/env bash
# Aplica o que só o supabase_admin consegue. Não é backup e não usa PGPASSWORD na linha de comando.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cid="$(docker ps -qf name=supabase_db_ | head -1)"
if [ -z "$cid" ]; then
  echo "container do Postgres local não está no ar" >&2
  exit 1
fi
docker exec -i -u postgres "$cid" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$root/supabase/admin/superuser.sql"
