const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  businessDate, easternClock, hashPortalPassword, verifyPortalPassword, createPortalSession, verifyPortalSession,
  sessionMatchesAccount, serializePortalCookie, buildPortalShipments, buildPortalCapacity, createCustomerPortalRoutes
} = require('../customer-portal');
const { createCustomerTrackingSessionToken } = require('../customer-tracking');

const SECRET = 'test-only-customer-portal-secret-never-used-in-production';
const PASSWORD = 'test-only-long-company-password';
const account = { id: '1', name: 'Example A', customerCode: 'ACCT-A', passwordHash: '' };
const row = (id, code = 'ACCT-A', extra = {}) => ({ id, fields: { CustomerCode: code, Status: 'Won',
  BOLNumber_x0028_Won_x0029_: `DEMO-${id}`, Shipment_x0020_Origin: 'Charlotte, NC', Shipment_x0020_Destination: 'Miami, FL',
  Pickup_x0020_Offer_x0020_Date: '2026-11-24T00:00:00Z', Expected_x0020_Delivery_x0020_Da: '2026-11-25T00:00:00Z', ...extra } });

test('preserves business dates and applies Eastern publication hours across DST', () => {
  assert.equal(businessDate('2026-11-24T00:00:00Z'), '2026-11-24');
  assert.equal(businessDate('11/24/26'), '2026-11-24');
  assert.equal(businessDate('2/30/26'), '');
  assert.equal(businessDate('2100-01-01'), '');
  assert.deepEqual(easternClock(new Date('2026-11-23T10:59:00Z')), { today: '2026-11-23', hour: 5 });
  assert.equal(easternClock(new Date('2026-07-01T10:00:00Z')).hour, 6);
});

test('stores a salted password verifier and rejects plaintext and malformed hashes', async () => {
  const hash = await hashPortalPassword(PASSWORD);
  account.passwordHash = hash;
  assert.match(hash, /^scrypt\$131072\$8\$1\$/);
  assert.equal(hash.includes(PASSWORD), false);
  assert.equal(await verifyPortalPassword(PASSWORD, hash), true);
  assert.equal(await verifyPortalPassword('wrong', hash), false);
  assert.equal(await verifyPortalPassword(PASSWORD, PASSWORD), false);
  assert.equal(await verifyPortalPassword(PASSWORD, 'scrypt$999999999$8$1$bad$bad'), false);
});

test('company sessions are separate from shipment links and revoke on password or customer changes', () => {
  const token = createPortalSession({ ...account, passwordHash: 'stored-verifier' }, SECRET);
  const session = verifyPortalSession(token, SECRET);
  assert.equal(sessionMatchesAccount(session, { ...account, passwordHash: 'stored-verifier' }), true);
  assert.equal(sessionMatchesAccount(session, { ...account, passwordHash: 'rotated' }), false);
  assert.equal(sessionMatchesAccount(session, { ...account, passwordHash: 'stored-verifier', customerCode: 'ACCT-B' }), false);
  assert.equal(sessionMatchesAccount(session, { ...account, passwordHash: '' }), false);
  const shipmentToken = createCustomerTrackingSessionToken({ id: '1', passkey: 'a'.repeat(32) }, SECRET);
  assert.throws(() => verifyPortalSession(shipmentToken, SECRET));
  const cookie = serializePortalCookie(token, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/v1\/portal/);
  assert.match(cookie, /Secure/);
});

test('dashboard includes only the exact customer’s open bookings and strips internal details', () => {
  const items = [row('11'), row('12', 'ACCT-A', { Pickup_x0020_Offer_x0020_Date: '2027-01-02', Driver: 'PRIVATE', QuotedTotal: 9999 }),
    row('13', 'ACCT-B'), row('14', 'ACCT-A', { Processed: true }), row('15', 'ACCT-A', { FinalSettleSent: true }),
    row('16', 'ACCT-A', { Status: 'CAN' }), row('17'), row('18', ''), row('19', 'ACCT-A', { Status: 'TONU' })];
  const shipments = buildPortalShipments({ items, account, evidence: { deliveryEvidenceBols: new Set(['DEMO-17']) },
    trackingRecords: [{ id: '201', bidListingId: '11', bolNumber: 'DEMO-11', passkey: 'private-passkey', disableTracking: false }] });
  assert.deepEqual(shipments.map(item => item.id), ['11', '12']);
  assert.equal(shipments[0].trackingAvailable, true);
  assert.equal(shipments[1].trackingAvailable, false);
  const serialized = JSON.stringify(shipments);
  for (const hidden of ['PRIVATE', '9999', 'private-passkey', 'CustomerCode', 'TruckNumber', 'SharePoint']) assert.equal(serialized.includes(hidden), false);
  assert.equal(shipments[1].canRequestTracking, true);
  assert.equal(items[1].fields.EnableTracking, undefined);
});

test('tracking records cannot be joined using only a reused shipment number', () => {
  const shipments = buildPortalShipments({ account, items: [row('11')], trackingRecords: [
    { bidListingId: '99', bolNumber: 'DEMO-11', passkey: 'private' },
    { bidListingId: '11', bolNumber: 'ANOTHER-LOAD', passkey: 'private' }
  ] });
  assert.equal(shipments[0].trackingAvailable, false);
});

const now = new Date('2026-11-23T17:00:00Z');
const capacityRow = (id, truck, extras = {}) => ({ id, createdDateTime: '2026-11-23T12:00:00Z', fields: {
  ProjectedEmpty: '11/24/26', Equipment: truck, Location: 'Charlotte, NC', RunDateandTime: '11/23/26 Morning', ...extras
} });
const rosterRow = (id, truck, extras = {}) => ({ id, fields: {
  Trucks: truck, Operator_x002f_TeamName: `Private driver ${id}`, Status: 'Active', SoloorTeam: 'Solo', TrailerType: 'Conestoga', ...extras
} });

test('public capacity deduplicates units, uses real equipment type, and drops teams and old runs', () => {
  const capacity = buildPortalCapacity({ now, projected: [capacityRow('1', '0001'), capacityRow('2', '0002'),
    capacityRow('3', '0003'), { ...capacityRow('4', '0004', { RunDateandTime: '11/22/26 Evening' }), createdDateTime: '2026-11-22T23:00:00Z' }],
    roster: [rosterRow('1', '0001'), rosterRow('2', '0002'), rosterRow('3', '0003', { SoloorTeam: 'Team' }), rosterRow('4', '0004')] });
  assert.deepEqual(capacity.opportunities, [{ date: '2026-11-24', location: 'Charlotte, NC', equipment: 'Conestoga', kind: 'Projected' }]);
  const serialized = JSON.stringify(capacity);
  for (const hidden of ['0001', '0002', 'Private driver', 'truck', 'count', 'Operator']) assert.equal(serialized.includes(hidden), false);
});

test('capacity excludes bookings through day seven and time off through the additional two-day buffer', () => {
  const base = { now, projected: [capacityRow('1', '0001')], roster: [rosterRow('1', '0001')] };
  const booking = row('40', 'ANY', { Truck_x0020_Number: '1', Pickup_x0020_Offer_x0020_Date: '2026-12-01', Expected_x0020_Delivery_x0020_Da: '2026-12-02' });
  assert.equal(buildPortalCapacity({ ...base, orders: [booking] }).opportunities.length, 0);
  booking.fields.Pickup_x0020_Offer_x0020_Date = '2026-12-02';
  assert.equal(buildPortalCapacity({ ...base, orders: [booking] }).opportunities.length, 1);
  const off = { fields: { TruckNumber: '0001', Status: 'Active', StartDate: '2026-12-03', EndDate: '2026-12-05' } };
  assert.equal(buildPortalCapacity({ ...base, timeOff: [off] }).opportunities.length, 0);
  off.fields.StartDate = '2026-12-04';
  assert.equal(buildPortalCapacity({ ...base, timeOff: [off] }).opportunities.length, 1);
});

test('capacity fails closed for stale publications, missing eligibility data, and closed hours', () => {
  const stale = { ...capacityRow('1', '0001'), createdDateTime: '2026-11-20T12:00:00Z' };
  assert.equal(buildPortalCapacity({ now, projected: [stale], roster: [rosterRow('1', '0001')] }).opportunities.length, 0);
  assert.equal(buildPortalCapacity({ now, projected: [capacityRow('1', '0001')], roster: [] }).opportunities.length, 0);
  const closed = buildPortalCapacity({ now: new Date('2026-11-23T23:00:00Z') });
  assert.equal(closed.open, false);
  assert.deepEqual(closed.opportunities, []);
});

test('HTTP routes enforce tenant isolation, cookie scope, logout, and office-only provisioning', async t => {
  const app = express();
  app.use(express.json());
  const passwordHash = await hashPortalPassword(PASSWORD);
  const accounts = [{ id: '1', eTag: '"1"', fields: { CompanyName: 'Example A', CustomerCode: 'ACCT-A', PortalPassword: passwordHash } }];
  const items = [row('11'), { ...row('12'), eTag: '"1"' }, row('21', 'ACCT-B')];
  const tracking = [{ id: '111', bidListingId: '11', bolNumber: 'DEMO-11', passkey: 'private-key' }];
  let writes = 0;
  createCustomerPortalRoutes(app, {
    getGraphToken: async () => 'fake-graph-token', getSessionSecret: () => SECRET, getSiteId: () => 'test-site',
    getSalesLeadsListId: () => 'accounts', getCurrentBidListingSource: async () => ({ listId: 'orders' }),
    getAllListItemsWithFields: async (_token, list) => structuredClone(list === 'accounts' ? accounts : items),
    graphGet: async (_token, url) => structuredClone(url.includes('/lists/orders/') ? items.find(item => url.includes(`/items/${item.id}?`)) : accounts[0]),
    graphPatch: async (_token, _url, fields, extraHeaders) => {
      assert.equal(extraHeaders['If-Match'], accounts[0].eTag);
      assert.deepEqual(Object.keys(fields), ['PortalPassword']);
      accounts[0].fields.PortalPassword = fields.PortalPassword;
      writes++;
    },
    setIntelliTrackEnabled: async (_token, list, id, enabled, etag) => {
      assert.equal(list, 'orders');
      const order = items.find(item => item.id === id);
      assert.equal(etag, order.eTag);
      order.fields.EnableTracking = enabled;
      order.eTag = '"2"';
      writes++;
    },
    getListColumns: async () => [{ name: 'PortalPassword', text: { maxLength: 255 } }],
    getUploadEvidenceSets: async () => ({ deliveryEvidenceBols: new Set() }), getCustomerTrackingRecords: async () => tracking,
    buildCustomerTrackingSnapshot: async () => ({ success: true, shipment: { bolNumber: 'DEMO-11' } }),
    requireLookupAccess: (req, res, next) => req.headers['x-lookup-token'] === 'office-test' ? next() : res.status(401).json({ success: false }),
    getAvailableTrucksListId: () => 'available', getRosterListId: () => 'roster', getTimeOffListId: () => 'time-off'
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(base + path, options);
  assert.equal((await request('/api/v1/portal/shipments')).status, 401);
  assert.equal((await request('/sales-leads/1/portal-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal(writes, 0);
  const login = await request('/api/v1/portal/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://kole-tracking-portal.netlify.app' }, body: JSON.stringify({ customerCode: 'ACCT-A', password: PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await login.json(), { success: true, company: { name: 'Example A' } });
  const headers = { Cookie: cookie };
  const dashboard = await (await request('/api/v1/portal/shipments', { headers })).json();
  assert.deepEqual(dashboard.shipments.map(item => item.id), ['11', '12']);
  assert.equal((await request('/api/v1/portal/shipments/21/tracking', { headers })).status, 404);
  assert.equal((await request('/api/v1/portal/shipments/11/tracking', { headers })).status, 200);
  assert.equal((await request('/api/v1/portal/shipments/11/tracking', { headers: { Cookie: `kole_track_session=${cookie.split('=')[1]}` } })).status, 401);
  const requestHeaders = { ...headers, 'Content-Type': 'application/json', Origin: 'https://kole-tracking-portal.netlify.app' };
  assert.equal((await request('/api/v1/portal/shipments/21/tracking-request', { method: 'POST', headers: requestHeaders, body: '{}' })).status, 404);
  assert.equal(writes, 0);
  assert.equal((await request('/api/v1/portal/shipments/12/tracking-request', { method: 'POST', headers: { ...requestHeaders, Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
  assert.equal(writes, 0);
  const requested = await request('/api/v1/portal/shipments/12/tracking-request', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ enabled: false, TrackingActive: true, CustomerCode: 'ACCT-B' }) });
  assert.equal(requested.status, 200);
  assert.equal((await requested.json()).trackingRequested, true);
  assert.equal(items[1].fields.EnableTracking, true);
  assert.equal(items[1].fields.TrackingActive, undefined);
  assert.equal(items[1].fields.CustomerCode, 'ACCT-A');
  assert.equal(writes, 1);
  assert.equal((await request('/api/v1/portal/shipments/12/tracking-request', { method: 'POST', headers: requestHeaders, body: '{}' })).status, 200);
  assert.equal(writes, 1);
  const pendingDashboard = await (await request('/api/v1/portal/shipments', { headers })).json();
  assert.equal(pendingDashboard.shipments.find(item => item.id === '12').canRequestTracking, false);
  assert.equal(pendingDashboard.shipments.find(item => item.id === '12').status, 'Tracking requested');
  const invite = await request('/sales-leads/1/portal-access', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lookup-Token': 'office-test' }, body: '{}' });
  assert.equal((await invite.json()).created, false);
  assert.equal(writes, 1);
  const logout = await request('/api/v1/portal/logout', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  accounts[0].fields.PortalPassword = 'rotated';
  assert.equal((await request('/api/v1/portal/shipments', { headers })).status, 401);
  accounts[0].fields.PortalPassword = '';
  const provision = await request('/sales-leads/1/portal-access', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lookup-Token': 'office-test' }, body: '{}' });
  const credential = await provision.json();
  assert.equal(provision.status, 200);
  assert.equal(credential.created, true);
  assert.equal(await verifyPortalPassword(credential.password, accounts[0].fields.PortalPassword), true);
  assert.notEqual(credential.password, accounts[0].fields.PortalPassword);
  assert.equal(writes, 2);
});
