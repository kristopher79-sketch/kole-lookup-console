'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const helpers = import('../client/client/src/dashboard-refresh.js');
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('duplicate bootstrap callers share a request; different module batches never overlap', async () => {
  const { createDashboardRefreshQueue } = await helpers;
  const queue = createDashboardRefreshQueue();
  const release = deferred(); let active = 0; let peak = 0; let calls = 0;
  const work = async () => { calls++; peak = Math.max(peak, ++active); await release.promise; active--; return { success: true }; };
  const first = queue.run('same-session-and-modules', work);
  assert.equal(queue.run('same-session-and-modules', work), first);
  const different = queue.run('different-modules', work);
  await Promise.resolve(); assert.equal(calls, 1);
  release.resolve(); await Promise.all([first, different]);
  assert.equal(calls, 2); assert.equal(peak, 1);
});

test('a mutation refresh runs after older work and queued duplicates still share', async () => {
  const { createDashboardRefreshQueue } = await helpers;
  const queue = createDashboardRefreshQueue(); const release = deferred(); let version = 0;
  const first = queue.run('operations', async () => { await release.promise; return ++version; });
  const next = queue.run('operations', () => ++version, { afterCurrent: true });
  assert.notEqual(first, next);
  assert.equal(queue.run('operations', () => ++version, { afterCurrent: true }), next);
  release.resolve();
  assert.deepEqual(await Promise.all([first, next]), [1, 2]);
  const failed = queue.run('error', () => { throw Error('synthetic'); });
  const recovery = queue.run('recovery', () => 3);
  await assert.rejects(failed, /synthetic/); assert.equal(await recovery, 3);
});

test('hidden tabs and minimized desktop windows pause visual polling; visible unfocused windows remain eligible', async () => {
  const { isDashboardRefreshVisible } = await helpers;
  assert.equal(isDashboardRefreshVisible({ visibilityState: 'hidden' }), false);
  assert.equal(isDashboardRefreshVisible({ visibilityState: 'visible' }, true), false);
  assert.equal(isDashboardRefreshVisible({ visibilityState: 'visible' }, false), true);
});

test('queued dashboard work from an ended login cannot fetch or populate a new session', async () => {
  const { createDashboardRefreshQueue } = await helpers;
  const source = fs.readFileSync(require.resolve('../client/client/src/App.jsx'), 'utf8');
  const start = source.indexOf('async function loadDashboardBootstrap(');
  const code = source.slice(start, source.indexOf('\n}', start) + 2);
  const queue = createDashboardRefreshQueue(); const release = deferred();
  const active = queue.run('old-request', () => release.promise);
  let calls = 0;
  const session = { current: 0 };
  const ctx = vm.createContext({ dashboardSessionRef: session, dashboardRefreshQueueRef: { current: queue },
    uploadDigestDateRef: { current: '2026-11-27' }, accessToken: 'synthetic', fetchDashboardBootstrap: () => { calls++; }, Date });
  vm.runInContext(code, ctx);
  const waiting = ctx.loadDashboardBootstrap({ moduleKeys: ['operations'] });
  session.current++; release.resolve(); await active;
  assert.equal(await waiting, false); assert.equal(calls, 0);
});

test('transient bootstrap failures retain the screen without fallback fan-out; older servers still work', async () => {
  const source = fs.readFileSync(require.resolve('../client/client/src/App.jsx'), 'utf8');
  const start = source.indexOf('async function fetchDashboardBootstrap(');
  const code = source.slice(start, source.indexOf('\n}', start) + 2);
  for (const status of [503, 404, 405]) {
    let fallbacks = 0; const applied = [];
    const ctx = vm.createContext({ Date, URLSearchParams, API: '', dashboardSessionRef: { current: 0 },
      dashboardRefreshInFlightRef: { current: new Set() }, dashboardRefreshLastRunRef: { current: {} },
      operationsData: { existing: true }, authedFetch: async () => ({ status, ok: false, json: async () => ({}) }),
      applyDashboardBootstrapModule: (key, result) => applied.push({ key, result }),
      loadOperationsDashboard: async () => { fallbacks++; return false; } });
    vm.runInContext(code, ctx);
    assert.equal(await ctx.fetchDashboardBootstrap(['operations'], '2026-11-27', 0), false);
    assert.equal(fallbacks, status === 503 ? 0 : 1);
    assert.equal(applied.length, status === 503 ? 1 : 0);
    assert.equal(ctx.dashboardRefreshInFlightRef.current.size, 0);
  }
});
