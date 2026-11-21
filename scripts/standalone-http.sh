#!/usr/bin/env bash
# Prepara e sobe o artefato standalone do monorepo.
# Quem inclui este arquivo já usa set -euo pipefail.
# O comando é node .next/standalone/apps/web/server.js, a partir de apps/web.
# next start não prova output: standalone.

standalone_prepare() {
  local root="$1"
  local app="$root/apps/web"
  local stand="$app/.next/standalone"
  if [[ ! -f "$stand/apps/web/server.js" ]]; then
    echo "harness: falta ${stand}/apps/web/server.js. Rode pnpm --filter web build." >&2
    return 1
  fi
  mkdir -p "$stand/apps/web/.next"
  rm -rf "$stand/apps/web/.next/static" "$stand/apps/web/public"
  cp -a "$app/.next/static" "$stand/apps/web/.next/static"
  cp -a "$app/public" "$stand/apps/web/public"
}

standalone_production_env() {
  local port="$1"
  export NODE_ENV=production
  export APP_ENV=production
  export ROOT_DOMAIN="${ROOT_DOMAIN:-barber.workloop.com.br}"
  export PUBLIC_SCHEME="${PUBLIC_SCHEME:-https}"
  export PUBLIC_PORT="${PUBLIC_PORT-}"
  export BC_ROUTE_SECRET="${BC_ROUTE_SECRET:-0123456789abcdef0123456789abcdef}"
  export HANDOFF_KEY="${HANDOFF_KEY:-00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff}"
  export REVALIDATE_SECRET="${REVALIDATE_SECRET:-ci-revalidate-not-a-production-secret}"
  export CRON_SECRET="${CRON_SECRET:-ci-cron-not-a-production-secret}"
  export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:9}"
  export SUPABASE_PUBLISHABLE_KEY="${SUPABASE_PUBLISHABLE_KEY:-ci-publishable}"
  export SUPABASE_SECRET_KEY="${SUPABASE_SECRET_KEY:-ci-secret}"
  export HOSTNAME=127.0.0.1
  export PORT="$port"
  export NEXT_TELEMETRY_DISABLED=1
}

standalone_start() {
  local root="$1"
  local log="$2"
  standalone_prepare "$root"
  (
    cd "$root/apps/web"
    exec node .next/standalone/apps/web/server.js
  ) >"$log" 2>&1 &
}

standalone_finish() {
  local log="$1"
  local code="$2"
  if grep -F 'does not work with "output: standalone"' "$log" >/dev/null 2>&1; then
    echo "harness: o log tem o aviso de next start com output standalone" >&2
    cat "$log" >&2 || true
    exit 1
  fi
  if [[ "$code" != "0" ]]; then
    echo "harness: caso esperado falhou (exit ${code})" >&2
    cat "$log" >&2 || true
    exit "$code"
  fi
}
