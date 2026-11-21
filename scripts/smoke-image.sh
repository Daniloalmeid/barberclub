#!/usr/bin/env bash
# Sobe a imagem já carregada no daemon e exige /api/health/live 200 em 30s.
# Também confere que /api/health devolve o GIT_COMMIT da build.
set -euo pipefail
image="${1:?imagem}"
sha="${2:?sha}"
port="${SMOKE_PORT:-3456}"
name="barberclub-smoke-$$"
docker run -d --name "$name" -p "127.0.0.1:${port}:3000" "$image" >/dev/null
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
