const QRCode = require('qrcode');
const {
  canonicalize,
  sha256Hex,
  computeClientHmac,
  encryptPayload,
} = require('../shared/crypto');
const { verifyCallbackSignature } = require('../shared/securityChecks');
const {
  SESSION_TTL_MS,
  CALLBACK_TTL_MS,
  DEMO_MOBILE_TOKEN,
  DEMO_INTROSPECTION_TOKEN,
  clients,
  sessions,
  callbackEventsSeen,
  nowIso,
  generateSessionId,
  buildSessionToken,
  getVerificationTemplate,
  appendAudit,
  logStep,
  createSessionState,
  markSessionAuthenticated,
  isFreshTimestamp,
  syncSessionExpiry,
  buildSessionResponse,
  getTimeLeftMs,
} = require('../shared/sessionStore');

function buildPayloadCore({ clientId, sessionId, kid, expiresAt }) {
  return {
    client_id: clientId,
    session_id: sessionId,
    kid,
    expires_at: expiresAt,
  };
}

function getBootstrap(port) {
  const client = clients.get('spotify_123');
  const baseUrl = `http://localhost:${port}`;

  return {
    appName: 'Sneek HMAC + K1 Demo',
    port,
    demoClient: {
      clientId: client.clientId,
      clientName: client.displayName,
      kid: client.kid,
    },
    postmanTarget: `${baseUrl}/sneek/scan`,
    directCallbackTarget: `${baseUrl}/sneek/callback`,
    introspectionTarget: `${baseUrl}/verify-session`,
    clearApi: {
      generateQr: `${baseUrl}/generate-qr`,
      sessionStatus: `${baseUrl}/session-status?session_id=<session_id>`,
      verifySession: `${baseUrl}/verify-session`,
      sneekCallback: `${baseUrl}/sneek/callback`,
      sneekScan: `${baseUrl}/sneek/scan`,
    },
    legacyApi: {
      generateQr: `${baseUrl}/api/client/login`,
      sessionStatus: `${baseUrl}/api/client/session/<session_id>`,
      verifySession: `${baseUrl}/api/client/introspect`,
      sneekCallback: `${baseUrl}/api/client/callback`,
      sneekScan: `${baseUrl}/api/sneek/scan`,
    },
    theoryNote:
      'This demo uses Node crypto for SHA256/HMAC, keeps all session state in memory, base64-encodes payloads, and simulates the Sneek callback in-process.',
  };
}

async function createLoginSession(requestedClientId, port) {
  const client = clients.get(requestedClientId || 'spotify_123');
  if (!client) {
    return { status: 404, body: { error: 'Unknown client_id.' } };
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
  const payload = { ...payloadCore, hmac };
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
    payload,
    qrCodeDataUrl,
    verification: getVerificationTemplate(),
    callbackVerified: false,
    callbackSignature: null,
    callbackEventId: null,
    userProfile: null,
    sessionToken: null,
    used: false,
    sessionState: createSessionState(expiresAt),
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
    'Payload was base64-encoded and encoded into a QR code.',
  );

  sessions.set(sessionId, session);
  logStep('CLIENT', `Generated session ${sessionId}`);

  return {
    status: 200,
    body: {
      ok: true,
      session: buildSessionResponse(session),
      postmanExample: {
        url: `http://localhost:${port}/sneek/scan`,
        method: 'POST',
        body: {
          encryptedBlob,
          userId: 'sneak_user_99',
          mobileToken: DEMO_MOBILE_TOKEN,
          name: 'Rahul',
          email: 'rahul@gmail.com',
        },
      },
    },
  };
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { status: 404, body: { error: 'Session not found.' } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      session: buildSessionResponse(session),
    },
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

function introspectSession(authHeader, body) {
  const expectedAuth = `Bearer ${DEMO_INTROSPECTION_TOKEN}`;
  if (authHeader !== expectedAuth) {
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Unauthorized introspection request.',
      },
    };
  }

  const txId = body?.txId || body?.sessionId;
  const clientId = body?.clientId;
  if (!txId || !clientId) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'txId and clientId are required.',
      },
    };
  }

  const session = sessions.get(txId);
  const client = clients.get(clientId);
  if (!session || !client) {
    return {
      status: 404,
      body: {
        ok: false,
        error: 'Unknown introspection target.',
        txId,
        clientId,
      },
    };
  }

  if (session.clientId !== client.clientId) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Client mismatch for transaction.',
        txId,
        sessionClientId: session.clientId,
        requestedClientId: client.clientId,
      },
    };
  }

  appendAudit(
    session,
    'client_introspect',
    'passed',
    `Sneek introspected tx ${txId} for client ${clientId} before finalizing verification.`,
  );
  return { status: 200, body: buildIntrospectionResponse({ session, client, txId }) };
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
    return { ok: false, message: 'Callback target mismatch.' };
  }

  if (!callbackPayload.eventId) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_event', 'failed', 'Callback eventId is missing.');
    return { ok: false, message: 'Missing callback eventId.' };
  }

  if (!isFreshTimestamp(callbackPayload.timestamp, CALLBACK_TTL_MS)) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_freshness', 'failed', 'Callback timestamp is outside freshness window.');
    return { ok: false, message: 'Stale callback timestamp.' };
  }

  if (callbackEventsSeen.has(callbackPayload.eventId)) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_replay', 'failed', 'Callback eventId was already processed.');
    return { ok: false, message: 'Callback replay detected.' };
  }

  const callbackSignatureCheck = verifyCallbackSignature(callbackPayload, signature, client.callbackSecret);
  if (!callbackSignatureCheck.ok) {
    session.verification.callbackSignature = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'callback_signature', 'failed', 'Client backend rejected the callback signature.');
    return { ok: false, message: 'Invalid callback signature.' };
  }

  callbackEventsSeen.add(callbackPayload.eventId);
  session.callbackVerified = true;
  session.callbackSignature = signature;
  session.callbackEventId = callbackPayload.eventId;
  session.verification.callbackSignature = 'passed';
  session.sessionToken = buildSessionToken();
  markSessionAuthenticated(session, callbackPayload.userProfile);

  appendAudit(session, 'callback_signature', 'passed', 'Client backend verified the signed callback from Sneak.');
  appendAudit(
    session,
    'frontend_session',
    'passed',
    `Client backend issued browser session token ${session.sessionToken.slice(0, 14)}...`,
  );
  logStep('CLIENT', 'User authenticated');

  return {
    ok: true,
    message: 'Callback verified and frontend session issued.',
    sessionToken: session.sessionToken,
    callbackEventId: callbackPayload.eventId,
  };
}

function handleClientCallback(body) {
  const { eventId, clientId, sessionId, timestamp, userProfile, signature } = body || {};
  if (!eventId || !clientId || !sessionId || !timestamp || !userProfile || !signature) {
    return { status: 400, body: { ok: false, error: 'Missing callback fields.' } };
  }

  const client = clients.get(clientId);
  const session = sessions.get(sessionId);
  if (!client || !session) {
    return { status: 404, body: { ok: false, error: 'Unknown callback target.' } };
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
    return { status: 401, body: result };
  }

  return { status: 200, body: result };
}

function syncSneekVerification(body) {
  const { sessionId, verification, used } = body || {};
  if (!sessionId || !verification || typeof verification !== 'object') {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'sessionId and verification object are required.',
      },
    };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return {
      status: 404,
      body: {
        ok: false,
        error: 'Session not found for verification sync.',
      },
    };
  }

  session.verification = {
    ...session.verification,
    ...verification,
  };

  if (typeof used === 'boolean') {
    session.used = used;
    if (session.sessionState) {
      session.sessionState.used = used;
    }
  }

  appendAudit(
    session,
    'sneek_verification_sync',
    'passed',
    'Sneek verification gate states were synced to client session state.',
  );

  return {
    status: 200,
    body: {
      ok: true,
      session: buildSessionResponse(session),
    },
  };
}

module.exports = {
  getBootstrap,
  createLoginSession,
  getSession,
  introspectSession,
  verifyClientCallback,
  handleClientCallback,
  syncSneekVerification,
  nowIso,
  sessions,
  clients,
};
