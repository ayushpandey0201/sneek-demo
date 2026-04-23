const { decryptPayload, canonicalize, sha256Hex, signCallbackPayload } = require('../shared/crypto');
const { verifyHMAC, verifyKID, verifySession } = require('../shared/securityChecks');
const {
  DEMO_MOBILE_TOKEN,
  demoUsers,
  clients,
  sessions,
  generateCallbackEventId,
  appendAudit,
  logStep,
  markSessionUsed,
  isSessionUsed,
  syncSessionExpiry,
  buildSessionResponse,
} = require('../shared/sessionStore');
const { verifyClientCallback, nowIso } = require('../client/client.service');

function processSneekScan(body) {
  const { encryptedBlob, userId, mobileToken, name, email } = body || {};
  logStep('SNEEK', 'Scan request received');
  if (!encryptedBlob || !userId || !mobileToken) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'encryptedBlob, userId, and mobileToken are required.',
      },
    };
  }

  let decryptedPayload;
  try {
    decryptedPayload = decryptPayload(encryptedBlob);
  } catch (_error) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'Sneek could not decode the QR payload.',
        verification: {
          decrypt: 'failed',
        },
      },
    };
  }

  const sessionCheck = verifySession(decryptedPayload.session_id);
  if (!sessionCheck.ok && sessionCheck.reason === 'session_not_found') {
    return {
      status: 404,
      body: {
        ok: false,
        error: 'Session not found for decrypted payload.',
        decryptedPayload,
      },
    };
  }
  const session = sessionCheck.session;
  if (!sessionCheck.ok && sessionCheck.reason === 'session_expired') {
    session.verification.sessionTtl = 'failed';
    appendAudit(session, 'session_ttl', 'failed', 'Session expired before Sneek could finish verification.');
    return {
      status: 410,
      body: {
        ok: false,
        error: 'Session has expired.',
        session: buildSessionResponse(session),
      },
    };
  }

  syncSessionExpiry(session);
  appendAudit(session, 'qr_scan', 'passed', `Sneek app scanned QR for session ${session.sessionId}.`);

  if (mobileToken !== DEMO_MOBILE_TOKEN) {
    session.verification.mobileToken = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'mobile_token', 'failed', 'Sneek mobile token check failed.');
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Invalid mobile token.',
        session: buildSessionResponse(session),
      },
    };
  }

  session.verification.mobileToken = 'passed';
  session.verification.decrypt = 'passed';
  logStep('SNEEK', 'Session valid');
  appendAudit(session, 'mobile_token', 'passed', 'Sneek app proved the user is authenticated on mobile.');
  appendAudit(session, 'decrypt_payload', 'passed', 'Sneek backend decoded the base64 QR blob.');

  const client = clients.get(decryptedPayload.client_id);
  if (!client) {
    session.verification.hmac = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'client_lookup', 'failed', 'Sneek could not find the client_id in its registry.');
    return {
      status: 404,
      body: {
        ok: false,
        error: 'Unknown client_id in decrypted payload.',
        session: buildSessionResponse(session),
      },
    };
  }

  const hmacCheck = verifyHMAC(decryptedPayload, client.k1);
  if (!hmacCheck.ok) {
    session.verification.hmac = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'hmac_verify', 'failed', 'Sneek recomputed the HMAC and it did not match.');
    return {
      status: 401,
      body: {
        ok: false,
        error: 'HMAC verification failed.',
        expectedHmac: hmacCheck.expectedHmac,
        receivedHmac: hmacCheck.receivedHmac,
        session: buildSessionResponse(session),
      },
    };
  }

  session.verification.hmac = 'passed';
  logStep('SNEEK', 'HMAC verified');
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
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Client session cross verification failed.',
        session: buildSessionResponse(session),
      },
    };
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
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Client payload cross verification failed.',
        expectedPayloadDigest: session.payloadDigest,
        receivedPayloadDigest: decryptedPayloadDigest,
        session: buildSessionResponse(session),
      },
    };
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
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Client encrypted blob cross verification failed.',
        expectedBlobDigest: session.encryptedBlobDigest,
        receivedBlobDigest: scannedBlobDigest,
        session: buildSessionResponse(session),
      },
    };
  }

  session.verification.clientBlobMatch = 'passed';
  session.verification.clientVerificationSummary = 'passed';
  appendAudit(
    session,
    'client_blob_cross_verify',
    'passed',
    'Incoming encrypted blob digest matched the original QR blob digest.',
  );

  const kidCheck = verifyKID(decryptedPayload, client.kid);
  if (!kidCheck.ok) {
    session.verification.kid = 'failed';
    session.status = 'rejected';
    appendAudit(session, 'kid_verify', 'failed', 'KID/origin did not match the registered client URL.');
    return {
      status: 401,
      body: {
        ok: false,
        error: 'KID verification failed.',
        registeredKid: kidCheck.expectedKid,
        receivedKid: kidCheck.receivedKid,
        session: buildSessionResponse(session),
      },
    };
  }

  session.verification.kid = 'passed';
  appendAudit(session, 'kid_verify', 'passed', 'KID/origin matched the registered client URL.');

  if (session.status === 'expired') {
    session.verification.sessionTtl = 'failed';
    appendAudit(session, 'session_ttl', 'failed', 'Session expired before Sneek could finish verification.');
    return {
      status: 410,
      body: {
        ok: false,
        error: 'Session has expired.',
        session: buildSessionResponse(session),
      },
    };
  }

  session.verification.sessionTtl = 'passed';
  appendAudit(session, 'session_ttl', 'passed', 'Session was still within the 60 second TTL.');

  if (isSessionUsed(session)) {
    session.verification.replay = 'failed';
    logStep('SNEEK', 'Replay protection blocked reused session');
    appendAudit(session, 'replay_check', 'failed', 'Session had already been used once.');
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Replay detected. This QR session was already used.',
        session: buildSessionResponse(session),
      },
    };
  }

  markSessionUsed(session);
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
  logStep('SNEEK', 'Callback sent');
  appendAudit(session, 'callback_send', 'passed', 'Sneek prepared a signed callback for the client backend.');

  const callbackResult = verifyClientCallback({
    client,
    session,
    callbackPayload,
    signature: callbackSignature,
  });
  if (!callbackResult.ok) {
    return {
      status: 401,
      body: {
        ok: false,
        error: callbackResult.message,
        session: buildSessionResponse(session),
      },
    };
  }

  return {
    status: 200,
    body: {
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
    },
  };
}

module.exports = { processSneekScan };
