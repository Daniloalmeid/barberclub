#!/usr/bin/env bash
# Sobe a imagem já carregada no daemon e exige /api/health/live 200 em 30s.
# Também confere que /api/health devolve o GIT_COMMIT da build.
set -euo pipefail
image="${1:?imagem}"
sha="${2:?sha}"
port="${SMOKE_PORT:-3456}"
name="barberclub-smoke-$$"
prod_env=(
  -e APP_ENV=production
  -e ROOT_DOMAIN=barber.workloop.com.br
  -e PUBLIC_SCHEME=https
  -e PUBLIC_PORT=
  -e HANDOFF_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
  -e REVALIDATE_SECRET=ci-revalidate-not-a-production-secret
  -e BC_ROUTE_SECRET=ci-route-seal-32-characters-minimum
  -e SUPABASE_URL=http://127.0.0.1:9
  -e SUPABASE_PUBLISHABLE_KEY=ci-publishable
  -e SUPABASE_SECRET_KEY=ci-secret
)
closed_name="barberclub-smoke-closed-$$"
closed_port="${SMOKE_CLOSED_PORT:-3457}"
docker run -d --name "$closed_name" -p "127.0.0.1:${closed_port}:3000" \
  -e NODE_ENV=production -e APP_ENV=production -e PUBLIC_SCHEME=https -e PUBLIC_PORT= \
  "$image" >/dev/null
closed_code="000"
closed_deadline=$((SECONDS + 20))
while (( SECONDS < closed_deadline )); do
  closed_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${closed_port}/api/health/live" || true)"
  if [[ "$closed_code" != "000" ]]; then
    break
  fi
  sleep 1
done
docker logs "$closed_name" >&2 || true
docker rm -f "$closed_name" >/dev/null 2>&1 || true
if [[ "$closed_code" == "200" || "$closed_code" == "000" ]]; then
  echo "smoke: sem ROOT_DOMAIN o /api/health/live veio ${closed_code}, esperado falha" >&2
  exit 1
fi
secret_name="barberclub-smoke-secret-$$"
secret_port="${SMOKE_SECRET_PORT:-3458}"
docker run -d --name "$secret_name" -p "127.0.0.1:${secret_port}:3000" \
  -e NODE_ENV=production -e APP_ENV=production \
  -e ROOT_DOMAIN=barber.workloop.com.br -e PUBLIC_SCHEME=https -e PUBLIC_PORT= \
  "$image" >/dev/null
secret_code="000"
secret_deadline=$((SECONDS + 20))
while (( SECONDS < secret_deadline )); do
  secret_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${secret_port}/api/health/live" || true)"
  if [[ "$secret_code" != "000" ]]; then
    break
  fi
  sleep 1
done
docker rm -f "$secret_name" >/dev/null 2>&1 || true
if [[ "$secret_code" == "200" || "$secret_code" == "000" ]]; then
  echo "smoke: sem BC_ROUTE_SECRET o /api/health/live veio ${secret_code}, esperado falha" >&2
  exit 1
fi
docker run -d --name "$name" -p "127.0.0.1:${port}:3000" "${prod_env[@]}" "$image" >/dev/null
cleanup() {
  docker logs "$name" >&2 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
deadline=$((SECONDS + 30))
live=""
while (( SECONDS < deadline )); do
  if live="$(curl -fsS "http://127.0.0.1:${port}/api/health/live" 2>/dev/null)"; then
    break
  fi
  live=""
  sleep 1
done
if [[ -z "$live" ]]; then
  echo "smoke: /api/health/live não respondeu 200 em 30s" >&2
  exit 1
fi
home_code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: barber.workloop.com.br" "http://127.0.0.1:${port}/")"
if [[ "$home_code" != "200" ]]; then
  echo "smoke: GET / com Host de produção veio ${home_code}" >&2
  exit 1
fi
printf '%s\n' "$live"
node --input-type=module -e '
const live = JSON.parse(process.argv[1]);
if (live.status !== "ok") {
  console.error("smoke: live sem status ok");
  process.exit(1);
}
' "$live"
body="$(curl -sS "http://127.0.0.1:${port}/api/health" || true)"
printf '%s\n' "$body"
node --input-type=module -e '
const body = JSON.parse(process.argv[1]);
if (body.commit !== process.argv[2]) {
  console.error("smoke: commit " + body.commit + " esperado " + process.argv[2]);
  process.exit(1);
}
' "$body" "$sha"
revision="$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
if [[ "$revision" != "$sha" ]]; then
  echo "smoke: label revision ${revision:-vazia} esperado ${sha}" >&2
  exit 1
fi
trap - EXIT
docker rm -f "$name" >/dev/null
echo "smoke ok ${sha}"
