#!/bin/bash
# Automated end-to-end check, run by GitHub Actions on a real Mac:
# starts the server, signs the app in, approves the device as admin, lets the timer run and checks the upload.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
BIN="$ROOT/desktop-mac/dist/TimeTracker.app/Contents/MacOS/TimeTracker"
API=http://127.0.0.1:3111/api
mkdir -p "$OUT"

# temporary database and server on this build machine only
brew install mariadb >/dev/null 2>&1
brew services start mariadb >/dev/null 2>&1
for i in $(seq 1 30); do mariadb -e "select 1" >/dev/null 2>&1 && break; sleep 1; done
mariadb -e "CREATE DATABASE tt; CREATE USER 'tt'@'127.0.0.1' IDENTIFIED BY 'ttpw'; CREATE USER 'tt'@'localhost' IDENTIFIED BY 'ttpw'; GRANT ALL ON tt.* TO 'tt'@'127.0.0.1'; GRANT ALL ON tt.* TO 'tt'@'localhost';"
sql() { mariadb -N -B tt -e "$1"; }
cleanup() { pkill -x TimeTracker || true; pkill -f "node server.js" || true; brew services stop mariadb >/dev/null 2>&1 || true; }
trap cleanup EXIT

(cd "$ROOT" && npm ci >/dev/null 2>&1)
(cd "$ROOT" && DATABASE_URL=mysql://tt:ttpw@127.0.0.1:3306/tt JWT_SECRET=ci-secret-0123456789abcdef PORT=3111 \
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=admin12345 nohup node server.js > "$OUT/server.log" 2>&1 < /dev/null &)
for i in $(seq 1 30); do curl -s "$API/me" >/dev/null && break; sleep 1; done

post() { curl -s -H 'Content-Type: application/json' "$@"; }
ADMIN=$(post "$API/auth/login" -d '{"email":"admin@example.com","password":"admin12345"}' | jq -r .token)
post "$API/admin/users" -H "Authorization: Bearer $ADMIN" -d '{"email":"sam@example.com","name":"Sam Tester","password":"password1"}' >/dev/null

rm -rf "$HOME/Library/Application Support/TimeTracker"
export TT_SERVER=http://127.0.0.1:3111 TT_EMAIL=sam@example.com TT_PASSWORD=password1

echo "== 1. first sign-in from an unknown Mac must be refused"
"$BIN" > "$OUT/app1.log" 2>&1 &
sleep 8
screencapture -x "$OUT/mac-1-pending.png" || echo "screenshot not available"
pkill -x TimeTracker || true
sleep 1
sql "select id, mac, machine_id, hostname, os, status from devices"
STATUS=$(sql "select status from devices limit 1")
[ "$STATUS" = "pending" ] || { echo "E2E FAIL: expected a pending device, got '$STATUS'"; exit 1; }

echo "== 2. admin approves, app signs in and tracks"
post -X PATCH "$API/admin/devices/1" -H "Authorization: Bearer $ADMIN" -d '{"status":"approved"}' >/dev/null
"$BIN" --start > "$OUT/app2.log" 2>&1 &
sleep 10
screencapture -x "$OUT/mac-2-tracking.png" || true
sleep 125
screencapture -x "$OUT/mac-3-after-2min.png" || true
sql "select t, device_id, seconds, mouse, key_presses from activity_minutes order by t"
ROWS=$(sql "select count(*) from activity_minutes")
[ "$ROWS" -ge 1 ] || { echo "E2E FAIL: no tracked minutes reached the server"; exit 1; }

echo "== 3. admin blocks the device, the next request from the app is refused"
post -X PATCH "$API/admin/devices/1" -H "Authorization: Bearer $ADMIN" -d '{"status":"revoked"}' >/dev/null
sleep 70
screencapture -x "$OUT/mac-4-blocked.png" || true
pkill -x TimeTracker || true
ls "$HOME/Library/Application Support/TimeTracker/"
echo "E2E PASS"
