const { decryptPayload, canonicalize, sha256Hex, signCallbackPayload } = require('../shared/crypto');
const { verifyHMAC, verifyKID } = require('../shared/securityChecks');

const DEMO_MOBILE_TOKEN = 'demo-mobile-token';
const DEMO_INTROSPECTION_TOKEN = 'demo-introspection-token';
const CLIENT_SERVER_URL = process.env.CLIENT_SERVER_URL || 'http://localhost:3000';

const demoUsers = {
  sneak_user_99: { userId: 'sneak_user_99', name: 'Rahul', email: 'rahul@gmail.com' },
  sneak_user_42: { userId: 'sneak_user_42', name: 'Asha', email: 'asha@gmail.com' },
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

function logStep(actor, message) {
  console.log(`[${actor}] ${message}`);
}

function nowIso() {
  return new Date().toISOString();
}

function generateCallbackEventId() {
  const crypto = require('crypto');
  return `cb_${crypto.randomBytes(8).toString('hex')}`;
}

function createAuditLog(step, status, details) {
  return { at: nowIso(), step, status, details };
}

function appendAudit(session, step, status, details) {
  session.auditTrail.unshift(createAuditLog(step, status, details));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }
  return { ok: response.ok, status: response.status, body };
}

async function fetchClientSessionState(sessionId) {
  return fetchJson(`${CLIENT_SERVER_URL}/session-status?session_id=${encodeURIComponent(sessionId)}`);
}

async function verifySessionWithClient(sessionId, clientId) {
  return fetchJson(`${CLIENT_SERVER_URL}/verify-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEMO_INTROSPECTION_TOKEN}`,
    },
    body: JSON.stringify({ txId: sessionId, clientId }),
  });
}

async function deliverCallbackToClient(callbackPayload, signature) {
  return fetchJson(`${CLIENT_SERVER_URL}/sneek/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...callbackPayload,
      signature,
    }),
  });
}

async function syncVerificationToClient(sessionId, verification, used) {
  return fetchJson(`${CLIENT_SERVER_URL}/sneek/verification-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      verification,
      used,
    }),
  });
}

async function syncSessionSnapshot(session) {
  if (!session?.sessionId || !session?.verification) {
    return { ok: false, status: 400, body: { error: 'Missing session snapshot.' } };
  }

  return syncVerificationToClient(session.sessionId, session.verification, session.used);
}

async function failWithSyncedSession(session, status, body) {
  const syncResult = await syncSessionSnapshot(session);
  if (!syncResult.ok) {
    return {
      status,
      body: {
        ...body,
        syncWarning: syncResult.body?.error || 'Failed to sync verification state to client.',
      },
    };
  }

  return { status, body };
}

async function processSneekScan(body) {
  const { encryptedBlob, userId, mobileToken, name, email } = body || {};
  logStep('SNEEK', 'Scan request received');
  if (!encryptedBlob || !userId || !mobileToken) {
    return { status: 400, body: { ok: false, error: 'encryptedBlob, userId, and mobileToken are required.' } };
  }

  let decryptedPayload;
  try {
    decryptedPayload = decryptPayload(encryptedBlob);
  } catch (_error) {
    return { status: 400, body: { ok: false, error: 'Sneek could not decode the QR payload.', verification: { decrypt: 'failed' } } };
  }

  const introspection = await verifySessionWithClient(decryptedPayload.session_id, decryptedPayload.client_id);
  if (!introspection.ok) {
    if (introspection.status === 404) {
      return { status: 404, body: { ok: false, error: 'Session not found for decrypted payload.', decryptedPayload } };
    }
    if (introspection.status === 409) {
      return { status: 401, body: { ok: false, error: 'Client session cross verification failed.' } };
    }
    if (introspection.status === 401) {
      return { status: 401, body: { ok: false, error: 'Unauthorized introspection request.' } };
    }
    return { status: 404, body: { ok: false, error: 'Session not found for decrypted payload.', decryptedPayload } };
  }

  if (introspection.body?.status === 'expired') {
    return {
      status: 410,
      body: {
        ok: false,
        error: 'Session has expired.',
      },
    };
  }

  if (introspection.body?.status === 'authenticated') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Replay detected. This QR session was already used.',
      },
    };
  }

  if (introspection.body?.status === 'rejected') {
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Session is already rejected.',
      },
    };
  }

  if (introspection.body?.verificationContext?.allowProceed === false) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Session is not in a scannable state.',
      },
    };
  }

  const sessionLookup = await fetchClientSessionState(decryptedPayload.session_id);
  if (!sessionLookup.ok || !sessionLookup.body?.session) {
    return { status: 404, body: { ok: false, error: 'Session not found for decrypted payload.', decryptedPayload } };
  }
  const session = sessionLookup.body.session;
  appendAudit(session, 'qr_scan', 'passed', `Sneek app scanned QR for session ${session.sessionId}.`);

  if (mobileToken !== DEMO_MOBILE_TOKEN) {
    session.verification.mobileToken = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'mobile_token', 'failed', 'Sneek mobile token check failed.');
    return failWithSyncedSession(session, 401, { ok: false, error: 'Invalid mobile token.', session });
  }

  session.verification.mobileToken = 'passed';
  session.verification.decrypt = 'passed';
  logStep('SNEEK', 'Session valid');
  appendAudit(session, 'mobile_token', 'passed', 'Sneek mobile auth passed.');
  appendAudit(session, 'decrypt_payload', 'passed', 'Sneek backend decoded the base64 QR blob.');

  const client = clients.get(decryptedPayload.client_id);
  if (!client) {
    session.verification.hmac = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'client_lookup', 'failed', 'Unknown client_id.');
    return { status: 404, body: { ok: false, error: 'Unknown client_id in decrypted payload.', session } };
  }

  const hmacCheck = verifyHMAC(decryptedPayload, client.k1);
  if (!hmacCheck.ok) {
    session.verification.hmac = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'hmac_verify', 'failed', 'HMAC mismatch.');
    return failWithSyncedSession(session, 401, {
      ok: false,
      error: 'HMAC verification failed.',
      expectedHmac: hmacCheck.expectedHmac,
      receivedHmac: hmacCheck.receivedHmac,
      session,
    });
  }

  session.verification.hmac = 'passed';
  logStep('SNEEK', 'HMAC verified');
  appendAudit(session, 'hmac_verify', 'passed', 'HMAC matched.');

  const kidCheck = verifyKID(decryptedPayload, client.kid);
  if (!kidCheck.ok) {
    session.verification.kid = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'kid_verify', 'failed', 'KID/origin mismatch.');
    return failWithSyncedSession(session, 401, {
      ok: false,
      error: 'KID verification failed.',
      registeredKid: kidCheck.expectedKid,
      receivedKid: kidCheck.receivedKid,
      session,
    });
  }

  session.verification.kid = 'passed';
  appendAudit(session, 'kid_verify', 'passed', 'KID/origin matched.');

  const clientSessionMatch =
    decryptedPayload.session_id === session.sessionId && decryptedPayload.client_id === session.clientId;
  if (!clientSessionMatch) {
    session.verification.clientSessionMatch = 'failed';
    session.verification.clientVerificationSummary = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'client_session_cross_verify', 'failed', 'Session/client mismatch.');
    return failWithSyncedSession(session, 401, {
      ok: false,
      error: 'Client session cross verification failed.',
      session,
    });
  }

  session.verification.clientSessionMatch = 'passed';
  appendAudit(session, 'client_session_cross_verify', 'passed', 'Session/client matched.');

  const decryptedPayloadCanonicalString = canonicalize(decryptedPayload);
  const decryptedPayloadDigest = sha256Hex(decryptedPayloadCanonicalString);
  if (decryptedPayloadDigest !== session.payloadDigest) {
    session.verification.clientPayloadMatch = 'failed';
    session.verification.clientVerificationSummary = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'client_payload_cross_verify', 'failed', 'Payload digest mismatch.');
    return failWithSyncedSession(session, 401, {
      ok: false,
      error: 'Client payload cross verification failed.',
      session,
    });
  }

  session.verification.clientPayloadMatch = 'passed';
  appendAudit(session, 'client_payload_cross_verify', 'passed', 'Payload digest matched.');

  const scannedBlobDigest = sha256Hex(encryptedBlob);
  if (scannedBlobDigest !== session.encryptedBlobDigest) {
    session.verification.clientBlobMatch = 'failed';
    session.verification.clientVerificationSummary = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'client_blob_cross_verify', 'failed', 'Blob digest mismatch.');
    return failWithSyncedSession(session, 401, {
      ok: false,
      error: 'Client encrypted blob cross verification failed.',
      session,
    });
  }

  session.verification.clientBlobMatch = 'passed';
  session.verification.clientVerificationSummary = 'passed';
  appendAudit(session, 'client_blob_cross_verify', 'passed', 'Blob digest matched.');

  if (session.status === 'expired') {
    session.verification.sessionTtl = 'failed';
    appendAudit(session, 'session_ttl', 'failed', 'Session expired.');
    return failWithSyncedSession(session, 410, { ok: false, error: 'Session has expired.', session });
  }

  session.verification.sessionTtl = 'passed';
  appendAudit(session, 'session_ttl', 'passed', 'Session within TTL.');

  if (session.used) {
    session.verification.replay = 'failed';
    logStep('SNEEK', 'Replay protection blocked reused session');
    appendAudit(session, 'replay_check', 'failed', 'Session already used.');
    return failWithSyncedSession(session, 409, {
      ok: false,
      error: 'Replay detected. This QR session was already used.',
      session,
    });
  }

  session.used = true;
  session.verification.replay = 'passed';
  appendAudit(session, 'replay_check', 'passed', 'Session first use.');

  const verificationSync = await syncVerificationToClient(
    session.sessionId,
    session.verification,
    session.used,
  );
  if (!verificationSync.ok) {
    return {
      status: verificationSync.status || 502,
      body: {
        ok: false,
        error: verificationSync.body?.error || 'Failed to sync verification state with client.',
      },
    };
  }

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
  logStep('SNEEK', 'Callback sent');
  appendAudit(session, 'callback_send', 'passed', 'Sneek prepared a signed callback for the client backend.');

  const callbackResult = await deliverCallbackToClient(callbackPayload, callbackSignature);
  if (!callbackResult.ok) {
    return failWithSyncedSession(session, callbackResult.status || 401, {
      ok: false,
      error: callbackResult.body?.message || callbackResult.body?.error || 'Callback verification failed.',
      session,
    });
  }

  const updatedSessionLookup = await fetchClientSessionState(decryptedPayload.session_id);
  const updatedSession = updatedSessionLookup.body?.session || session;

  return {
    status: 200,
    body: {
      ok: true,
      message: 'Sneek accepted the QR, verified all gates, and logged the user in.',
      decryptedPayload,
      verification: session.verification,
      callback: { delivered: true, signature: callbackSignature, result: callbackResult.body },
      session: updatedSession,
    },
  };
}

module.exports = { processSneekScan };
