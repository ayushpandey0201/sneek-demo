/**
 * Local development server.
 *
 * Imports the client backend API from client-server/ (the single source of
 * truth that also deploys to md.sneek.in via Vercel) and layers static file
 * serving for the frontend UI on top.
 *
 * Usage:  npm start   →  http://localhost:3030
 */

const path = require('path');
const app = require('./client-server/server');

const PORT = Number(process.env.PORT || 3030);
const publicDir = path.join(__dirname, 'public');

// Serve the frontend static files
app.use(require('express').static(publicDir));

// SPA fallback — any unmatched GET returns index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Client web server running at http://localhost:${PORT}`);
});
