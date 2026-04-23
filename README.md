# Sneek Auth

QR-based distributed authentication demo with explicit security gates.

Sneek Auth is a full-stack demo that models a modern QR login protocol across two services: a **Client Server** and a **Sneek Server**. It focuses on how authentication messages are validated step-by-step, not on production hardening.

## Why this project exists

Most auth demos stop at "it works." This one shows **why it should be trusted**:

- clear protocol boundaries between two services
- explicit verification gates (HMAC, KID, TTL, replay, callback signature)
- inspectable auth timeline and session state in the UI

## Demo Preview

> Add screenshots/GIF here:
>
> - Login + QR generated
> - Simulate scan
> - Authenticated state with user profile

## How it works

1. User clicks **Login with Sneek** in the frontend.
2. Client Server creates a short-lived session and QR payload (base64).
3. Frontend shows the QR and starts polling session status.
4. Sneek Server receives scan simulation.
5. Sneek validates security gates:
   - HMAC integrity
   - KID/origin
   - session TTL
   - replay protection
6. Sneek sends a signed callback to Client Server.
7. Client Server verifies callback signature and authenticates user.
8. Frontend polling detects success and updates UI.

## Security model (demo level)

- **HMAC integrity check**: validates payload authenticity.
- **KID/origin validation**: ensures expected client origin context.
- **Session TTL**: short-lived session window to reduce abuse.
- **Replay protection**: prevents QR/session reuse.
- **Signed callback verification**: client trusts only valid Sneek callbacks.

## Architecture

```text
Frontend (Vanilla JS)
   |
   | generate-qr, session-status
   v
Client Server :3000
   ^
   | signed callback + introspection
   v
Sneek Server :4000
   ^
   | simulate scan
   |
Frontend (Simulate Scan button)
```

## Tech stack

- Node.js
- Express
- Vanilla JavaScript (frontend)
- In-memory session store
- Node `crypto` (SHA256 / HMAC)

## Run locally

### 1) Install dependencies

```bash
npm install
```

### 2) Start Client Server (port 3000)

```bash
node client-server/server.js
```

### 3) Start Sneek Server (port 4000)

```bash
CLIENT_SERVER_URL=http://localhost:3000 node sneek-server/server.js
```

### 4) Start frontend host

Use your current static host setup in this repo and open the UI in browser.  
Frontend is configured to call:

- `http://localhost:3000` (client APIs)
- `http://localhost:4000` (sneek APIs)

## Folder structure

```text
client-server/
  server.js
  src/
    client/
      client.routes.js
      client.service.js
    shared/
      crypto.js
      sessionStore.js
      securityChecks.js

sneek-server/
  server.js
  src/
    sneek/
      sneek.routes.js
      sneek.service.js
    shared/
      crypto.js
      securityChecks.js

public/
  index.html
  app.js
  styles.css
```

## Highlights / key learnings

- designing auth as a protocol, not just endpoints
- separating trust boundaries across services
- making security checks explicit and reusable
- balancing simplicity (demo) with realistic verification flow

## Limitations (intentional)

- demo system, not production-ready
- uses **base64** payload encoding (not real encryption)
- no database (in-memory state only)
- no JWT/session persistence across restarts
- minimal operational hardening (rate limits, key rotation, observability, etc.)
