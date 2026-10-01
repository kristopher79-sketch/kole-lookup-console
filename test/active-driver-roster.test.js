'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
// Exercise the actual server helpers without starting Express or contacting Graph.
const names = [
  'normalizeText', 'normalizeSearchValue', 'parseBoolean', 'cleanRosterText',
  'normalizeTruckKey', 'getRosterReportDisplayName', 'normalizeDriverRosterReportStatus',
  'filterDriverRosterByStatus', 'getCachedDateFormatter', 'normalizeEasternDateOnly',
  'normalizeSharePointBusinessDate', 'formatEasternDate', 'formatEasternTimestamp',
  'addDaysToDateInput', 'getNumberValue', 'getPositionAgeMinutes', 'getIgnitionStatusLabel',
  'getTripStatusLabel', 'cleanDriverPositionItem', 'sortDriverPositions', 'buildOperationsRecord',
  'normalizeBolKey', 'addUploadEvidence', 'parseAssignmentPickupClock', 'pushAssignmentToMapArray',
  'getDateOnlyTime', 'getInclusiveDateSpanDays', 'sortDriverTimeOffRows',
  'isDriverTimeOffCurrent', 'enrichDriverTimeOffRow', 'buildDriverTimeOffCurrentResponse',
  'formatRosterDutyDate', 'compareRosterDutyLoads', 'buildRosterDutyState',
  'buildActiveDriverRosterPositions', 'buildBootstrapDriverPositionsPayload'
];
function setup(bindings = {}) {
  const context = vm.createContext({
    process: { env: { DRIVER_POSITIONS_LIST_ID: 'positions', DRIVER_ROSTER_LIST_ID: 'roster' } },
    ...bindings
  });
  const code = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  }).join('\n');
  vm.runInContext(`const cachedDateFormatters = new Map(); const DRIVER_TIME_OFF_UPCOMING_DAYS = 7;\n${code}`, context);
  return context;
}
const h = setup();
const today = '2026-10-01';
const roster = (extra = {}) => ({ id: 'r1', status: 'Active', truck: '0311', tmsName: 'Test Driver', ...extra });
const position = (extra = {}) => ({ id: 'p1', fields: { EquipmentID: '311', Speed: 25, PositionTimeUTC: new Date().toISOString(), CurrentCityState: 'Atlanta, GA', ...extra } });
const load = (extra = {}, id = 'l1') => ({ id, fields: {
  Status: 'Won', Truck_x0020_Number: '311', BOLNumber_x0028_Won_x0029_: 'BOL109333',
  Pickup_x0020_Offer_x0020_Date: '2026-09-30', Expected_x0020_Delivery_x0020_Da: '2026-10-02',
  ...extra
} });
const off = (reason = 'Leave', extra = {}) => ({ id: 'o1', truckNumber: '0311', operatorName: 'Test Driver', reason, startDate: '2026-09-01', endDate: '2026-10-07', ...extra });
function rows({ rosters = [roster()], positions = [], loads = [], timeOff = [], pickup = [], delivery = [], warning = '' } = {}) {
  return h.buildActiveDriverRosterPositions(rosters, positions, loads, { listId: 'bids' }, {
    pickupEvidenceBols: new Set(pickup), deliveryEvidenceBols: new Set(delivery)
  }, { rows: timeOff, warning }, today);
}
test('Case 1: active driver with GPS and pickup evidence is In Transit', () => {
  const [r] = rows({ positions: [position()], loads: [load()], pickup: ['BOL109333'] });
  assert.equal(r.roster.id, 'r1'); assert.equal(r.id, 'r1'); assert.equal(r.positionId, 'p1');
  assert.equal(r.hasPosition, true); assert.equal(r.currentCityState, 'Atlanta, GA');
  assert.equal(r.speed, 25); assert.equal(r.dutyState, 'in_transit');
  assert.equal(r.dutyLoadLabel, 'BOL109333'); assert.equal(r.dutyTimingLabel, 'Delivers 10/2');
});
test('Case 2: extended/medical leave remains visible without GPS', () => {
  const [r] = rows({ timeOff: [off()] });
  assert.equal(r.hasPosition, false); assert.equal(r.currentCityState, '');
  assert.equal(r.latitude, null); assert.equal(r.speed, null); assert.equal(r.isStale, false);
  assert.equal(r.dutyState, 'off_time'); assert.equal(r.dutyLoadLabel, 'Leave');
  assert.equal(r.dutyTimingLabel, 'Returns 10/7'); assert.equal(r.roster.id, 'r1');
});
test('Case 3: long Home Time survives telemetry cleanup', () => {
  const [r] = rows({ timeOff: [off('Home Time')] });
  assert.equal(r.hasPosition, false); assert.equal(r.dutyState, 'off_time');
  assert.equal(r.dutyLoadLabel, 'Home Time'); assert.equal(r.dutyTimingLabel, 'Returns 10/7');
});
test('Case 4: active driver without assignments or time off is Available', () => {
  const [r] = rows({ positions: [position()] });
  assert.equal(r.dutyState, 'available'); assert.equal(r.dutyLoadLabel, '—');
});
test('Case 5: earliest future pickup wins, including time-of-day ties', () => {
  const later = load({ Pickup_x0020_Offer_x0020_Date: '2026-10-02', Pickup1PickupTime: '2:00', Pickup1AMorPM: 'PM' }, 'later');
  const earlier = load({ Pickup_x0020_Offer_x0020_Date: '2026-10-02', Pickup1PickupTime: '8:00', Pickup1AMorPM: 'AM' }, 'earlier');
  const [r] = rows({ loads: [later, earlier] });
  assert.equal(r.dutyState, 'next_pickup'); assert.equal(r.nextLoad.id, 'earlier');
  assert.equal(r.currentLoad, null); assert.equal(r.dutyLoadLabel, 'BOL109333');
  assert.equal(r.dutyTimingLabel, '10/2 · 8:00 AM');
});
test('Case 6: inactive driver with lingering GPS is excluded', () => {
  assert.equal(rows({ rosters: [roster({ status: 'Inactive' })], positions: [position({ ActiveInRoster: true })] }).length, 0);
});
test('Case 7: unexplained missing GPS remains visible and Available', () => {
  const [r] = rows();
  assert.equal(r.hasPosition, false); assert.equal(r.dutyState, 'available');
  assert.equal(r.roster.id, 'r1'); assert.equal(r.currentLoad, null);
});
test('New Vision truck 5550 is excluded from the shared roster rows with or without GPS', () => {
  for (const truck of ['5550', ' 5550 ', '05550']) {
    for (const positions of [[], [position({ EquipmentID: '5550' })]]) {
      const result = rows({
        rosters: [roster(), roster({ id: 'subcontractor', truck, tmsName: 'New Vision' })],
        positions
      });
      assert.equal(result.length, 1);
      assert.equal(result[0].roster.id, 'r1');
    }
  }
});
test('working evidence overrides overlapping time off; delivery today has priority', () => {
  const [r] = rows({ loads: [load({ Expected_x0020_Delivery_x0020_Da: today })], pickup: ['BOL109333'], timeOff: [off()] });
  assert.equal(r.dutyState, 'delivering_today'); assert.equal(r.currentTimeOff.reason, 'Leave');
});
test('schedule span alone never establishes In Transit', () => {
  assert.equal(rows({ loads: [load()] })[0].dutyState, 'attention');
  assert.equal(rows({ loads: [load()], timeOff: [off()] })[0].dutyState, 'off_time');
  assert.equal(rows({ loads: [load({ Pickup_x0020_Offer_x0020_Date: today })] })[0].dutyState, 'pickup_today');
});
test('delivered, processed, finally settled, and non-Won loads cannot drive duty', () => {
  for (const fields of [{ Processed: true }, { FinalSettleSent: 'Yes' }, { Status: 'TONU' }]) {
    assert.equal(rows({ loads: [load(fields)], pickup: ['BOL109333'] })[0].dutyState, 'available');
  }
  assert.equal(rows({ loads: [load()], pickup: ['BOL109333'], delivery: ['BOL109333'] })[0].dutyState, 'available');
});
test('latest position is attached; stale data stays stale; unmatched GPS never adds rows', () => {
  const [r] = rows({ positions: [position({ PositionTimeUTC: '2026-01-01T12:00:00Z' }), position({ CurrentCityState: 'New York, NY' }), position({ EquipmentID: '9999' })] });
  assert.equal(r.currentCityState, 'New York, NY'); assert.equal(r.isStale, false);
  assert.equal(rows({ positions: [position({ PositionTimeUTC: '2026-01-01T12:00:00Z' })] })[0].isStale, true);
});
test('roster identity survives duplicate and missing truck numbers', () => {
  const result = rows({ rosters: [roster(), roster({ id: 'r2' }), roster({ id: 'r3', truck: '' })], positions: [position()] });
  assert.equal(result.length, 3); assert.equal(new Set(result.map(r => r.id)).size, 3);
  assert.equal(result.find(r => r.id === 'r3').hasPosition, false);
});
test('time off is inclusive, respects cancellation and known trucks, and supports operator fallback', () => {
  assert.equal(rows({ timeOff: [off('Repairs', { startDate: today, endDate: today })] })[0].dutyState, 'off_time');
  for (const extra of [{ isCancelled: true }, { endDate: '2026-09-30' }, { startDate: '2026-10-02' }, { truckNumber: '9999' }]) {
    assert.equal(rows({ timeOff: [off('Leave', extra)] })[0].dutyState, 'available');
  }
  assert.equal(rows({ timeOff: [off('Repairs', { truckNumber: '' })] })[0].dutyLoadLabel, 'Repairs');
});
test('SharePoint schedule dates do not shift at midnight UTC; business today uses Eastern', () => {
  const [r] = rows({ loads: [load({ Pickup_x0020_Offer_x0020_Date: '2026-10-01T00:00:00Z' })] });
  assert.equal(r.dutyState, 'pickup_today');
  assert.equal(h.formatEasternDate(new Date('2026-10-02T02:00:00Z')), '2026-10-01');
  assert.equal(h.formatEasternDate(new Date('2026-12-02T04:00:00Z')), '2026-12-01');
});
test('future load remains attached during time off and during a current load', () => {
  const future = load({ Pickup_x0020_Offer_x0020_Date: '2026-11-01', BOLNumber_x0028_Won_x0029_: 'FUTURE' }, 'future');
  assert.equal(rows({ loads: [future], timeOff: [off()] })[0].dutyState, 'off_time');
  const [r] = rows({ loads: [load(), future], pickup: ['BOL109333'] });
  assert.equal(r.currentLoad.id, 'l1'); assert.equal(r.nextLoad.id, 'future');
});
test('unavailable time-off source never quietly implies Available', () => {
  assert.equal(rows({ warning: 'Unavailable' })[0].dutyState, 'attention');
});
test('payload fetches each source once for 200 drivers and honors refresh/shared sources', async () => {
  const reads = {}; let refresh;
  const count = (key, value) => async () => { reads[key] = (reads[key] || 0) + 1; return value; };
  const c = setup({
    getCurrentBidListingSource: count('list', { listId: 'bids' }),
    getDriverRosterItems: count('roster', Array.from({ length: 200 }, (_, i) => roster({ id: `r${i}`, truck: `${i}` }))),
    getDriverPositionItems: count('position', [position()]),
    getDashboardBidSource: async (_token, _list, options) => { reads.bid = (reads.bid || 0) + 1; refresh = options.forceRefresh; return []; },
    getUploadEvidenceSets: count('evidence', { pickupEvidenceBols: new Set(), deliveryEvidenceBols: new Set() }),
    getDriverTimeOffListId: () => 'off', getDriverTimeOffRows: count('off', { rows: [] })
  });
  const result = await c.buildBootstrapDriverPositionsPayload('', { forceRefresh: true });
  assert.equal(result.counts.total, 200); assert.equal(result.counts.noPosition, 200);
  assert.equal(result.counts.moving, 0); assert.equal(result.counts.stopped, 0); assert.equal(result.counts.stale, 0);
  assert.equal(refresh, true); assert.deepEqual(reads, { list: 1, roster: 1, position: 1, bid: 1, evidence: 1, off: 1 });
  await c.buildBootstrapDriverPositionsPayload('', { currentList: { listId: 'bids' }, bidItems: Promise.resolve([]), evidenceSets: Promise.resolve({ pickupEvidenceBols: new Set(), deliveryEvidenceBols: new Set() }) });
  assert.equal(reads.bid, 1); assert.equal(reads.evidence, 1); assert.equal(reads.list, 1);
  c.getDriverTimeOffRows = async () => { throw new Error('Synthetic source failure'); };
  await assert.rejects(c.buildBootstrapDriverPositionsPayload(''), /Synthetic source failure/);
});

test('existing operational refresh reloads enriched roster with force refresh and retains data on failure', async () => {
  const client = fs.readFileSync(require.resolve('../client/client/src/App.jsx'), 'utf8');
  const code = ['loadDriverPositions', 'refreshOperationsAndTracking'].map((name) => {
    const start = client.indexOf(`async function ${name}(`);
    return client.slice(start, client.indexOf('\n}', start) + 2);
  }).join('\n');
  let payload = { success: true, positions: [{ roster: { id: 'old' } }] };
  let stored = payload; let request; let error = ''; let calls = 0; let cue = 0;
  const c = vm.createContext({
    API: '/api', uploadDigestDate: today,
    authedFetch: async (url) => { request = url; return { json: async () => payload }; },
    setDriverPositionsData: (value) => { stored = value; },
    setDriverPositionsLoading() {}, setDriverPositionsError: (value) => { error = value; },
    loadOperationsDashboard: async (options) => { assert.equal(options.forceRefresh, true); return true; },
    loadUploadDigest: () => { calls++; }, loadIntelliTrack: () => { calls++; },
    loadAvailableTrucks: () => { calls++; }, loadAvailableTruckDistributionList: () => { calls++; },
    playDataRefreshCue: () => { cue++; }
  });
  vm.runInContext(code, c);
  payload = { success: true, positions: [{ roster: { id: 'new' }, dutyState: 'off_time' }] };
  await c.refreshOperationsAndTracking();
  await Promise.resolve();
  assert.equal(request, '/api/tracking/driver-positions?refresh=true');
  assert.equal(stored.positions[0].roster.id, 'new'); assert.equal(calls, 4); assert.equal(cue, 1);
  payload = { success: false, error: 'Synthetic failure' };
  await c.loadDriverPositions();
  assert.equal(stored.positions[0].roster.id, 'new'); assert.equal(error, 'Synthetic failure');
});
