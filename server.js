const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3030;
const SESSION_TTL_MS = 60 * 1000;
const CALLBACK_TTL_MS = 60 * 1000;
const DEMO_MOBILE_TOKEN = 'demo-mobile-token';
const DEMO_INTROSPECTION_TOKEN = 'demo-introspection-token';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const demoUsers = {
  sneak_user_99: {
    userId: 'sneak_user_99',
    name: 'Rahul',
    email: 'rahul@gmail.com',
  },
  sneak_user_42: {
    userId: 'sneak_user_42',
    name: 'Asha',
    email: 'asha@gmail.com',
  },
};

const clients = new Map([
  [
    'spotify_123',
    {
      clientId: 'spotify_123',
      displayName: 'Spotify',
      kid: 'spotify.com',
      k1: 'secretkey',
      callbackSecret: 'spotify-callback-secret',
    },
  ],
]);

const sessions = new Map();
const callbackEventsSeen = new Set();

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function nowIso() {
  return new Date().toISOString();
}

function generateSessionId() {
  return `sess_${crypto.randomBytes(6).toString('hex')}`;
}

function buildSessionToken() {
  return `web_${crypto.randomBytes(18).toString('hex')}`;
}

function generateCallbackEventId() {
  return `cb_${crypto.randomBytes(8).toString('hex')}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildPayloadCore({ clientId, sessionId, kid, expiresAt }) {
  return {
    client_id: clientId,
    session_id: sessionId,
    kid,
    expires_at: expiresAt,
  };
}

function computeClientHmac(payloadCore, k1) {
  return crypto
    .createHmac('sha256', k1)
    .update(canonicalize(payloadCore))
    .digest('hex');
}

function signCallbackPayload(payload, callbackSecret) {
  return crypto
    .createHmac('sha256', callbackSecret)
    .update(canonicalize(payload))
    .digest('hex');
}

function encryptPayload(payload) {
  const serialized = JSON.stringify(payload);
  return crypto.publicEncrypt(publicKey, Buffer.from(serialized, 'utf8')).toString('base64');
}

function decryptPayload(encryptedBlob) {
  const decrypted = crypto.privateDecrypt(privateKey, Buffer.from(encryptedBlob, 'base64'));
  return JSON.parse(decrypted.toString('utf8'));
}

function getVerificationTemplate() {
  return {
    mobileToken: 'pending',
    decrypt: 'pending',
    hmac: 'pending',
    kid: 'pending',
    sessionTtl: 'pending',
    replay: 'pending',
    callbackSignature: 'pending',
    clientSessionMatch: 'pending',
    clientPayloadMatch: 'pending',
    clientBlobMatch: 'pending',
    clientVerificationSummary: 'pending',
  };
}

function createAuditLog(step, status, details) {
  return {
    at: nowIso(),
    step,
    status,
    details,
  };
}

function appendAudit(session, step, status, details) {
  session.auditTrail.unshift(createAuditLog(step, status, details));
}

function getTimeLeftMs(session) {
  return Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
}

function isFreshTimestamp(timestamp, maxAgeMs) {
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return false;
  }

  const ageMs = Math.abs(Date.now() - parsed);
  return ageMs <= maxAgeMs;
}

function syncSessionExpiry(session) {
  if (
    session.status === 'pending' &&
    new Date(session.expiresAt).getTime() <= Date.now()
  ) {
    session.status = 'expired';
    session.verification.sessionTtl = 'failed';
    appendAudit(session, 'session_ttl', 'failed', 'Session expired before authentication completed.');
  }
}

function buildSessionResponse(session) {
  syncSessionExpiry(session);

  return {
    sessionId: session.sessionId,
    clientId: session.clientId,
    clientName: session.clientName,
    kid: session.kid,
    status: session.status,
    expiresAt: session.expiresAt,
    timeLeftMs: getTimeLeftMs(session),
    hmac: session.hmac,
    encryptedBlob: session.encryptedBlob,
    payloadDigest: session.payloadDigest,
    encryptedBlobDigest: session.encryptedBlobDigest,
    payloadCanonicalString: session.payloadCanonicalString,
    qrCodeDataUrl: session.qrCodeDataUrl,
    payloadPreview: session.payload,
    verification: session.verification,
    callbackVerified: session.callbackVerified,
    callbackSignature: session.callbackSignature,
    callbackEventId: session.callbackEventId,
    sessionToken: session.sessionToken,
    userProfile: session.userProfile,
    auditTrail: session.auditTrail,
  };
}

function verifyClientCallback({ client, session, callbackPayload, signature }) {
  if (callbackPayload.sessionId !== session.sessionId || callbackPayload.clientId !== session.clientId) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(
      session,
      'callback_target',
      'failed',
      'Callback clientId/sessionId did not match the active client backend session.',
    );
    return {
      ok: false,
      message: 'Callback target mismatch.',
    };
  }

  if (!callbackPayload.eventId) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_event', 'failed', 'Callback eventId is missing.');
    return {
      ok: false,
      message: 'Missing callback eventId.',
    };
  }

  if (!isFreshTimestamp(callbackPayload.timestamp, CALLBACK_TTL_MS)) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_freshness', 'failed', 'Callback timestamp is outside freshness window.');
    return {
      ok: false,
      message: 'Stale callback timestamp.',
    };
  }

  if (callbackEventsSeen.has(callbackPayload.eventId)) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_replay', 'failed', 'Callback eventId was already processed.');
    return {
      ok: false,
      message: 'Callback replay detected.',
    };
  }

  const expectedSignature = signCallbackPayload(callbackPayload, client.callbackSecret);
  const valid = expectedSignature === signature;

  if (!valid) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_signature', 'failed', 'Client backend rejected the callback signature.');
    return {
      ok: false,
      message: 'Invalid callback signature.',
    };
  }

  callbackEventsSeen.add(callbackPayload.eventId);
  session.callbackVerified = true;
  session.callbackSignature = signature;
  session.callbackEventId = callbackPayload.eventId;
  session.verification.callbackSignature = 'passed';
  session.userProfile = callbackPayload.userProfile;
  session.sessionToken = buildSessionToken();
  session.status = 'authenticated';

  appendAudit(session, 'callback_signature', 'passed', 'Client backend verified the signed callback from Sneak.');
  appendAudit(
    session,
    'frontend_session',
    'passed',
    `Client backend issued browser session token ${session.sessionToken.slice(0, 14)}...`,
  );

  return {
    ok: true,
    message: 'Callback verified and frontend session issued.',
    sessionToken: session.sessionToken,
    callbackEventId: callbackPayload.eventId,
  };
}

function buildIntrospectionResponse({ session, client, txId }) {
  syncSessionExpiry(session);

  return {
    ok: true,
    txId,
    status: session.status,
    clientId: session.clientId,
    kid: session.kid,
    expiresAt: session.expiresAt,
    timeLeftMs: getTimeLeftMs(session),
    verificationContext: {
      expectedClientId: client.clientId,
      expectedKid: client.kid,
      sessionId: session.sessionId,
      allowProceed: session.status === 'pending',
    },
  };
}

app.get('/api/demo/bootstrap', (req, res) => {
  const client = clients.get('spotify_123');

  res.json({
    appName: 'Sneek HMAC + K1 Demo',
    port: PORT,
    demoClient: {
      clientId: client.clientId,
      clientName: client.displayName,
      kid: client.kid,
    },
    publicKeyPreview: publicKey.split('\n').slice(0, 4).join('\n'),
    postmanTarget: `http://localhost:${PORT}/api/sneek/scan`,
    directCallbackTarget: `http://localhost:${PORT}/api/client/callback`,
    introspectionTarget: `http://localhost:${PORT}/api/client/introspect`,
    theoryNote:
      'This demo uses a real HMAC-SHA256 over client_id with K1, stores sessions in memory, and simulates the Sneek callback in-process.',
  });
});

app.post('/api/client/login', async (req, res) => {
  const requestedClientId = req.body?.clientId || 'spotify_123';
  const client = clients.get(requestedClientId);

  if (!client) {
    return res.status(404).json({ error: 'Unknown client_id.' });
  }

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const hmac = computeClientHmac(client.clientId, client.k1);
  const payloadCore = buildPayloadCore({
    clientId: client.clientId,
    sessionId,
    kid: client.kid,
    expiresAt,
  });
  const payload = {
    ...payloadCore,
    hmac,
  };
  const payloadCanonicalString = canonicalize(payload);
  const payloadDigest = sha256Hex(payloadCanonicalString);
  const encryptedBlob = encryptPayload(payload);
  const encryptedBlobDigest = sha256Hex(encryptedBlob);
  const qrCodeDataUrl = await QRCode.toDataURL(encryptedBlob, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: {
      dark: '#101828',
      light: '#ffffff',
    },
  });

  const session = {
    sessionId,
    clientId: client.clientId,
    clientName: client.displayName,
    kid: client.kid,
    expiresAt,
    status: 'pending',
    hmac,
    encryptedBlob,
    encryptedBlobDigest,
    payloadCanonicalString,
    payloadDigest,
    payloadCore,
    qrCodeDataUrl,
    verification: getVerificationTemplate(),
    callbackVerified: false,
    callbackSignature: null,
    callbackEventId: null,
    userProfile: null,
    sessionToken: null,
    used: false,
    auditTrail: [],
  };

  appendAudit(session, 'login_click', 'passed', 'User clicked "Login with Sneak" on the client website.');
  appendAudit(
    session,
    'client_backend',
    'passed',
    `Client backend generated session ${sessionId} with a 60 second TTL.`,
  );
  appendAudit(
    session,
    'hmac_generate',
    'passed',
    'Client backend derived HMAC-SHA256(client_id, K1) without exposing K1 to the frontend.',
  );
  appendAudit(
    session,
    'encrypt_payload',
    'passed',
    'Payload was encrypted with the demo Sneek public key and encoded into a QR code.',
  );

  sessions.set(sessionId, session);

  res.json({
    ok: true,
    session: buildSessionResponse(session),
    postmanExample: {
      url: `http://localhost:${PORT}/api/sneek/scan`,
      method: 'POST',
      body: {
        encryptedBlob,
        userId: 'sneak_user_99',
        mobileToken: DEMO_MOBILE_TOKEN,
        name: 'Rahul',
        email: 'rahul@gmail.com',
      },
    },
  });
});

app.get('/api/client/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  res.json({
    ok: true,
    session: buildSessionResponse(session),
  });
});

app.post('/api/client/introspect', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const expectedAuth = `Bearer ${DEMO_INTROSPECTION_TOKEN}`;
  if (authHeader !== expectedAuth) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized introspection request.',
    });
  }

  const txId = req.body?.txId || req.body?.sessionId;
  const clientId = req.body?.clientId;

  if (!txId || !clientId) {
    return res.status(400).json({
      ok: false,
      error: 'txId and clientId are required.',
    });
  }

  const session = sessions.get(txId);
  const client = clients.get(clientId);

  if (!session || !client) {
    return res.status(404).json({
      ok: false,
      error: 'Unknown introspection target.',
      txId,
      clientId,
    });
  }

  if (session.clientId !== client.clientId) {
    return res.status(409).json({
      ok: false,
      error: 'Client mismatch for transaction.',
      txId,
      sessionClientId: session.clientId,
      requestedClientId: client.clientId,
    });
  }

  appendAudit(
    session,
    'client_introspect',
    'passed',
    `Sneek introspected tx ${txId} for client ${clientId} before finalizing verification.`,
  );

  return res.json(buildIntrospectionResponse({ session, client, txId }));
});

app.post('/api/sneek/scan', (req, res) => {
  const { encryptedBlob, userId, mobileToken, name, email } = req.body || {};

  if (!encryptedBlob || !userId || !mobileToken) {
    return res.status(400).json({
      ok: false,
      error: 'encryptedBlob, userId, and mobileToken are required.',
    });
  }

  let decryptedPayload;

  try {
    decryptedPayload = decryptPayload(encryptedBlob);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: 'Sneek could not decrypt the QR payload.',
      verification: {
        decrypt: 'failed',
      },
    });
  }

  const session = sessions.get(decryptedPayload.session_id);

  if (!session) {
    return res.status(404).json({
      ok: false,
      error: 'Session not found for decrypted payload.',
      decryptedPayload,
    });
  }

  syncSessionExpiry(session);
  appendAudit(session, 'qr_scan', 'passed', `Sneek app scanned QR for session ${session.sessionId}.`);

  if (mobileToken !== DEMO_MOBILE_TOKEN) {
    session.verification.mobileToken = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'mobile_token', 'failed', 'Sneek mobile token check failed.');
    return res.status(401).json({
      ok: false,
      error: 'Invalid mobile token.',
      session: buildSessionResponse(session),
    });
  }

  session.verification.mobileToken = 'passed';
  session.verification.decrypt = 'passed';
  appendAudit(session, 'mobile_token', 'passed', 'Sneek app proved the user is authenticated on mobile.');
  appendAudit(session, 'decrypt_payload', 'passed', 'Sneek backend decrypted the QR blob using its private key.');

  const client = clients.get(decryptedPayload.client_id);

  if (!client) {
    session.verification.hmac = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'client_lookup', 'failed', 'Sneek could not find the client_id in its registry.');
    return res.status(404).json({
      ok: false,
      error: 'Unknown client_id in decrypted payload.',
      session: buildSessionResponse(session),
    });
  }

  const expectedHmac = computeClientHmac(decryptedPayload.client_id, client.k1);

  if (expectedHmac !== decryptedPayload.hmac) {
    session.verification.hmac = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'hmac_verify', 'failed', 'Sneek recomputed the HMAC and it did not match.');
    return res.status(401).json({
      ok: false,
      error: 'HMAC verification failed.',
      expectedHmac,
      receivedHmac: decryptedPayload.hmac,
      session: buildSessionResponse(session),
    });
  }

  session.verification.hmac = 'passed';
  appendAudit(session, 'hmac_verify', 'passed', 'Sneek recomputed HMAC with K1 and the value matched.');

  const clientSessionMatch =
    decryptedPayload.session_id === session.sessionId && decryptedPayload.client_id === session.clientId;
  if (!clientSessionMatch) {
    session.verification.clientSessionMatch = 'failed';
    session.verification.clientVerificationSummary = 'failed';
    session.status = 'rejected';
    appendAudit(
      session,
      'client_session_cross_verify',
      'failed',
      'Decrypted payload session_id/client_id did not match the client backend session state.',
    );
    return res.status(401).json({
      ok: false,
      error: 'Client session cross verification failed.',
      session: buildSessionResponse(session),
    });
  }

  session.verification.clientSessionMatch = 'passed';
  appendAudit(
    session,
    'client_session_cross_verify',
    'passed',
    'Decrypted payload session_id/client_id matched the client backend session state.',
  );

  const decryptedPayloadCanonicalString = canonicalize(decryptedPayload);
  const decryptedPayloadDigest = sha256Hex(decryptedPayloadCanonicalString);
  if (decryptedPayloadDigest !== session.payloadDigest) {
    session.verification.clientPayloadMatch = 'failed';
    session.verification.clientVerificationSummary = 'failed';
    session.status = 'rejected';
    appendAudit(
      session,
      'client_payload_cross_verify',
      'failed',
      'Decrypted payload digest did not match the original client backend payload digest.',
    );
    return res.status(401).json({
      ok: false,
      error: 'Client payload cross verification failed.',
      expectedPayloadDigest: session.payloadDigest,
      receivedPayloadDigest: decryptedPayloadDigest,
      session: buildSessionResponse(session),
    });
  }

  session.verification.clientPayloadMatch = 'passed';
  appendAudit(
    session,
    'client_payload_cross_verify',
    'passed',
    'Decrypted payload digest matched the original client backend payload digest.',
  );

  const scannedBlobDigest = sha256Hex(encryptedBlob);
  if (scannedBlobDigest !== session.encryptedBlobDigest) {
    session.verification.clientBlobMatch = 'failed';
    session.verification.clientVerificationSummary = 'failed';
    session.status = 'rejected';
    appendAudit(
      session,
      'client_blob_cross_verify',
      'failed',
      'Incoming encrypted blob digest did not match the original QR blob digest.',
    );
    return res.status(401).json({
      ok: false,
      error: 'Client encrypted blob cross verification failed.',
      expectedBlobDigest: session.encryptedBlobDigest,
      receivedBlobDigest: scannedBlobDigest,
      session: buildSessionResponse(session),
    });
  }

  session.verification.clientBlobMatch = 'passed';
  session.verification.clientVerificationSummary = 'passed';
  appendAudit(
    session,
    'client_blob_cross_verify',
    'passed',
    'Incoming encrypted blob digest matched the original QR blob digest.',
  );

  if (client.kid !== decryptedPayload.kid) {
    session.verification.kid = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'kid_verify', 'failed', 'KID/origin did not match the registered client URL.');
    return res.status(401).json({
      ok: false,
      error: 'KID verification failed.',
      registeredKid: client.kid,
      receivedKid: decryptedPayload.kid,
      session: buildSessionResponse(session),
    });
  }

  session.verification.kid = 'passed';
  appendAudit(session, 'kid_verify', 'passed', 'KID/origin matched the registered client URL.');

  if (session.status === 'expired') {
    session.verification.sessionTtl = 'failed';
    appendAudit(session, 'session_ttl', 'failed', 'Session expired before Sneek could finish verification.');
    return res.status(410).json({
      ok: false,
      error: 'Session has expired.',
      session: buildSessionResponse(session),
    });
  }

  session.verification.sessionTtl = 'passed';
  appendAudit(session, 'session_ttl', 'passed', 'Session was still within the 60 second TTL.');

  if (session.used) {
    session.verification.replay = 'failed';
    appendAudit(session, 'replay_check', 'failed', 'Session had already been used once.');
    return res.status(409).json({
      ok: false,
      error: 'Replay detected. This QR session was already used.',
      session: buildSessionResponse(session),
    });
  }

  session.used = true;
  session.verification.replay = 'passed';
  appendAudit(session, 'replay_check', 'passed', 'Session had not been used before.');

  const userProfile = {
    ...(demoUsers[userId] || { userId, name: name || 'Demo User', email: email || `${userId}@gmail.com` }),
    name: name || demoUsers[userId]?.name || 'Demo User',
    email: email || demoUsers[userId]?.email || `${userId}@gmail.com`,
  };

  const callbackPayload = {
    eventId: generateCallbackEventId(),
    clientId: client.clientId,
    kid: client.kid,
    sessionId: session.sessionId,
    timestamp: nowIso(),
    userProfile,
  };

  const callbackSignature = signCallbackPayload(callbackPayload, client.callbackSecret);
  appendAudit(session, 'callback_send', 'passed', 'Sneek prepared a signed callback for the client backend.');

  const callbackResult = verifyClientCallback({
    client,
    session,
    callbackPayload,
    signature: callbackSignature,
  });

  if (!callbackResult.ok) {
    return res.status(401).json({
      ok: false,
      error: callbackResult.message,
      session: buildSessionResponse(session),
    });
  }

  res.json({
    ok: true,
    message: 'Sneek accepted the QR, verified all gates, and logged the user in.',
    decryptedPayload,
    verification: session.verification,
    callback: {
      delivered: true,
      signature: callbackSignature,
      result: callbackResult,
    },
    session: buildSessionResponse(session),
  });
});

app.post('/api/client/callback', (req, res) => {
  const { eventId, clientId, sessionId, timestamp, userProfile, signature } = req.body || {};

  if (!eventId || !clientId || !sessionId || !timestamp || !userProfile || !signature) {
    return res.status(400).json({ ok: false, error: 'Missing callback fields.' });
  }

  const client = clients.get(clientId);
  const session = sessions.get(sessionId);

  if (!client || !session) {
    return res.status(404).json({ ok: false, error: 'Unknown callback target.' });
  }

  const callbackPayload = {
    eventId,
    clientId,
    kid: client.kid,
    sessionId,
    timestamp,
    userProfile,
  };

  const result = verifyClientCallback({
    client,
    session,
    callbackPayload,
    signature,
  });

  if (!result.ok) {
    return res.status(401).json(result);
  }

  res.json(result);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sneek HMAC demo running at http://localhost:${PORT}`);
});
