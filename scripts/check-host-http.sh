#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${PATH_HTTP_PORT:-3456}"
export APP_ENV=production
export ROOT_DOMAIN=barber.workloop.com.br
export PUBLIC_SCHEME=https
export PUBLIC_PORT=
export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:3999}"
export SUPABASE_PUBLISHABLE_KEY="${SUPABASE_PUBLISHABLE_KEY:-stub}"
node "$root/scripts/stub-postgrest.mjs" >/tmp/barberclub-stub.log 2>&1 &
stub=$!
cd "$root/apps/web"
pnpm exec next start -p "$port" >/tmp/barberclub-next-host.log 2>&1 &
web=$!
cleanup() {
  kill "$web" "$stub" >/dev/null 2>&1 || true
  wait "$web" "$stub" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 40); do
  if curl -fsS -H "Host: barber.workloop.com.br" "http://127.0.0.1:${port}/api/health/live" >/dev/null; then
    node "$root/scripts/check-host-http.mjs" "$port"
    exit 0
  fi
  sleep 0.5
done
echo "check-host-http: servidor não ficou pronto" >&2
cat /tmp/barberclub-next-host.log >&2 || true
exit 1
