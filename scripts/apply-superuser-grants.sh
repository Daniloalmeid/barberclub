#!/usr/bin/env bash
# Somente CI e Supabase local: docker exec + trust, sem senha na linha de comando.
# O caminho por rede (M2/M3) é scripts/psql-from-env-file.sh com o SQL versionado.
# Não é backup e não usa -e PGPASSWORD.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cid="$(docker ps -qf name=supabase_db_ | head -1)"
if [ -z "$cid" ]; then
  echo "container do Postgres local não está no ar" >&2
  exit 1
fi
docker exec -i -u postgres "$cid" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$root/supabase/admin/superuser.sql"
