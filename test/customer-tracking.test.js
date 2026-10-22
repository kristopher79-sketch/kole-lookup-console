const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCustomerTrackingPayload,
  createCustomerTrackingSessionToken,
  getCustomerTrackingSessionCookie,
  getTrackingPasskeyFingerprint,
  normalizeTrackingPasskey,
  serializeCustomerTrackingSessionClearCookie,
  serializeCustomerTrackingSessionCookie,
  trackingPasskeysMatch,
  verifyCustomerTrackingSessionToken
} = require('../customer-tracking');

const TEST_SECRET = 'customer-tracking-test-secret-that-is-long-enough';
const TEST_PASSKEY = '19f93ad36fa24865ba34bb678f670217';

test('normalizes only bounded URL-safe passkeys', () => {
  assert.equal(normalizeTrackingPasskey(` ${TEST_PASSKEY} `), TEST_PASSKEY);
  assert.equal(normalizeTrackingPasskey('short'), '');
  assert.equal(normalizeTrackingPasskey('not allowed because spaces'), '');
});

test('compares passkeys without exposing their original values', () => {
  assert.equal(trackingPasskeysMatch(TEST_PASSKEY, TEST_PASSKEY), true);
  assert.equal(trackingPasskeysMatch(TEST_PASSKEY, '29f93ad36fa24865ba34bb678f670217'), false);
  assert.equal(getTrackingPasskeyFingerprint(TEST_PASSKEY).length, 64);
});

test('creates a revocable session bound to record and passkey fingerprint', () => {
  const token = createCustomerTrackingSessionToken({ id: '42', passkey: TEST_PASSKEY }, TEST_SECRET);
  const session = verifyCustomerTrackingSessionToken(token, TEST_SECRET);

  assert.equal(session.type, 'kole-track');
  assert.equal(session.recordId, '42');
  assert.equal(session.passkeyFingerprint, getTrackingPasskeyFingerprint(TEST_PASSKEY));
});

test('serializes and reads the HttpOnly tracking cookie', () => {
  const cookie = serializeCustomerTrackingSessionCookie('signed.session', { secure: true, maxAgeSeconds: 3600 });

  assert.match(cookie, /^kole_track_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(getCustomerTrackingSessionCookie('theme=dark; kole_track_session=signed.session'), 'signed.session');
  assert.match(serializeCustomerTrackingSessionClearCookie({ secure: false }), /Max-Age=0/);
});

test('builds a customer-safe in-transit payload', () => {
  const payload = buildCustomerTrackingPayload({
    record: {
      bolNumber: 'C196314',
      origin: 'Laredo, TX',
      destination: 'Tulsa, OK',
      currentLocation: 'Dallas, TX',
      truckNumber: '9999',
      company: 'Hidden Customer'
    },
    position: {
      latitude: 32.7767,
      longitude: -96.797,
      currentCityState: 'Dallas, TX',
      positionTimeUtc: '2026-10-22T14:15:00Z',
      tripStatus: 'I',
      isStale: false,
      driverName: 'Hidden Driver'
    },
    hasPickupEvidence: true
  });

  assert.equal(payload.shipment.status, 'In Transit');
  assert.equal(payload.lastReportedLocation.available, true);
  assert.equal(payload.lastReportedLocation.description, 'Dallas, TX');
  assert.equal('truckNumber' in payload.shipment, false);
  assert.equal(JSON.stringify(payload).includes('Hidden Customer'), false);
  assert.equal(JSON.stringify(payload).includes('Hidden Driver'), false);
});

test('does not invent a milestone or expose invalid coordinates', () => {
  const payload = buildCustomerTrackingPayload({
    record: { bolNumber: 'C196315' },
    position: { latitude: 200, longitude: -96, isStale: true }
  });

  assert.equal(payload.shipment.status, '');
  assert.equal(payload.lastReportedLocation.available, false);
  assert.equal(payload.lastReportedLocation.latitude, null);
});

test('shows picked up until telemetry confirms an active trip', () => {
  const payload = buildCustomerTrackingPayload({
    record: { bolNumber: 'C196315' },
    position: { tripStatus: 'O' },
    hasPickupEvidence: true
  });

  assert.equal(payload.shipment.status, 'Picked Up');
});

test('delivery evidence takes precedence over pickup evidence', () => {
  const payload = buildCustomerTrackingPayload({
    record: { bolNumber: 'C196316' },
    hasPickupEvidence: true,
    hasDeliveryEvidence: true
  });

  assert.equal(payload.shipment.status, 'Delivered');
});
