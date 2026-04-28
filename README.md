# Client Web Server

This repository now hosts only the client-facing web server and static frontend.

The frontend calls a single backend:

- `https://md.sneek.in`

## What this repo contains

- Static UI in `public/`
- Lightweight Express server in `server.js` to serve the frontend
- Vercel rewrites for static hosting in `vercel.json`

## Run locally

```bash
npm install
npm start
```

App runs at `http://localhost:3030`.

## Frontend backend config

`public/index.html` sets:

```js
window.__CONFIG__ = {
  CLIENT_API_BASE: 'https://md.sneek.in'
};
```
