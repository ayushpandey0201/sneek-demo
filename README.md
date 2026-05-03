# Client Web Server

This repository hosts the client-facing web server, static frontend, and the client backend API.

## Architecture

| Service | Location | Deployed To | Purpose |
|---|---|---|---|
| **Frontend UI** | `public/` | [sneek-hmac-demo.vercel.app](https://sneek-hmac-demo.vercel.app/) | Browser-based demo UI |
| **Client Backend** | `client-server/` | [md.sneek.in](https://md.sneek.in) | Session management, QR generation, callback verification |

The Sneek verification server (`api.sneek.in`) lives in a **separate repository**.

## Run locally

```bash
npm install
npm start
```

App runs at `http://localhost:3030` with both frontend and backend.

## Frontend backend config

`public/index.html` sets:

```js
window.__CONFIG__ = {
  CLIENT_API_BASE: 'https://md.sneek.in'
};
```

## Project Structure

```
├── public/                  # Frontend UI (HTML/CSS/JS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── client-server/           # Client backend API (Vercel → md.sneek.in)
│   ├── server.js            # All backend routes (single source of truth)
│   ├── package.json
│   └── vercel.json
├── server.js                # Dev server (imports client-server + serves public/)
├── vercel.json              # Frontend deployment config
└── package.json
```

**Key:** The root `server.js` is just a thin wrapper — it imports the backend from
`client-server/server.js` and adds static file serving on top for local development.
There is no duplicated backend logic.
