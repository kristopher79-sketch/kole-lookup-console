const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const {
  estimateRetainedBytes, createMemoryCacheBudget, runWithWorkloadSlot, mapSequentialSettled
} = require('../server-memory');

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
// Load only named top-level functions, without starting Express, loading .env,
// or contacting Graph. Nested braces are indented in these functions.
function loadFunctions(names, bindings = {}, declarations = '') {
  const code = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `Missing function ${name}`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  }).join('\n');
  const context = vm.createContext({ setTimeout, clearTimeout, ...bindings });
  vm.runInContext(`${declarations}\n${code}`, context);
  return context;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function response() {
  const res = new EventEmitter();
  res.setHeader = () => {};
  res.status = () => res;
  res.json = () => { res.writableFinished = true; res.emit('finish'); return res; };
  return res;
}

test('large caches share an estimated byte budget and evict least recently used data', () => {
  const value = { text: 'x'.repeat(100) };
  const size = estimateRetainedBytes(value);
  const budget = createMemoryCacheBudget({ maxBytes: size * 2, maxEntryBytes: size });
  const bids = budget.createCache();
  const reports = budget.createCache();
  bids.set('a', value); reports.set('b', value);
  bids.get('a'); reports.set('c', value);
  assert.equal(reports.has('b'), false);
  assert.equal(bids.has('a'), true);
  assert.equal(budget.diagnostics().evictions, 1);
  assert.equal(budget.diagnostics().estimatedBytes, size * 2);
  bids.clear(); reports.delete('c');
  assert.equal(budget.diagnostics().estimatedBytes, 0);
});

test('oversized results are not retained; replacement and cyclic/Map values are accounted for', () => {
  const budget = createMemoryCacheBudget({ maxBytes: 2048, maxEntryBytes: 1024 });
  const cache = budget.createCache();
  const value = { text: 'x' }; value.self = value;
  cache.set('key', value);
  assert.equal(cache.get('key'), value);
  cache.set('key', { text: 'x'.repeat(2000) });
  assert.equal(cache.has('key'), false);
  assert.equal(budget.diagnostics().estimatedBytes, 0);
  assert.equal(budget.diagnostics().skippedEntries, 1);
  assert.ok(estimateRetainedBytes(new Map([['a', value]])) > estimateRetainedBytes(value));
});

test('expired large report entries are released even without revisiting their keys', async () => {
  const budget = createMemoryCacheBudget({ maxBytes: 2048, maxEntryBytes: 1024, maxAgeMs: 1 });
  const cache = budget.createCache();
  cache.set('report', { rows: [] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  budget.sweep();
  assert.equal(cache.size, 0);
  assert.equal(budget.diagnostics().estimatedBytes, 0);
});

test('disconnect does not release capacity while handler work is still running', async () => {
  const work = deferred(); const res = response(); let released = 0;
  const pending = runWithWorkloadSlot(() => work.promise, {}, res, () => released++);
  res.destroyed = true; res.emit('close');
  assert.equal(released, 0);
  work.resolve(); await pending;
  assert.equal(released, 1);
  assert.equal(res.listenerCount('close'), 0);
  res.emit('finish'); assert.equal(released, 1);
});

test('capacity is held until both computation and response transmission finish', async () => {
  const res = response(); let released = 0;
  await runWithWorkloadSlot(async () => {}, {}, res, () => released++);
  assert.equal(released, 0);
  res.emit('finish'); assert.equal(released, 1);
  const work = deferred(); const early = response();
  const pending = runWithWorkloadSlot(() => work.promise, {}, early, () => released++);
  early.emit('finish'); assert.equal(released, 1);
  work.resolve(); await pending; assert.equal(released, 2);
});

test('unexpected handler failure releases capacity and propagates to Express', async () => {
  let released = 0;
  await assert.rejects(runWithWorkloadSlot(async () => { throw Error('synthetic'); }, {}, response(), () => released++), /synthetic/);
  assert.equal(released, 1);
});

function workloadContext() {
  return loadFunctions([
    'getHeavyWorkloadKind', 'createHeavyWorkloadError', 'grantNextHeavyWorkload',
    'acquireHeavyWorkload', 'withHeavyWorkload'
  ], { runWithWorkloadSlot, logServerMemory: () => {} }, `
    const DASHBOARD_REFRESH_PATHS = new Set(['/dashboard/bootstrap']);
    const DASHBOARD_REFRESH_WORKLOAD = 'dashboard-refresh'; const REPORT_WORKLOAD = 'report';
    const HEAVY_WORKLOAD_MAX_QUEUE = 2; const HEAVY_WORKLOAD_MAX_WAIT_MS = 10000;
    let activeHeavyWorkload = null; const queuedHeavyWorkloads = [];
  `);
}
test('quote, report and search handlers serialize, including after disconnect', async () => {
  const ctx = workloadContext(); const work = deferred(); const entered = deferred(); let nextStarted = false;
  const firstReq = Object.assign(new EventEmitter(), { method: 'POST', path: '/quote-engine/recommendation' });
  const nextReq = Object.assign(new EventEmitter(), { method: 'GET', path: '/search' });
  const firstRes = response(); const nextRes = response();
  const first = ctx.withHeavyWorkload(async () => { entered.resolve(); await work.promise; })(firstReq, firstRes);
  await entered.promise;
  const second = ctx.withHeavyWorkload(async () => { nextStarted = true; nextRes.json({}); })(nextReq, nextRes);
  firstRes.destroyed = true; firstRes.emit('close');
  await Promise.resolve(); assert.equal(nextStarted, false);
  work.resolve(); await Promise.all([first, second]); assert.equal(nextStarted, true);
  for (const [method, route] of [['POST', '/quote-engine/publish'], ['GET', '/reports/customer-booking-trends'], ['GET', '/recruiting/snapshot'], ['GET', '/driver-roster/history-batch']]) {
    assert.ok(ctx.getHeavyWorkloadKind({ method, path: route }));
  }
  assert.equal(ctx.getHeavyWorkloadKind({ method: 'GET', path: '/quote-engine/options' }), '');
});

test('a disconnected queued request never runs and does not block its successor', async () => {
  const ctx = workloadContext(); const work = deferred(); const entered = deferred(); let cancelledRan = false;
  const makeReq = () => Object.assign(new EventEmitter(), { method: 'GET', path: '/search' });
  const firstRes = response(); const cancelRes = response();
  const first = ctx.withHeavyWorkload(async () => { entered.resolve(); await work.promise; firstRes.json({}); })(makeReq(), firstRes);
  await entered.promise;
  const cancelled = ctx.withHeavyWorkload(async () => { cancelledRan = true; })(makeReq(), cancelRes);
  cancelRes.destroyed = true; cancelRes.emit('close'); await cancelled;
  work.resolve(); await first;
  const lastRes = response();
  await ctx.withHeavyWorkload(async () => lastRes.json({}))(makeReq(), lastRes);
  assert.equal(cancelledRan, false);
});

function listContext(graphGet, mapBindings = {}) {
  return loadFunctions(['getAllListItemsWithFields', 'getAllListItemsWithFieldsResilient'], {
    graphGet, process: { env: { SITE_ID: 'synthetic-site' } }, ...mapBindings
  }, 'const LIST_READ_PAGE_SIZE = 200;');
}
test('pages are projected before the next read and opaque nextLink is preserved', async () => {
  const projected = []; const urls = [];
  const ctx = listContext(async (_token, url) => {
    urls.push(url);
    if (urls.length === 1) return { value: [{ id: '1', unused: 'raw' }], '@odata.nextLink': 'opaque-next-page' };
    assert.deepEqual(projected, ['1']);
    assert.equal(url, 'opaque-next-page');
    return { value: [{ id: '2', unused: 'raw' }] };
  });
  const records = await ctx.getAllListItemsWithFields('fake', 'list/id', 'BidID', {
    mapItem: (item) => { projected.push(item.id); return { id: item.id }; }
  });
  assert.deepEqual(Array.from(records), [{ id: '1' }, { id: '2' }]);
  assert.ok(urls[0].includes('/list%2Fid/'));
  assert.ok(urls[0].includes('$top=200'));
});

test('full-field fallback restarts cleanly after a partial selected-field read', async () => {
  let step = 0;
  const ctx = listContext(async (_token, url) => {
    step++;
    if (step === 1) return { value: [{ id: 'partial' }], '@odata.nextLink': 'failed-page' };
    if (step === 2) throw Error('synthetic schema mismatch');
    assert.ok(!url.includes('fields($select='));
    return { value: [{ id: 'complete' }] };
  });
  const result = await ctx.getAllListItemsWithFieldsResilient('fake', 'list', 'BidID', { mapItem: (item) => item.id });
  assert.deepEqual(Array.from(result.items), ['complete']);
  assert.equal(result.usedFallback, true);
});

test('sequential archive reads preserve order, partial failures, and later sources', async () => {
  let active = 0; let peak = 0;
  const results = await mapSequentialSettled([1, 2, 3], async (value) => {
    peak = Math.max(peak, ++active); await Promise.resolve(); active--;
    if (value === 2) throw Error('unavailable');
    return value;
  });
  assert.equal(peak, 1);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[2].value, 3);
});

test('cached date formatters preserve Eastern date boundaries and reuse native instances', () => {
  const ctx = loadFunctions(['getCachedDateFormatter', 'formatEasternDate'], {}, 'const cachedDateFormatters = new Map();');
  const options = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' };
  const expected = new Intl.DateTimeFormat('en-CA', options);
  for (const value of ['2026-09-24T03:59:59Z', '2026-09-24T04:00:00Z', '2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z']) {
    assert.equal(ctx.formatEasternDate(new Date(value)), expected.format(new Date(value)));
  }
  assert.equal(ctx.getCachedDateFormatter('en-CA', options), ctx.getCachedDateFormatter('en-CA', { ...options }));
});

test('upload evidence consumes pages without retaining raw rows and preserves unique evidence/counts', async () => {
  const ctx = loadFunctions(['getAllListItemsWithFields', 'getUploadEvidenceSets'], {
    process: { env: { SITE_ID: 'synthetic', UPLOAD_DIGEST_LIST_ID: 'uploads' } },
    normalizeBolKey: value => String(value || '').trim(), normalizeText: value => String(value || '').toLowerCase(),
    graphGet: async (_token, url) => url === 'opaque-next' ? { value: [{ fields: { BOLNumber: '1', UploadType: 'delivery' } }, { fields: {} }] }
      : { value: [{ fields: { BOLNumber: '1', UploadType: 'pickup' } }, { fields: { BOLNumber: '1', UploadType: 'pickup' } }], '@odata.nextLink': 'opaque-next' }
  }, 'const LIST_READ_PAGE_SIZE = 200;');
  const result = await ctx.getUploadEvidenceSets('synthetic');
  assert.deepEqual([...result.pickupEvidenceBols], ['1']);
  assert.deepEqual([...result.deliveryEvidenceBols], ['1']);
  assert.equal(result.uploadDigestCount, 4);
  let consumed = 0;
  const rows = await ctx.getAllListItemsWithFields('synthetic', 'uploads', '', { consumeItem: () => consumed++ });
  assert.equal(consumed, 4);
  assert.equal(rows.length, 0);
});

test('permit alert count preserves today, past, status, missing BOL and requested exclusions without folder reads', async () => {
  const ctx = loadFunctions(['buildReportActionAlertsResponse', 'isPermitGovernanceOperationalRow', 'getDateOnlyComparable'], {
    formatEasternDate: () => '2026-09-24', formatEasternTimestamp: () => 'synthetic',
    normalizeText: value => String(value || '').toLowerCase(), getNumberValue: value => Number(value || 0), parseBoolean: value => value === true,
    buildOrdersDueForSettlementResponse: () => ({ count: 0, reportLabel: 'Settlement' }),
    buildWonNotRegisteredResponse: () => ({ count: 0, reportLabel: 'Registration' })
  });
  const base = { BOLNumber_x0028_Won_x0029_: '1', Status: 'Won', Expected_x0020_Delivery_x0020_Da: '2026-09-24', Permits_x002f_Escort_x0020_Fees_: 100 };
  const variants = [{}, { Expected_x0020_Delivery_x0020_Da: '2026-09-25' }, { Expected_x0020_Delivery_x0020_Da: '2026-09-23' }, { Status: 'TONU' }, { BOLNumber_x0028_Won_x0029_: '' }, { PermitsRequested: true }, { Permits_x002f_Escort_x0020_Fees_: 0 }];
  const result = await ctx.buildReportActionAlertsResponse(variants.map(fields => ({ fields: { ...base, ...fields } })), { label: 'Synthetic' });
  assert.equal(result.alerts.permitGovernance.count, 2);
  assert.equal(result.totalAlerts, 2);
});
