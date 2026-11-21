#!/usr/bin/env bash
# Conta entradas TABLE do pg_restore --list, sem TABLE DATA. Lê a lista pelo stdin.
# Uso: pg_restore --list dump | scripts/count-dump-tables.sh 28
set -euo pipefail

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "uso: pg_restore --list <dump> | count-dump-tables.sh <esperado>" >&2
  exit 2
fi

expected="$1"
n="$(awk '$4 == "TABLE" && $5 != "DATA" { c++ } END { print c+0 }')"
if [[ "$n" != "$expected" ]]; then
  echo "count-dump-tables: $n tabelas, esperado $expected" >&2
  exit 1
fi
echo "tabelas=$n"
