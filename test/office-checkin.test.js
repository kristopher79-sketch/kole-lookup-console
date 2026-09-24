'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { deriveMobileStopState, cleanMobileStopEventItem } = require('../mobile-checkin');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const helperSource = source.slice(source.indexOf('function buildOfficeCheckInSummary('), source.indexOf('function getCheckInTimesWriteValue('));
const current = { label: 'Bid Listing', listId: 'current' };
const event = (action, time, extra = {}) => ({ loadId: '1', bol: 'TEST', stop: 'Pickup', stopSequence: 1, action, time, ...extra });
function setup(events = [], fail = false) {
  let reads = 0;
  const context = {
    deriveMobileStopState, cleanMobileStopEventItem,
    normalizeBolKey: (v) => String(v || '').trim().toUpperCase(),
    getCheckInTimesSchema: async () => ({ listId: 'events', fieldNames: Object.fromEntries(['bol', 'loadId', 'stop', 'stopSequence', 'action', 'time'].map(key => [key, key])) }),
    getCheckInTimesFieldSelect: () => '',
    getAllListItemsWithFieldsResilient: async (_token, _list, _select, options) => { reads++; if (fail) throw Error('synthetic'); return { items: events.map(event => options.mapItem({ fields: event })) }; },
    console: { warn() {} }
  };
  vm.createContext(context); vm.runInContext(helperSource, context);
  return { ...context, reads: () => reads };
}
const record = (extra = {}) => ({ id: '1', SourceListId: 'current', BOL: 'TEST', hasPickupEvidence: false, hasDeliveryEvidence: true, ...extra });
for (const stop of ['Pickup', 'Delivery']) {
  for (const count of [0, 1, 2]) {
    test(`${stop}: ${count} events, evidence stays independent`, async () => {
      const events = [event('In', '2026-09-24T11:42:00Z', { stop }), event('Out', '2026-09-24T13:05:00Z', { stop })].slice(0, count);
      const h = setup(events); const row = record();
      await h.hydrateOfficeCheckInSummaries('', [row], current);
      assert.equal(row.checkInSummary.available, true);
      assert.equal(row.checkInSummary[stop.toLowerCase()].arrivedAt, count ? '2026-09-24T11:42:00.000Z' : null);
      assert.equal(row.checkInSummary[stop.toLowerCase()].departedAt, count === 2 ? '2026-09-24T13:05:00.000Z' : null);
      assert.equal(row.hasPickupEvidence, false); assert.equal(row.hasDeliveryEvidence, true);
    });
  }
}
test('bulk and detail fail soft; archive never queries reused IDs', async () => {
  for (const size of [1, 20]) {
    const h = setup([], true); const row = record();
    await h.hydrateOfficeCheckInSummaries('', Array(size).fill(row), current);
    assert.equal(row.checkInSummary.available, false);
  }
  const h = setup([event('In', '2026-09-24T11:42:00Z')]); const row = record({ SourceListId: 'archive' });
  await h.hydrateOfficeCheckInSummaries('', [row], { label: 'Bid Listing Archive 2025', listId: 'archive' });
  assert.equal(row.checkInSummary.pickup.arrivedAt, null); assert.equal(h.reads(), 0);
});
test('one bulk read for many rows; BOL, load and sequence isolation; invalid timestamps ignored', async () => {
  const h = setup([
    event('In', '2026-09-24T11:42:00Z', { bol: 'OTHER' }),
    event('In', '2026-09-24T11:42:00Z', { stopSequence: 2 }),
    event('In', 'invalid'), event('In', '2026-09-24T11:42:00Z', { loadId: '999', bol: '' })
  ]);
  const rows = Array.from({ length: 40 }, (_, i) => record({ id: String(i + 1) }));
  await h.hydrateOfficeCheckInSummaries('', rows, current);
  assert.equal(h.reads(), 1); assert.ok(rows.every(r => r.checkInSummary.pickup.arrivedAt === null));
});
test('uses canonical earliest In and Out, independent of event order', async () => {
  const h = setup([event('Out', '2026-09-24T15:00:00Z'), event('In', '2026-09-24T12:00:00Z'), event('Out', '2026-09-24T14:00:00Z'), event('In', '2026-09-24T11:00:00Z')]);
  const row = record(); await h.hydrateOfficeCheckInSummaries('', [row], current);
  assert.equal(row.checkInSummary.pickup.arrivedAt, '2026-09-24T11:00:00.000Z');
  assert.equal(row.checkInSummary.pickup.departedAt, '2026-09-24T14:00:00.000Z');
});
test('both dashboard paths and both record routes call the shared hydration', () => {
  assert.equal((source.match(/await hydrateOfficeCheckInSummaries\(token, \[\.\.\.loadingToday, \.\.\.deliveringToday\], currentList\)/g) || []).length, 2);
  assert.equal((source.match(/await hydrateOfficeCheckInSummaries\(token, \[record\], (?:sourceList|currentList)\)/g) || []).length, 2);
});

for (const [name, bol, loadId, matches] of [
  ['both correct', 'TEST', '1', true],
  ['BOL correct, ID wrong', ' test ', '999', true],
  ['BOL correct, ID blank', 'TEST', '', true],
  ['BOL blank, ID correct', '', '1', true],
  ['BOL wrong, ID correct', 'OTHER', '1', false],
  ['both blank', '', '', false]
]) {
  test(`BOL-first matching: ${name}, dashboard and detail`, async () => {
    for (const rows of [[record()], [record(), record({ id: '2', BOL: 'OTHER' })]]) {
      const h = setup([event('In', '2026-09-24T11:42:00Z', { bol, loadId })]);
      await h.hydrateOfficeCheckInSummaries('', rows, current);
      assert.equal(Boolean(rows[0].checkInSummary.pickup.arrivedAt), matches);
      assert.equal(h.reads(), 1);
      if (rows.length > 1 && bol === 'OTHER') assert.ok(rows[1].checkInSummary.pickup.arrivedAt);
    }
  });
}
