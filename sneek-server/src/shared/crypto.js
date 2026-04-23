const crypto = require('crypto');

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

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function decryptPayload(encryptedBlob) {
  const decoded = Buffer.from(encryptedBlob, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

module.exports = {
  canonicalize,
  sha256Hex,
  computeClientHmac,
  signCallbackPayload,
  decryptPayload,
};
