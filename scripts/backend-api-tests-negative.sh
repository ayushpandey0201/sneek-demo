#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3030}"

create_session() {
  curl -sS -X POST "${BASE_URL}/api/client/login" \
    -H "Content-Type: application/json" \
    -d '{"clientId":"spotify_123"}'
}

extract_field() {
  local json="$1"
  local expr="$2"
  printf '%s' "$json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(${expr}))"
}

echo "==> Negative test 1: invalid mobile token"
LOGIN_ONE=$(create_session)
SESSION_ONE=$(extract_field "$LOGIN_ONE" "d.session.sessionId")
BLOB_ONE=$(extract_field "$LOGIN_ONE" "d.postmanExample.body.encryptedBlob")

STATUS_ONE=$(curl -sS -o /tmp/sneek-neg-invalid-token.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/sneek/scan" \
  -H "Content-Type: application/json" \
  -d "{\"encryptedBlob\":\"${BLOB_ONE}\",\"userId\":\"sneak_user_99\",\"mobileToken\":\"wrong-token\"}")

echo "Session ${SESSION_ONE} -> HTTP ${STATUS_ONE} (expect 401)"
cat /tmp/sneek-neg-invalid-token.json
echo

echo "==> Negative test 2: decrypt failure from corrupted blob"
LOGIN_TWO=$(create_session)
SESSION_TWO=$(extract_field "$LOGIN_TWO" "d.session.sessionId")
BLOB_TWO=$(extract_field "$LOGIN_TWO" "d.postmanExample.body.encryptedBlob")
CORRUPTED_BLOB="${BLOB_TWO%??}xx"

STATUS_TWO=$(curl -sS -o /tmp/sneek-neg-decrypt.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/sneek/scan" \
  -H "Content-Type: application/json" \
  -d "{\"encryptedBlob\":\"${CORRUPTED_BLOB}\",\"userId\":\"sneak_user_99\",\"mobileToken\":\"demo-mobile-token\"}")

echo "Session ${SESSION_TWO} -> HTTP ${STATUS_TWO} (expect 400)"
cat /tmp/sneek-neg-decrypt.json
echo

echo "==> Negative test 3: TTL expiry (>60s before scan)"
LOGIN_THREE=$(create_session)
SESSION_THREE=$(extract_field "$LOGIN_THREE" "d.session.sessionId")
BLOB_THREE=$(extract_field "$LOGIN_THREE" "d.postmanExample.body.encryptedBlob")
echo "Session ${SESSION_THREE} created; sleeping 65s to force expiry..."
sleep 65

STATUS_THREE=$(curl -sS -o /tmp/sneek-neg-ttl.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/sneek/scan" \
  -H "Content-Type: application/json" \
  -d "{\"encryptedBlob\":\"${BLOB_THREE}\",\"userId\":\"sneak_user_99\",\"mobileToken\":\"demo-mobile-token\"}")

echo "Session ${SESSION_THREE} -> HTTP ${STATUS_THREE} (expect 410)"
cat /tmp/sneek-neg-ttl.json
echo

echo "==> Done. Inspect /tmp/sneek-neg-*.json for outputs."
