#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/standalone-http.sh
source "$root/scripts/standalone-http.sh"
port="${PATH_HTTP_PORT:-3456}"
export APP_ENV=production
export ROOT_DOMAIN=barber.workloop.com.br
export PUBLIC_SCHEME=https
export PUBLIC_PORT=
export SUPABASE_URL="http://127.0.0.1:3999"
export SUPABASE_PUBLISHABLE_KEY="${SUPABASE_PUBLISHABLE_KEY:-stub}"
export BC_ROUTE_SECRET="${BC_ROUTE_SECRET:-0123456789abcdef0123456789abcdef}"
log=/tmp/barberclub-next-host.log
node "$root/scripts/stub-postgrest.mjs" >/tmp/barberclub-stub.log 2>&1 &
stub=$!
standalone_production_env "$port"
standalone_start "$root" "$log"
web=$!
cleanup() {
  kill "$web" "$stub" >/dev/null 2>&1 || true
  wait "$web" "$stub" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 40); do
  if curl -fsS -H "Host: barber.workloop.com.br" "http://127.0.0.1:${port}/api/health/live" >/dev/null; then
    set +e
    node "$root/scripts/check-host-http.mjs" "$port"
    code=$?
    set -e
    standalone_finish "$log" "$code"
    exit 0
  fi
  sleep 0.5
done
echo "check-host-http: servidor não ficou pronto" >&2
cat "$log" >&2 || true
exit 1
