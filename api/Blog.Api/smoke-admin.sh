#!/usr/bin/env bash
# Regressionstest af databaseflowet. Kør fra repo-roden:
#   bash api/Blog.Api/smoke-admin.sh
# Den starter en midlertidig API-instans på port 5199 og rydder testindlæg op bagefter.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KEY=${ADMIN_KEY:-test-key}
SMOKE_PORT=${SMOKE_PORT:-5199}
BASE="http://127.0.0.1:$SMOKE_PORT"
SLUG="regression-$(date +%s)"
LOG=$(mktemp)
export Admin__Key="$KEY"
export ASPNETCORE_URLS="$BASE"

cd "$ROOT"
dotnet build api/Blog.Api/Blog.Api.csproj -v quiet >/dev/null
cd "$ROOT/api/Blog.Api"
dotnet bin/Debug/net10.0/Blog.Api.dll >"$LOG" 2>&1 &
PID=$!
cleanup() {
  curl -sS -o /dev/null -X DELETE -H "X-Admin-Key: $KEY" "$BASE/api/admin/blog/posts/$SLUG/purge" || true
  kill "$PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "$BASE/api/health" >/dev/null || { cat "$LOG"; echo "API'et startede ikke"; exit 1; }

check() { # navn, forventet, faktisk
  if [ "$2" != "$3" ]; then echo "FEJL: $1 (forventede $2, fik $3)"; exit 1; fi
  echo "OK: $1"
}

PAYLOAD='{"title":"Regressionstest","bodyMarkdown":"# Test\n\nHej","bodyHtml":"<h1>Test</h1><p>Hej</p>","publishDate":"2026-01-01T10:00:00Z","draft":true,"tags":["test"],"sites":[],"captions":null}'
code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H "X-Admin-Key: $KEY" -H 'Content-Type: application/json' --data "$PAYLOAD" "$BASE/api/admin/blog/posts/$SLUG")
check "gem kladde" 200 "$code"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/$SLUG")
check "kladde er ikke offentlig" 404 "$code"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H "X-Admin-Key: $KEY" -H 'Content-Type: application/json' --data "$PAYLOAD" "$BASE/api/admin/blog/posts/$SLUG")
check "gem igen" 200 "$code"

LINK=$(curl -fsS -X POST -H "X-Admin-Key: $KEY" "$BASE/api/admin/blog/posts/$SLUG/preview-link")
PREVIEW=$(printf '%s' "$LINK" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
[ -n "$PREVIEW" ] || { echo "FEJL: preview-link mangler"; exit 1; }
code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE$PREVIEW")
check "preview virker" 200 "$code"

REVISIONS=$(curl -fsS -H "X-Admin-Key: $KEY" "$BASE/api/admin/blog/posts/$SLUG/revisions")
case "$REVISIONS" in *'"id"'*) echo "OK: versionshistorik";; *) echo "FEJL: versionshistorik er tom"; exit 1;; esac

code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "X-Admin-Key: $KEY" "$BASE/api/admin/blog/posts/$SLUG")
check "flyt til papirkurv" 204 "$code"
TRASH=$(curl -fsS -H "X-Admin-Key: $KEY" "$BASE/api/admin/blog/posts?trash=true")
case "$TRASH" in *"$SLUG"*) echo "OK: papirkurv";; *) echo "FEJL: indlægget er ikke i papirkurven"; exit 1;; esac
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "X-Admin-Key: $KEY" "$BASE/api/admin/blog/posts/$SLUG/restore")
check "gendan fra papirkurv" 200 "$code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Admin-Key: $KEY" "$BASE/api/admin/diagnostics")
check "diagnostik" 200 "$code"
code=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Admin-Key: $KEY" "$BASE/api/admin/backup/export")
check "backup-eksport" 200 "$code"
code=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Admin-Key: $KEY" "$BASE/api/admin/blog/media")
check "mediebibliotek" 200 "$code"

echo "Alle regressionstests bestod for $SLUG."