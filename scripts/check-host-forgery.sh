#!/usr/bin/env bash
# Sete casos de forja de host. Sai 0 só se os sete passarem.
# --edge: só GET HTTPS em *.barber.workloop.com.br, sem subir servidor.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" == "--edge" ]]; then
  exec node "$root/scripts/check-host-forgery.mjs" --edge
fi
# shellcheck source=scripts/standalone-http.sh
source "$root/scripts/standalone-http.sh"
port="${FORGERY_HTTP_PORT:-3471}"
export APP_ENV=production
export ROOT_DOMAIN=barber.workloop.com.br
export PUBLIC_SCHEME=https
export PUBLIC_PORT=
export SUPABASE_URL="http://127.0.0.1:3999"
export SUPABASE_PUBLISHABLE_KEY="${SUPABASE_PUBLISHABLE_KEY:-stub}"
export BC_ROUTE_SECRET="${BC_ROUTE_SECRET:-0123456789abcdef0123456789abcdef}"
export BC_FORGERY_PROBE=1
log=/tmp/barberclub-next-forgery.log
node "$root/scripts/stub-postgrest.mjs" >/tmp/barberclub-stub-forgery.log 2>&1 &
stub=$!
standalone_production_env "$port"
standalone_start "$root" "$log"
web=$!
cleanup() {
  kill "$web" "$stub" >/dev/null 2>&1 || true
  wait "$web" "$stub" 2>/dev/null || true
  standalone_cleanup
}
trap cleanup EXIT
for _ in $(seq 1 40); do
  if curl -fsS -H "Host: barber.workloop.com.br" "http://127.0.0.1:${port}/api/health/live" >/dev/null; then
    set +e
    node "$root/scripts/check-host-forgery.mjs" "$port"
    code=$?
    set -e
    standalone_finish "$log" "$code"
    exit 0
  fi
  sleep 0.5
done
echo "check-host-forgery: servidor não ficou pronto" >&2
cat "$log" >&2 || true
exit 1
