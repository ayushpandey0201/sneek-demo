# Backend API Test Scripts

These scripts are for **Team A (backend/API)** validation of the Sneek demo.

## Prerequisite

Start the server first:

```bash
node server.js
```

Default base URL assumed by scripts:
- `http://localhost:3030`

You can override:

```bash
BASE_URL=http://localhost:3030 ./scripts/backend-api-tests.sh
```

---

## 1) Happy + Replay + Stale Callback

Run:

```bash
./scripts/backend-api-tests.sh
```

What it tests:
1. create login session
2. introspection check
3. happy scan success
4. replay scan failure
5. stale callback failure

Expected HTTP status codes:
- Introspection: `200`
- Happy scan: `200`
- Replay scan: `409`
- Stale callback: `401`

Output files written:
- `/tmp/sneek-introspect.json`
- `/tmp/sneek-happy.json`
- `/tmp/sneek-replay.json`
- `/tmp/sneek-stale-callback.json`

---

## 2) Negative Gate Tests

Run:

```bash
./scripts/backend-api-tests-negative.sh
```

What it tests:
1. invalid mobile token
2. corrupted encrypted blob (decrypt fail)
3. TTL expiry (>60 seconds)

Expected HTTP status codes:
- Invalid token: `401`
- Decrypt failure: `400`
- TTL expiry: `410`

Output files written:
- `/tmp/sneek-neg-invalid-token.json`
- `/tmp/sneek-neg-decrypt.json`
- `/tmp/sneek-neg-ttl.json`

---

## Notes

- Scripts intentionally stop on command errors (`set -euo pipefail`).
- These are demo validation scripts, not full unit/integration tests.
- For repeatability, use fresh server process before final rehearsal.

