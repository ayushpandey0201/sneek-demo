const { computeClientHmac, signCallbackPayload } = require('./crypto');
const { sessions, syncSessionExpiry } = require('./sessionStore');

function verifyHMAC(payload, k1) {
  if (!payload?.client_id || !payload?.hmac || !k1) {
    return { ok: false, reason: 'missing_hmac_inputs' };
  }

  const expectedHmac = computeClientHmac(payload.client_id, k1);
  if (expectedHmac !== payload.hmac) {
    return {
      ok: false,
      reason: 'hmac_mismatch',
      expectedHmac,
      receivedHmac: payload.hmac,
    };
  }

  return { ok: true, expectedHmac };
}

function verifyKID(payload, expectedKid) {
  if (!payload?.kid || !expectedKid) {
    return { ok: false, reason: 'missing_kid_inputs' };
  }

  if (payload.kid !== expectedKid) {
    return {
      ok: false,
      reason: 'kid_mismatch',
      expectedKid,
      receivedKid: payload.kid,
    };
  }

  return { ok: true };
}

function verifySession(session_id) {
  if (!session_id) {
    return { ok: false, reason: 'missing_session_id' };
  }

  const session = sessions.get(session_id);
  if (!session) {
    return { ok: false, reason: 'session_not_found' };
  }

  syncSessionExpiry(session);
  if (session.status === 'expired') {
    return { ok: false, reason: 'session_expired', session };
  }

  return { ok: true, session };
}

function verifyCallbackSignature(payload, signature, callbackSecret) {
  if (!payload || !signature || !callbackSecret) {
    return { ok: false, reason: 'missing_callback_signature_inputs' };
  }

  const expectedSignature = signCallbackPayload(payload, callbackSecret);
  if (expectedSignature !== signature) {
    return {
      ok: false,
      reason: 'callback_signature_mismatch',
      expectedSignature,
      receivedSignature: signature,
    };
  }

  return { ok: true, expectedSignature };
}

module.exports = {
  verifyHMAC,
  verifyKID,
  verifySession,
  verifyCallbackSignature,
};
