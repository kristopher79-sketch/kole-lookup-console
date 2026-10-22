const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const CUSTOMER_TRACKING_SESSION_COOKIE = 'kole_track_session';
const CUSTOMER_TRACKING_SESSION_TYPE = 'kole-track';
const CUSTOMER_TRACKING_SESSION_EXPIRES_IN = '12h';
const CUSTOMER_TRACKING_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function normalizeTrackingPasskey(value) {
  const passkey = String(value || '').trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(passkey) ? passkey : '';
}

function getTrackingPasskeyFingerprint(value) {
  const passkey = normalizeTrackingPasskey(value);
  if (!passkey) return '';

  return crypto.createHash('sha256').update(passkey).digest('hex');
}

function trackingPasskeysMatch(left, right) {
  const leftFingerprint = getTrackingPasskeyFingerprint(left);
  const rightFingerprint = getTrackingPasskeyFingerprint(right);
  if (!leftFingerprint || !rightFingerprint) return false;

  return crypto.timingSafeEqual(
    Buffer.from(leftFingerprint, 'hex'),
    Buffer.from(rightFingerprint, 'hex')
  );
}

function createCustomerTrackingSessionToken(record, secret) {
  const recordId = String(record?.id || '').trim();
  const passkeyFingerprint = getTrackingPasskeyFingerprint(record?.passkey);

  if (!recordId || !passkeyFingerprint || !secret) {
    throw new Error('Customer tracking session configuration is incomplete.');
  }

  return jwt.sign(
    {
      type: CUSTOMER_TRACKING_SESSION_TYPE,
      recordId,
      passkeyFingerprint
    },
    secret,
    { expiresIn: CUSTOMER_TRACKING_SESSION_EXPIRES_IN }
  );
}

function verifyCustomerTrackingSessionToken(token, secret) {
  const session = jwt.verify(String(token || ''), secret);
  if (session?.type !== CUSTOMER_TRACKING_SESSION_TYPE || !session?.recordId || !session?.passkeyFingerprint) {
    throw new Error('Invalid customer tracking session.');
  }

  return session;
}

function parseCookieHeader(header) {
  return String(header || '')
    .split(';')
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex < 1) return cookies;

      const name = pair.slice(0, separatorIndex).trim();
      const rawValue = pair.slice(separatorIndex + 1).trim();
      if (!name) return cookies;

      try {
        cookies[name] = decodeURIComponent(rawValue);
      } catch {
        cookies[name] = rawValue;
      }

      return cookies;
    }, {});
}

function getCustomerTrackingSessionCookie(header) {
  return parseCookieHeader(header)[CUSTOMER_TRACKING_SESSION_COOKIE] || '';
}

function serializeCustomerTrackingSessionCookie(token, options = {}) {
  const secure = options.secure !== false;
  const maxAgeSeconds = Number(
    options.maxAgeSeconds ?? CUSTOMER_TRACKING_SESSION_MAX_AGE_SECONDS
  );
  const attributes = [
    `${CUSTOMER_TRACKING_SESSION_COOKIE}=${encodeURIComponent(String(token || ''))}`,
    'Path=/api/v1/track',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];

  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function serializeCustomerTrackingSessionClearCookie(options = {}) {
  return serializeCustomerTrackingSessionCookie('', {
    secure: options.secure,
    maxAgeSeconds: 0
  });
}

function getSafeCoordinate(value, min, max) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max
    ? coordinate
    : null;
}

function buildCustomerTrackingPayload({
  record,
  position,
  hasPickupEvidence = false,
  hasDeliveryEvidence = false,
  refreshAfterSeconds = 60
}) {
  const latitude = getSafeCoordinate(position?.latitude, -90, 90);
  const longitude = getSafeCoordinate(position?.longitude, -180, 180);
  const hasCoordinates = latitude !== null && longitude !== null;
  const inActiveTrip = String(position?.tripStatus || '').trim().toUpperCase() === 'I';
  const status = hasDeliveryEvidence
    ? 'Delivered'
    : hasPickupEvidence
      ? inActiveTrip
        ? 'In Transit'
        : 'Picked Up'
      : '';

  return {
    success: true,
    shipment: {
      bolNumber: String(record?.bolNumber || ''),
      origin: String(record?.origin || ''),
      destination: String(record?.destination || ''),
      status
    },
    lastReportedLocation: {
      available: hasCoordinates,
      description: String(position?.currentCityState || record?.currentLocation || ''),
      latitude,
      longitude,
      reportedAt: String(position?.positionTimeUtc || position?.eventTimeUtc || position?.lastUpdatedUtc || ''),
      stale: position ? position.isStale === true : true
    },
    refreshAfterSeconds: Math.max(30, Math.min(Number(refreshAfterSeconds) || 60, 900))
  };
}

module.exports = {
  CUSTOMER_TRACKING_SESSION_COOKIE,
  CUSTOMER_TRACKING_SESSION_MAX_AGE_SECONDS,
  buildCustomerTrackingPayload,
  createCustomerTrackingSessionToken,
  getCustomerTrackingSessionCookie,
  getTrackingPasskeyFingerprint,
  normalizeTrackingPasskey,
  serializeCustomerTrackingSessionClearCookie,
  serializeCustomerTrackingSessionCookie,
  trackingPasskeysMatch,
  verifyCustomerTrackingSessionToken
};
