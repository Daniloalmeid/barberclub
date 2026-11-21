#!/usr/bin/env bash
# Login, TOTP, handoff e cookie contra o Supabase local e o next start.
# A saída não imprime chave. Os segredos ficam só no ambiente do processo.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${LOGIN_HTTP_PORT:-3461}"
status="$(mktemp)"
chmod 600 "$status"
cleanup_status() { shred -u "$status" 2>/dev/null || rm -f "$status"; }
trap cleanup_status EXIT
supabase status -o env >"$status"
set -a
# shellcheck disable=SC1090
source "$status"
set +a
cleanup_status
trap - EXIT
export SUPABASE_URL="${API_URL:?}"
export SUPABASE_PUBLISHABLE_KEY="${ANON_KEY:?}"
export SUPABASE_SECRET_KEY="${SERVICE_ROLE_KEY:?}"
unset ANON_KEY SERVICE_ROLE_KEY API_URL
export HANDOFF_KEY="$(openssl rand -hex 32)"
export BC_ROUTE_SECRET="$(openssl rand -hex 32)"
export CRON_SECRET="$(openssl rand -hex 32)"
export APP_ENV=production
export ROOT_DOMAIN=barber.workloop.com.br
export PUBLIC_SCHEME=https
export PUBLIC_PORT=
cd "$root/apps/web"
pnpm exec next start -p "$port" >/tmp/barberclub-next-login.log 2>&1 &
web=$!
cleanup() {
  kill "$web" >/dev/null 2>&1 || true
  wait "$web" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 40); do
  if curl -fsS -H "Host: barber.workloop.com.br" "http://127.0.0.1:${port}/api/health/live" >/dev/null; then
    node "$root/scripts/check-login-http.mjs" "$port"
    exit 0
  fi
  sleep 0.5
done
echo "check-login-http: servidor não ficou pronto" >&2
cat /tmp/barberclub-next-login.log >&2 || true
exit 1
