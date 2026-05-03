const crypto = require('crypto');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const CLIENT_ID = process.env.CLIENT_ID || 'spotify_123';
const CLIENT_KID = process.env.CLIENT_KID || 'spotify.com';
const CLIENT_NAME = process.env.CLIENT_NAME || 'Spotify';
const CLIENT_K1 = process.env.CLIENT_K1 || 'secretkey';
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || 'spotify-callback-secret';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 60_000);

const CORS_ALLOWLIST = new Set([
  'https://sneekserver.vercel.app',
  'https://sneek-demo-frontend.vercel.app',
  'https://sneek-hmac-demo.vercel.app',
  'https://mobile.sneek.in',
  'https://web.md.sneek.in',
  'https://api.sneek.in',
  'http://localhost:3030',
  'http://localhost:4000',
]);

const sessions = new Map();

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createHmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(canonicalize(payload)).digest('hex');
}

function pickAllowedOrigin(origin) {
  if (!origin || !CORS_ALLOWLIST.has(origin)) {
    return null;
  }
  return origin;
}

function setCorsHeaders(req, res) {
  const origin = pickAllowedOrigin(req.headers.origin);
  if (!origin) {
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-sneek-signature');
}

function updateSessionStatus(session) {
  if (!session) {
    return null;
  }

  const now = Date.now();
  if (session.status === 'pending' && now > session.expiresAtMs) {
    session.status = 'expired';
  }
  return session;
}

function serializeSession(session) {
  const normalized = updateSessionStatus(session);
  if (!normalized) {
    return null;
  }

  return {
    sessionId: normalized.sessionId,
    status: normalized.status,
    expiresAt: new Date(normalized.expiresAtMs).toISOString(),
    timeLeftMs: Math.max(normalized.expiresAtMs - Date.now(), 0),
    hmac: normalized.hmac,
    encryptedBlob: normalized.encryptedBlob,
    payloadPreview: normalized.payloadCore,
    qrCodeDataUrl: normalized.qrCodeDataUrl,
    verification: normalized.verification || {},
    userProfile: normalized.userProfile || null,
    sharedInfo: normalized.sharedInfo || null,
    auditTrail: normalized.auditTrail || [],
  };
}

function createQrDataUrl(payload) {
  const content = escapeXml(`SNEEK:${JSON.stringify(payload)}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#fff"/><rect x="12" y="12" width="216" height="216" fill="#111"/><rect x="28" y="28" width="184" height="184" fill="#fff"/><text x="24" y="220" font-size="8" font-family="monospace" fill="#111">${content.slice(0, 80)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

app.get('/api/demo/bootstrap', (_req, res) => {
  res.json({
    appName: 'Sneek HMAC + K1 Demo',
    port: PORT,
    demoClient: {
      clientId: CLIENT_ID,
      clientName: CLIENT_NAME,
      kid: CLIENT_KID,
    },
  });
});

app.post('/generate-qr', (req, res) => {
  const clientId = req.body?.clientId || req.body?.client_id;
  if (clientId !== CLIENT_ID) {
    return res.status(400).json({ ok: false, reason: 'invalid_client_id' });
  }

  const sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const payloadCore = {
    client_id: CLIENT_ID,
    session_id: sessionId,
    kid: CLIENT_KID,
    expires_at: expiresAt,
  };
  const hmac = createHmac(CLIENT_K1, payloadCore);
  const qrPayload = { ...payloadCore, hmac };
  const encryptedBlob = Buffer.from(JSON.stringify(qrPayload), 'utf8').toString('base64');

  const session = {
    sessionId,
    clientId: CLIENT_ID,
    status: 'pending',
    consumed: false,
    expiresAtMs,
    payloadCore,
    hmac,
    encryptedBlob,
    qrCodeDataUrl: createQrDataUrl(qrPayload),
    verification: {},
    userProfile: null,
    sharedInfo: null,
    auditTrail: [
      {
        at: new Date().toISOString(),
        step: 'session_create',
        status: 'passed',
        details: 'Session created for QR auth.',
      },
    ],
  };
  sessions.set(sessionId, session);

  return res.json({ ok: true, session: serializeSession(session) });
});

app.get('/session-status', (req, res) => {
  const sessionId = req.query?.session_id;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ ok: false, reason: 'missing_session_id' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, reason: 'not_found' });
  }

  return res.json({ ok: true, session: serializeSession(session) });
});

app.post('/verify-session', (req, res) => {
  const sessionId = req.body?.session_id;
  const clientId = req.body?.client_id;
  if (!sessionId || !clientId) {
    return res.status(400).json({ ok: false, reason: 'missing_fields' });
  }

  const session = sessions.get(sessionId);
  if (!session || session.clientId !== clientId) {
    return res.status(404).json({ ok: false, reason: 'not_found' });
  }

  updateSessionStatus(session);
  if (session.status === 'expired') {
    return res.status(410).json({ ok: false, reason: 'expired' });
  }

  if (session.consumed) {
    return res.status(409).json({ ok: false, reason: 'replay' });
  }

  session.consumed = true;
  session.auditTrail.push({
    at: new Date().toISOString(),
    step: 'verify_session',
    status: 'passed',
    details: 'Session validated and reserved for callback.',
  });
  return res.status(200).json({ ok: true, session_id: sessionId });
});

app.post('/sneek/verification-sync', (req, res) => {
  const sessionId = req.body?.session_id;
  const clientId = req.body?.client_id;
  if (!sessionId || !clientId) {
    return res.status(400).json({ ok: false, reason: 'missing_fields' });
  }

  const session = sessions.get(sessionId);
  if (!session || session.clientId !== clientId) {
    return res.status(404).json({ ok: false, reason: 'not_found' });
  }

  session.verification = req.body?.verification || {};
  session.userProfile = req.body?.userProfile || null;
  session.sharedInfo = req.body?.sharedInfo || null;
  session.auditTrail.push({
    at: new Date().toISOString(),
    step: 'verification_sync',
    status: 'passed',
    details: 'Verification details received from Sneek server.',
  });

  return res.status(200).json({ ok: true });
});

app.post('/sneek/callback', (req, res) => {
  const body = req.body || {};
  const signatureHeader = req.headers['x-sneek-signature'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const expected = createHmac(CALLBACK_SECRET, body);
  if (!signature || signature !== expected) {
    return res.status(401).json({ ok: false, reason: 'invalid_signature' });
  }

  const sessionId = body.session_id;
  const clientId = body.client_id;
  if (!sessionId || !clientId) {
    return res.status(400).json({ ok: false, reason: 'missing_fields' });
  }

  const session = sessions.get(sessionId);
  if (!session || session.clientId !== clientId) {
    return res.status(404).json({ ok: false, reason: 'not_found' });
  }

  updateSessionStatus(session);
  if (session.status === 'expired') {
    return res.status(410).json({ ok: false, reason: 'expired' });
  }

  session.status = 'authenticated';
  session.verification = body.verification || session.verification || {};
  session.userProfile = body.userProfile || session.userProfile || null;
  session.sharedInfo = body.sharedInfo || session.sharedInfo || null;
  session.auditTrail.push({
    at: new Date().toISOString(),
    step: 'callback',
    status: 'passed',
    details: 'Authenticated callback accepted from Sneek server.',
  });

  return res.status(200).json({ ok: true });
});

module.exports = app;
