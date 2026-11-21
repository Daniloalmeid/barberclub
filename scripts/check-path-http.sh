#!/usr/bin/env bash
# Sobe o next start do build e confere os paths com HTTP cru (sem normalizar no cliente).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${PATH_HTTP_PORT:-3456}"
cd "$root/apps/web"
pnpm exec next start -p "$port" >/tmp/barberclub-next-start.log 2>&1 &
pid=$!
cleanup() {
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 40); do
  if node --input-type=module -e "
    import net from 'node:net';
    const port = Number(process.argv[1]);
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET /api/health/live HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n');
    });
    let data = '';
    sock.on('data', (c) => { data += c; });
    sock.on('end', () => process.exit(data.includes(' 200 ') ? 0 : 1));
    sock.on('error', () => process.exit(1));
  " "$port"; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" != "1" ]]; then
  echo "check-path-http: o next start não ficou pronto" >&2
  cat /tmp/barberclub-next-start.log >&2 || true
  exit 1
fi

node "$root/scripts/check-path-http.mjs" "$port"
