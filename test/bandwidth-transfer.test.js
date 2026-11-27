'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { gunzipSync } = require('node:zlib');
const express = require('express');
const { createTransferMonitor, coalesceLookupJson } = require('../server-transfer');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function serve(t, configure) {
  const app = express();
  const monitor = createTransferMonitor({ maxRoutes: 3 });
  app.use(monitor.middleware);
  configure(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { monitor, port: server.address().port };
}
function request(port, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, headers, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('JSON gzip preserves data, negotiates q=0, varies caches, and measures transmitted body bytes', async t => {
  const payload = { success: true, rows: Array.from({ length: 300 }, (_, id) => ({ id, value: 'synthetic repeated operational label' })) };
  const { port, monitor } = await serve(t, app => {
    app.get('/dashboard/bootstrap', (_req, res) => res.json(payload));
    app.get('/auth-check', (_req, res) => res.json(payload));
    app.get('/reports/private', (_req, res) => res.set('Cache-Control', 'private, no-transform').json(payload));
  });
  const compressed = await request(port, '/dashboard/bootstrap', { 'Accept-Encoding': 'gzip' });
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.match(compressed.headers.vary, /Accept-Encoding/);
  assert.equal(Number(compressed.headers['content-length']), compressed.body.length);
  assert.deepEqual(JSON.parse(gunzipSync(compressed.body)), payload);
  const plain = await request(port, '/dashboard/bootstrap', { 'Accept-Encoding': 'gzip;q=0, identity' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(plain.body), payload);
  assert.ok(compressed.body.length < plain.body.length / 2);
  const unchanged = await request(port, '/dashboard/bootstrap', { 'Accept-Encoding': 'gzip', 'If-None-Match': compressed.headers.etag });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body.length, 0);
  assert.equal((await request(port, '/auth-check', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined);
  assert.equal((await request(port, '/reports/private', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined);
  const totals = monitor.snapshot();
  assert.equal(totals.outbound['GET /dashboard/bootstrap 2xx'].bodyBytes, plain.body.length + compressed.body.length);
  assert.equal(totals.outbound['GET /dashboard/bootstrap 3xx'].bodyBytes, 0);
  assert.equal(totals.outbound['GET /dashboard/bootstrap 2xx'].jsonBytes, plain.body.length * 2);
});

test('bootstrap coalescing precedes computation, respects authorization/query, and does not cache settled results', async t => {
  let calls = 0;
  const started = deferred(); const release = deferred();
  const { port } = await serve(t, app => {
    app.get('/dashboard/bootstrap', (req, res, next) => req.headers['x-lookup-token'] ? next() : res.sendStatus(401),
      coalesceLookupJson(async (req, res) => {
        calls++; started.resolve(); await release.promise;
        res.json({ success: true, scope: req.headers['x-lookup-token'], include: req.query.include });
      }));
  });
  const path = '/dashboard/bootstrap?include=operations';
  const a = request(port, path, { 'X-Lookup-Token': 'synthetic-a' });
  await started.promise;
  const b = request(port, path, { 'X-Lookup-Token': 'synthetic-a' });
  // A distinct request completes its headers before releasing the blocked work.
  assert.equal((await request(port, path)).status, 401);
  const c = request(port, path, { 'X-Lookup-Token': 'synthetic-b' });
  const d = request(port, '/dashboard/bootstrap?include=driverPositions', { 'X-Lookup-Token': 'synthetic-a' });
  await new Promise(resolve => setImmediate(resolve));
  release.resolve();
  const results = await Promise.all([a, b, c, d]);
  assert.deepEqual(results[0].body, results[1].body);
  assert.equal(results[1].headers['x-kole-coalesced'], '1');
  assert.equal(JSON.parse(results[2].body).scope, 'synthetic-b');
  assert.equal(calls, 3);
  await request(port, path, { 'X-Lookup-Token': 'synthetic-a' });
  assert.equal(calls, 4);
});

test('mutation barriers prevent a post-write read from sharing an older bootstrap', async t => {
  const release = deferred(); const started = deferred(); let calls = 0;
  const { port } = await serve(t, app => {
    app.get('/dashboard/bootstrap', coalesceLookupJson(async (_req, res) => {
      const version = ++calls; started.resolve(); await release.promise; res.json({ version });
    }));
    app.post('/synthetic-edit', (_req, res) => res.json({ success: true }));
  });
  const a = request(port, '/dashboard/bootstrap'); await started.promise;
  await request(port, '/synthetic-edit', {}, 'POST');
  const b = request(port, '/dashboard/bootstrap');
  release.resolve();
  const results = await Promise.all([a, b]);
  assert.equal(calls, 2);
  assert.notDeepEqual(results[0].body, results[1].body);
});

test('byte totals contain only bounded route templates and aggregate upstream lengths', async t => {
  const { port, monitor } = await serve(t, app => {
    app.get('/documents/:id', (_req, res) => { res.write('abc'); res.end('def'); });
  });
  await request(port, '/documents/private-example?customer=private-value', { 'X-Lookup-Token': 'synthetic-token' });
  monitor.recordUpstream(new Response('', { headers: { 'Content-Length': '123' } }));
  monitor.recordUpstream(new Response(''), 'other');
  const totals = monitor.snapshot();
  assert.equal(totals.outbound['GET /documents/:id 2xx'].bodyBytes, 6);
  assert.deepEqual(totals.upstream.graph, { responses: 1, declaredBytes: 123, unknownLength: 0 });
  assert.equal(totals.upstream.other.unknownLength, 1);
  for (const secret of ['private-example', 'private-value', 'synthetic-token']) assert.equal(JSON.stringify(totals).includes(secret), false);
});
