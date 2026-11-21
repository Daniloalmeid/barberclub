#!/usr/bin/env bash
# Login, TOTP, handoff e cookie contra o Supabase local e o servidor standalone.
# A saída não imprime chave. Os segredos ficam só no ambiente do processo.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/standalone-http.sh
source "$root/scripts/standalone-http.sh"
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
# O teste da migration de slug encerra as conexões do Postgres. O GoTrue
# fica com o pool morto e o grant devolve 57P01. Subir o auth de novo.
auth_cid="$(docker ps -qf name=supabase_auth_ | head -1)"
if [[ -n "$auth_cid" ]]; then
  docker restart "$auth_cid" >/dev/null
fi
ready_auth=0
for _ in $(seq 1 30); do
  if curl -fsS "${SUPABASE_URL}/auth/v1/health" >/dev/null; then
    ready_auth=1
    break
  fi
  sleep 0.5
done
if [[ "$ready_auth" != "1" ]]; then
  echo "check-login-http: o auth não voltou depois do restart" >&2
  exit 1
fi
log=/tmp/barberclub-next-login.log
standalone_production_env "$port"
standalone_start "$root" "$log"
web=$!
cleanup() {
  kill "$web" >/dev/null 2>&1 || true
  wait "$web" 2>/dev/null || true
  standalone_cleanup
}
trap cleanup EXIT
for _ in $(seq 1 40); do
  if curl -fsS -H "Host: barber.workloop.com.br" "http://127.0.0.1:${port}/api/health/live" >/dev/null; then
    set +e
    node "$root/scripts/check-login-http.mjs" "$port"
    code=$?
    set -e
    if [[ "$code" != "0" ]]; then
      auth="$(docker ps -qf name=supabase_auth_ | head -1)"
      if [[ -n "$auth" ]]; then
        docker logs --tail 40 "$auth" 2>&1 | grep -E 'error finding user|Scan error|querying schema' | tail -20 >&2 || true
      fi
    fi
    standalone_finish "$log" "$code"
    exit 0
  fi
  sleep 0.5
done
echo "check-login-http: servidor não ficou pronto" >&2
cat "$log" >&2 || true
exit 1
