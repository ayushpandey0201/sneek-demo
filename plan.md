# Sneek HMAC Demo - 8 Hour Test Plan

This document is a practical, time-boxed execution plan to prepare and validate the full demo in **8 hours max**.

It covers:
- local setup
- full end-to-end run
- cross-verification checks
- negative/failure testing
- evidence collection (screenshots/logs)
- final demo readiness checklist

---

## 1) Objective

By end of 8 hours, you should be able to reliably demonstrate:

1. User clicks login on client website.
2. QR is generated from encrypted payload.
3. Dummy Sneek scan API validates all verification gates.
4. Client backend accepts only valid signed callback.
5. Frontend transitions to authenticated for success.
6. Failure cases reject correctly (TTL, replay, token, cross-verification mismatch).

---

## 2) Scope and Components

### In scope
- `server.js` (core backend + mock Sneek flow + callback verification)
- `public/index.html`, `public/app.js`, `public/styles.css` (demo UI + polling + display)
- manual API testing via Postman or `curl`

### Out of scope (for this 8-hour demo)
- production hosting
- real external client integrations (Spotify/Amazon live)
- compliance, enterprise hardening, SOC2 controls

---

## 3) Prerequisites

Perform these once before starting the clock:

1. Node/npm available:
   - `node -v`
   - `npm -v`
2. Install dependencies:
   - `npm install`
3. Start server:
   - `node server.js`
4. Confirm bootstrap:
   - `curl -s http://localhost:3030/api/demo/bootstrap`

Expected:
- server running on `http://localhost:3030`
- bootstrap JSON returns `demoClient`, `postmanTarget`

---

## 4) 8-Hour Schedule (Detailed)

## Hour 0.0 - 0.5: Setup + Sanity

### Tasks
- verify runtime and start app
- open browser and confirm UI loads
- confirm `Login with Sneak` button works

### Where
- Terminal
- Browser at `http://localhost:3030`

### Evidence to capture
- screenshot of homepage
- terminal output showing server started

---

## Hour 0.5 - 2.0: Happy Path End-to-End

### Tasks
1. Click `Login with Sneak`.
2. Capture generated values from UI:
   - `sessionId`
   - `hmac`
   - `encryptedBlob`
   - Postman body
3. Send scan request to:
   - `POST http://localhost:3030/api/sneek/scan`
4. Watch frontend polling reach `authenticated`.

### Where
- Browser UI for generation + status updates
- Postman (or terminal `curl`) for scan call

### `curl` example
Use generated values from UI:

```bash
curl -X POST http://localhost:3030/api/sneek/scan \
  -H "Content-Type: application/json" \
  -d '{
    "encryptedBlob":"<paste-from-ui>",
    "userId":"sneak_user_99",
    "mobileToken":"demo-mobile-token",
    "name":"Rahul",
    "email":"rahul@gmail.com"
  }'
```

### Expected
- API: `ok: true`
- session status: `authenticated`
- frontend shows success card + session token + user profile
- gate states all pass

### Evidence
- screenshot of success UI
- scan API response JSON saved

---

## Hour 2.0 - 4.0: Gate-Level Negative Tests

Create a **fresh session before each test**.

### Test 1 - Invalid mobile token
- Change `mobileToken` to `wrong-token`.
- Expected: `401`, `mobileToken=failed`, session `rejected`.

### Test 2 - Decrypt failure
- Corrupt `encryptedBlob` (trim end chars or alter one char).
- Expected: decrypt failed response.

### Test 3 - TTL expiry
- Generate session and wait > 60 sec before scan.
- Expected: expired path, `sessionTtl=failed`.

### Test 4 - Replay
- Send same valid scan request twice.
- Expected: first success, second replay failure.

### Where
- Postman or `curl`
- browser UI timeline and gate grid

### Evidence
- one screenshot + one response JSON per failure type

---

## Hour 4.0 - 5.5: Cross-Verification Validation

Validate new cross-verification gates in success and tamper conditions:

- `clientSessionMatch`
- `clientPayloadMatch`
- `clientBlobMatch`
- `clientVerificationSummary`

### A) Success validation
- Run happy path and confirm all 4 are `passed`.

### B) Tamper validation strategy (demo-safe)
Because payload is encrypted, easiest demo-level way is:
- generate a fresh session for each scenario
- intentionally mismatch request inputs if possible
- verify system rejects with cross-verification failure messages where applicable

If you need deterministic tamper demonstrations, add temporary test flags in backend (optional, only for demo rehearsal):
- force payload digest mismatch
- force blob digest mismatch
- then remove before final delivery

### Evidence
- screenshots of gate grid containing cross-verification statuses
- response JSON showing rejection reason

---

## Hour 5.5 - 6.5: Full Dry-Run Script for Presentation

Prepare a deterministic script to present in order:

1. Start app.
2. Open UI.
3. Generate session.
4. Show payload/QR.
5. Execute successful scan.
6. Show success + token + user.
7. Generate another session.
8. Show one failure case (e.g., wrong mobile token).
9. Generate one more session.
10. Show replay protection (double submit).

### Where
- browser + Postman side by side

### Evidence
- single recording/screen capture recommended

---

## Hour 6.5 - 7.5: Clean-up + Stability Checks

### Tasks
- restart server and rerun happy path once
- ensure no stale state issue after restart
- confirm UI still clean and understandable
- ensure deleted `flow.html` link is gone

### Commands
- stop server
- `node server.js`
- rerun happy path

### Expected
- stable behavior after restart
- no broken links or missing resources

---

## Hour 7.5 - 8.0: Final Packaging

Create demo handoff material:

- short demo notes
- endpoints list
- known limitations
- success/failure screenshots folder

Suggested folder:
- `./demo-evidence/`
  - `happy-path-response.json`
  - `replay-failure-response.json`
  - `ttl-failure-response.json`
  - screenshots

---

## 5) Test Matrix (Quick Reference)

| Test ID | Scenario | Input Change | Expected Result |
|---|---|---|---|
| T1 | Happy path | valid blob + valid token | authenticated |
| T2 | Mobile token fail | wrong `mobileToken` | 401 rejected |
| T3 | Decrypt fail | corrupted blob | decrypt failed |
| T4 | TTL fail | delay > 60s | expired |
| T5 | Replay fail | same scan twice | second fails replay |
| T6 | Cross-check pass | normal valid flow | all cross gates passed |

---

## 6) Routes and What to Validate

### `GET /api/demo/bootstrap`
- app metadata and targets returned.

### `POST /api/client/login`
- generates session, payload, encrypted QR blob.
- response includes `postmanExample`.

### `GET /api/client/session/:sessionId`
- polling endpoint for status transitions.

### `POST /api/sneek/scan`
- full verification pipeline:
  - mobile token
  - decrypt
  - hmac
  - client cross verification
  - kid
  - ttl
  - replay
  - callback signature path

---

## 7) Demo Talk Track (What to say)

1. "Frontend never stores `K1`; trusted backend handles HMAC."
2. "QR carries encrypted blob, not plain payload."
3. "Sneek verifies identity + cryptographic integrity + replay/TTL."
4. "Client accepts login only after signed callback verification."
5. "Cross-verification ensures scanned data matches original client session record."

---

## 8) Known Demo Limitations (Say openly if asked)

- in-memory sessions (no persistent DB)
- single-node demo process
- dummy mobile token and dummy users
- mock Sneek and client backend in same service for simplicity

---

## 9) Final Go/No-Go Checklist

Before presentation, confirm all are true:

- [ ] Server starts cleanly
- [ ] Homepage loads
- [ ] Login creates QR + payload values
- [ ] Happy path reaches `authenticated`
- [ ] One failure path demonstrated (token or TTL)
- [ ] Replay protection demonstrated
- [ ] Cross-verification gates visible in UI
- [ ] No broken links/resources

If all checked, demo is presentation-ready.

