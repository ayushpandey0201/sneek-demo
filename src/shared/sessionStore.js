const SESSION_TTL_MS = 60 * 1000;
const CALLBACK_TTL_MS = 60 * 1000;
const DEMO_MOBILE_TOKEN = 'demo-mobile-token';
const DEMO_INTROSPECTION_TOKEN = 'demo-introspection-token';

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
const DEFAULT_SESSION_CLEANUP_MS = 15 * 1000;
let cleanupTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function generateSessionId() {
  const crypto = require('crypto');
  return `sess_${crypto.randomBytes(6).toString('hex')}`;
}

function buildSessionToken() {
  const crypto = require('crypto');
  return `web_${crypto.randomBytes(18).toString('hex')}`;
}

function generateCallbackEventId() {
  const crypto = require('crypto');
  return `cb_${crypto.randomBytes(8).toString('hex')}`;
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

function logStep(actor, message) {
  console.log(`[${actor}] ${message}`);
}

function createSessionState(expiresAt) {
  return {
    expires_at: expiresAt,
    used: false,
    authenticated: false,
    user: null,
  };
}

function markSessionUsed(session) {
  session.used = true;
  if (session.sessionState) {
    session.sessionState.used = true;
  }
}

function markSessionAuthenticated(session, userProfile) {
  session.userProfile = userProfile;
  session.status = 'authenticated';
  if (session.sessionState) {
    session.sessionState.authenticated = true;
    session.sessionState.user = userProfile;
  }
}

function isSessionUsed(session) {
  return Boolean(session.used || session.sessionState?.used);
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
    if (session.sessionState) {
      session.sessionState.expires_at = session.expiresAt;
    }
    session.verification.sessionTtl = 'failed';
    appendAudit(session, 'session_ttl', 'failed', 'Session expired before authentication completed.');
  }
}

function cleanupExpiredSessions() {
  const nowMs = Date.now();
  let removedCount = 0;

  sessions.forEach((session, sessionId) => {
    const expiresAt = session.sessionState?.expires_at || session.expiresAt;
    const isExpired = new Date(expiresAt).getTime() <= nowMs;
    if (!isExpired) {
      return;
    }

    sessions.delete(sessionId);
    removedCount += 1;
  });

  if (removedCount > 0) {
    logStep('SYSTEM', `Cleaned up ${removedCount} expired session(s).`);
  }
}

function ensureSessionCleanup(intervalMs = DEFAULT_SESSION_CLEANUP_MS) {
  if (cleanupTimer) {
    return;
  }

  cleanupTimer = setInterval(cleanupExpiredSessions, intervalMs);
  cleanupTimer.unref?.();
  logStep('SYSTEM', `Automatic expiry cleanup started (${intervalMs}ms interval).`);
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
    sessionState: session.sessionState,
    auditTrail: session.auditTrail,
  };
}

module.exports = {
  SESSION_TTL_MS,
  CALLBACK_TTL_MS,
  DEMO_MOBILE_TOKEN,
  DEMO_INTROSPECTION_TOKEN,
  demoUsers,
  clients,
  sessions,
  callbackEventsSeen,
  nowIso,
  generateSessionId,
  buildSessionToken,
  generateCallbackEventId,
  getVerificationTemplate,
  appendAudit,
  logStep,
  createSessionState,
  markSessionUsed,
  markSessionAuthenticated,
  isSessionUsed,
  isFreshTimestamp,
  syncSessionExpiry,
  cleanupExpiredSessions,
  ensureSessionCleanup,
  buildSessionResponse,
  getTimeLeftMs,
};
