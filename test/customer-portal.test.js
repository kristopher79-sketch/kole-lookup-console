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

const returnRow = (extra = {}) => ({ id: 'return-1', fields: {
  TruckNumber: '0001', OperatorName: 'Private driver 1', Status: 'Active',
  StartDate: '2026-11-20', EndDate: '2026-11-24', LaunchingPoint: 'Charlotte, NC', ...extra
} });

test('time-off returns create projected capacity from the launching point and roster equipment without a published run', () => {
  const capacity = buildPortalCapacity({ now, roster: [rosterRow('1', '0001')], timeOff: [returnRow()] });
  assert.deepEqual(capacity.opportunities, [
    { date: '2026-11-25', location: 'Charlotte, NC', equipment: 'Conestoga', kind: 'Projected' }
  ]);
  assert.equal(capacity.asOf, now.toISOString());
  for (const hidden of ['0001', 'Private driver', 'TruckNumber', 'returningTimeOff', 'LaunchingPoint']) {
    assert.equal(JSON.stringify(capacity).includes(hidden), false);
  }
});

test('time-off return dates include today through day seven and exclude past, day eight, invalid and cancelled returns', () => {
  const base = { now, roster: [rosterRow('1', '0001')] };
  for (const [EndDate, availableDate] of [['2026-11-22', '2026-11-23'], ['2026-11-29', '2026-11-30']]) {
    assert.equal(buildPortalCapacity({ ...base, timeOff: [returnRow({ EndDate })] }).opportunities[0]?.date, availableDate);
  }
  for (const extra of [
    { EndDate: '2026-11-21' }, { EndDate: '2026-11-30' }, { EndDate: 'invalid' },
    { StartDate: '2026-11-25' }, { StartDate: '' }, { LaunchingPoint: '' },
    { LaunchingPoint: 'Unknown' }, { Status: 'Cancelled' }, { Status: 'Canceled' }, { Status: 'Inactive' }
  ]) {
    assert.deepEqual(buildPortalCapacity({ ...base, timeOff: [returnRow(extra)] }).opportunities, []);
  }
});

test('future returns project scheduled load completion and start after inclusive time off', () => {
  const base = {
    now: new Date('2026-11-25T15:29:00Z'), roster: [rosterRow('1', '0001')],
    timeOff: [returnRow({ StartDate: '2026-11-25T00:00:00Z', EndDate: '2026-11-30T00:00:00Z' })]
  };
  const load = row('40', 'ANY', {
    Truck_x0020_Number: '1', Pickup_x0020_Offer_x0020_Date: '2026-11-23',
    Expected_x0020_Delivery_x0020_Da: '2026-11-25'
  });
  const expected = [{ date: '2026-12-01', location: 'Charlotte, NC', equipment: 'Conestoga', kind: 'Projected' }];
  for (const delivery of ['2026-11-25', '2026-11-30', '2026-12-01']) {
    const orders = [{ ...load, fields: { ...load.fields, Expected_x0020_Delivery_x0020_Da: delivery } }];
    assert.deepEqual(buildPortalCapacity({ ...base, orders }).opportunities, expected);
  }
  for (const delivery of ['2026-11-24', '2026-12-02', '', 'invalid', '2026-11-22']) {
    const orders = [{ ...load, fields: { ...load.fields, Expected_x0020_Delivery_x0020_Da: delivery } }];
    assert.deepEqual(buildPortalCapacity({ ...base, orders }).opportunities, []);
  }
  const overdue = { ...load, fields: { ...load.fields, Expected_x0020_Delivery_x0020_Da: '2026-11-24' } };
  const evidence = { deliveryEvidenceBols: new Set(['DEMO-40']) };
  assert.deepEqual(buildPortalCapacity({ ...base, orders: [overdue], evidence }).opportunities, expected);
  const futureBooking = row('41', 'ANY', {
    Truck_x0020_Number: '1', Pickup_x0020_Offer_x0020_Date: '2026-12-08',
    Expected_x0020_Delivery_x0020_Da: '2026-12-09'
  });
  assert.deepEqual(buildPortalCapacity({ ...base, orders: [load, futureBooking] }).opportunities, []);
  const otherOff = returnRow({ StartDate: '2026-12-01', EndDate: '2026-12-10' });
  assert.deepEqual(buildPortalCapacity({ ...base, orders: [load], timeOff: [...base.timeOff, otherOff] }).opportunities, []);
});

test('published future forecasts may rely on scheduled delivery while today requires completion', () => {
  const load = row('40', 'ANY', {
    Truck_x0020_Number: '1', Pickup_x0020_Offer_x0020_Date: '2026-11-22',
    Expected_x0020_Delivery_x0020_Da: '2026-11-23'
  });
  const base = { now, roster: [rosterRow('1', '0001')], orders: [load] };
  assert.equal(buildPortalCapacity({ ...base, projected: [capacityRow('1', '0001')] }).opportunities.length, 1);
  const overdue = { ...load, fields: { ...load.fields, Expected_x0020_Delivery_x0020_Da: '2026-11-22' } };
  assert.deepEqual(buildPortalCapacity({ ...base, orders: [overdue], projected: [capacityRow('1', '0001')] }).opportunities, []);
  for (const candidates of [
    { current: [{ createdDateTime: '2026-11-23T12:00:00Z', fields: { UnitNo: '0001', DateSent: '2026-11-23', CurrentLocation: 'Charlotte, NC' } }] },
    { projected: [capacityRow('1', '0001', { ProjectedEmpty: '2026-11-23' })] }
  ]) {
    assert.deepEqual(buildPortalCapacity({ ...base, ...candidates }).opportunities, []);
    const evidence = { deliveryEvidenceBols: new Set(['DEMO-40']) };
    assert.equal(buildPortalCapacity({ ...base, ...candidates, evidence }).opportunities.length, 1);
  }
});

test('return projections keep booking, other time-off, solo and unique-roster eligibility checks', () => {
  const base = { now, roster: [rosterRow('1', '0001')], timeOff: [returnRow()] };
  const booking = row('40', 'ANY', { Truck_x0020_Number: '1', Pickup_x0020_Offer_x0020_Date: '2026-12-01', Expected_x0020_Delivery_x0020_Da: '2026-12-02' });
  assert.deepEqual(buildPortalCapacity({ ...base, orders: [booking] }).opportunities, []);
  const otherOff = { id: 'other-off', fields: { TruckNumber: '0001', Status: 'Active', StartDate: '2026-12-03', EndDate: '2026-12-05' } };
  assert.deepEqual(buildPortalCapacity({ ...base, timeOff: [...base.timeOff, otherOff] }).opportunities, []);
  otherOff.fields.StartDate = '2026-12-05';
  assert.equal(buildPortalCapacity({ ...base, timeOff: [...base.timeOff, otherOff] }).opportunities.length, 1);
  for (const extra of [{ SoloorTeam: 'Team' }, { Status: 'Inactive' }, { TrailerType: 'Unknown' }]) {
    assert.deepEqual(buildPortalCapacity({ ...base, roster: [rosterRow('1', '0001', extra)] }).opportunities, []);
  }
  assert.deepEqual(buildPortalCapacity({ ...base, roster: [...base.roster, rosterRow('2', '0001')] }).opportunities, []);
});

test('a return is not shown as current while time off is active and does not replace another equipment family', () => {
  const current = [
    { createdDateTime: '2026-11-23T12:00:00Z', fields: { UnitNo: '0001', DateSent: '2026-11-23', CurrentLocation: 'Previous City, NC' } },
    { createdDateTime: '2026-11-23T12:00:00Z', fields: { UnitNo: '0002', DateSent: '2026-11-23', CurrentLocation: 'Charlotte, NC' } }
  ];
  const capacity = buildPortalCapacity({ now, current, projected: [capacityRow('1', '0001')],
    roster: [rosterRow('1', '0001'), rosterRow('2', '0002', { TrailerType: "48' RGN" })], timeOff: [returnRow()] });
  assert.deepEqual(capacity.opportunities, [
    { date: '2026-11-23', location: 'Charlotte, NC', equipment: 'RGN', kind: 'Current' },
    { date: '2026-11-25', location: 'Charlotte, NC', equipment: 'Conestoga', kind: 'Projected' }
  ]);
});

test('capacity fails closed for stale publications, missing eligibility data, and closed hours', () => {
  const stale = { ...capacityRow('1', '0001'), createdDateTime: '2026-11-20T12:00:00Z' };
  assert.equal(buildPortalCapacity({ now, projected: [stale], roster: [rosterRow('1', '0001')] }).opportunities.length, 0);
  assert.equal(buildPortalCapacity({ now, projected: [capacityRow('1', '0001')], roster: [] }).opportunities.length, 0);
  const closed = buildPortalCapacity({ now: new Date('2026-11-23T23:00:00Z') });
  assert.equal(closed.open, false);
  assert.deepEqual(closed.opportunities, []);
});

test('capacity HTTP reads launching points and refreshes cached returns after time-off writes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: now.getTime() });
  const app = express();
  let launchingPoint = 'Charlotte, NC';
  let capacityReads = 0;
  const portal = createCustomerPortalRoutes(app, {
    getGraphToken: async () => 'fake-graph-token',
    getCurrentBidListingSource: async () => ({ listId: 'orders' }),
    getAvailableTrucksListId: () => 'available', getRosterListId: () => 'roster', getTimeOffListId: () => 'time-off',
    getAllListItemsWithFields: async (_token, list, fields) => {
      if (list === 'roster') return [rosterRow('1', '0001')];
      if (list === 'time-off') {
        assert.ok(fields.split(',').includes('LaunchingPoint'));
        capacityReads++;
        return [returnRow({ LaunchingPoint: launchingPoint })];
      }
      return [];
    },
    getUploadEvidenceSets: async () => ({}), requireLookupAccess: (_req, _res, next) => next()
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/v1/portal/capacity`;
  const load = async () => {
    const response = await fetch(endpoint);
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await load()).opportunities[0].location, 'Charlotte, NC');
  launchingPoint = 'Greensboro, NC';
  assert.equal((await load()).opportunities[0].location, 'Charlotte, NC');
  assert.equal(capacityReads, 1);
  portal.clearCapacityCache();
  assert.equal((await load()).opportunities[0].location, 'Greensboro, NC');
  assert.equal(capacityReads, 2);
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
