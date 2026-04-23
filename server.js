const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClientRouter } = require('./src/client/client.routes');
const { createSneekRouter } = require('./src/sneek/sneek.routes');
const { ensureSessionCleanup } = require('./src/shared/sessionStore');

const app = express();
const PORT = process.env.PORT || 3030;

function getAllowedOrigins() {
  const configured = process.env.CORS_ORIGINS;
  if (!configured) {
    return new Set(['http://localhost:3030']);
  }

  return new Set(
    configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

const allowedOrigins = getAllowedOrigins();
const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server calls (Postman/curl/no browser Origin header).
    if (!origin) {
      return callback(null, true);
    }

    return callback(null, allowedOrigins.has(origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.has(origin)) {
    return next();
  }

  return res.status(403).json({
    ok: false,
    error: 'CORS origin not allowed.',
    origin,
  });
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(createClientRouter({ port: PORT }));
app.use(createSneekRouter());

ensureSessionCleanup();

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sneek HMAC demo running at http://localhost:${PORT}`);
});
