#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3030}"
INTRO_TOKEN="${INTRO_TOKEN:-demo-introspection-token}"

echo "==> 1) Creating login session"
LOGIN_RESPONSE=$(curl -sS -X POST "${BASE_URL}/api/client/login" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"spotify_123"}')

SESSION_ID=$(printf '%s' "$LOGIN_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.session.sessionId)")
CLIENT_ID=$(printf '%s' "$LOGIN_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.session.clientId)")
ENCRYPTED_BLOB=$(printf '%s' "$LOGIN_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.postmanExample.body.encryptedBlob)")

echo "Session: ${SESSION_ID}"
echo "Client:  ${CLIENT_ID}"

echo "==> 2) Introspection (pending tx check)"
INTROSPECT_STATUS=$(curl -sS -o /tmp/sneek-introspect.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/client/introspect" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${INTRO_TOKEN}" \
  -d "{\"txId\":\"${SESSION_ID}\",\"clientId\":\"${CLIENT_ID}\"}")
echo "Introspection HTTP ${INTROSPECT_STATUS}"
cat /tmp/sneek-introspect.json
echo

echo "==> 3) Happy path scan"
HAPPY_STATUS=$(curl -sS -o /tmp/sneek-happy.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/sneek/scan" \
  -H "Content-Type: application/json" \
  -d "{\"encryptedBlob\":\"${ENCRYPTED_BLOB}\",\"userId\":\"sneak_user_99\",\"mobileToken\":\"demo-mobile-token\",\"name\":\"Rahul\",\"email\":\"rahul@gmail.com\"}")
echo "Happy scan HTTP ${HAPPY_STATUS}"
cat /tmp/sneek-happy.json
echo

echo "==> 4) Replay scan with same blob/session"
REPLAY_STATUS=$(curl -sS -o /tmp/sneek-replay.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/sneek/scan" \
  -H "Content-Type: application/json" \
  -d "{\"encryptedBlob\":\"${ENCRYPTED_BLOB}\",\"userId\":\"sneak_user_99\",\"mobileToken\":\"demo-mobile-token\"}")
echo "Replay scan HTTP ${REPLAY_STATUS} (expect 409)"
cat /tmp/sneek-replay.json
echo

echo "==> 5) Stale callback attempt"
STALE_STATUS=$(curl -sS -o /tmp/sneek-stale-callback.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/client/callback" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"cb_manual_stale_1\",\"clientId\":\"${CLIENT_ID}\",\"sessionId\":\"${SESSION_ID}\",\"timestamp\":\"2000-01-01T00:00:00.000Z\",\"userProfile\":{\"userId\":\"sneak_user_99\",\"name\":\"Rahul\",\"email\":\"rahul@gmail.com\"},\"signature\":\"dummy-signature\"}")
echo "Stale callback HTTP ${STALE_STATUS} (expect 401)"
cat /tmp/sneek-stale-callback.json
echo

echo "==> Done. Inspect /tmp/sneek-*.json for outputs."
