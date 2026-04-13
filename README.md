# Sneek HMAC + K1 Demo

Dummy full-stack prototype that simulates the proposed Sneek QR authentication flow:

- Client backend creates a session with 60 second TTL
- Client backend computes `HMAC-SHA256(client_id, K1)`
- Payload is encrypted with a demo Sneek public key
- Frontend renders the QR code and raw debug values
- Postman can call the mock Sneek scan endpoint
- Sneek verifies HMAC, KID, TTL, replay, and signed callback
- Frontend polls until authentication succeeds or fails

## Run

```bash
npm install
npm start
```

Open [http://localhost:3030](http://localhost:3030).

## Main Files

- `server.js` - Express server plus dummy client backend and dummy Sneek backend
- `public/index.html` - Browser UI
- `public/app.js` - Polling, copy helpers, and UI rendering
- `public/styles.css` - Demo styling

## Postman Flow

1. Open the page and click `Login with Sneak`
2. Copy the generated request body from the page
3. Send it to `POST http://localhost:3030/api/sneek/scan`
4. Watch the frontend update to `Authentication Successful`

## Important Note

This demo uses a proper HMAC helper:

```js
crypto.createHmac('sha256', k1).update(client_id).digest('hex')
```

If you want to test the exact concatenation model `SHA256(K1 + client_id)` instead, only the HMAC helper in `server.js` needs to change.
