# Client Web Server

This repository hosts the client-facing web server, static frontend, and the client backend API.

## Architecture

| Service | Location | Deployed To | Purpose |
|---|---|---|---|
| **Frontend UI** | `public/` | [sneek-demo-frontend.vercel.app](https://sneek-demo-frontend.vercel.app/) | Browser-based demo UI |
| **Client Backend** | `client-server/` | [md.sneek.in](https://md.sneek.in) | Session management, QR generation, callback verification |
| **Dev Server** | `server.js` | local only | Combined frontend + backend for local development |

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

## Deployment

### Frontend → sneek-demo-frontend.vercel.app

Deployed from the repo root, serving static files from `public/`.

### Client Backend → md.sneek.in

Deployed from `client-server/` directory as a Vercel serverless function.

## Project Structure

```
├── public/                  # Frontend UI (HTML/CSS/JS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── client-server/           # Client backend (Vercel → md.sneek.in)
│   ├── server.js
│   ├── package.json
│   └── vercel.json
├── server.js                # Combined dev server (frontend + client API)
├── vercel.json              # Frontend deployment config
└── package.json
```
