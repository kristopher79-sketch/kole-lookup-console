'use strict';

const { createHash } = require('node:crypto');
const { gzip } = require('node:zlib');

// Only ordinary read payloads; credential and session responses are excluded.
function canCompressJson(req) {
  const path = `${req.baseUrl || ''}${req.path}`;
  return req.method === 'GET' && (
    /^\/(dashboard\/bootstrap|operations\/(today|snapshot)|tracking\/(driver-positions|intellitrack)|upload-digest|available-trucks(?:\/distribution-list)?|recruiting\/dashboard|search)$/.test(path) ||
    /^\/reports\//.test(path) ||
    /^\/api\/v1\/portal\/(capacity|shipments)$/.test(path) ||
    /^\/mobile\/(home|my-load|strapping-examples)$/.test(path)
  );
}

function chunkBytes(chunk, encoding) {
  if (typeof chunk === 'string') return Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : 'utf8');
  return chunk?.byteLength || 0;
}

function createTransferMonitor({ maxRoutes = 160 } = {}) {
  const routes = new Map();
  let readGeneration = 0;
  const upstream = { graph: { responses: 0, declaredBytes: 0, unknownLength: 0 }, other: { responses: 0, declaredBytes: 0, unknownLength: 0 } };
  function middleware(req, res, next) {
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutation) readGeneration++;
    req.lookupReadGeneration = readGeneration;
    let bytes = 0;
    let jsonBytes = 0;
    const originalWrite = res.write;
    const originalEnd = res.end;
    const originalSend = res.send;
    const bodyAllowed = () => req.method !== 'HEAD' && res.statusCode !== 204 && res.statusCode !== 304;
    res.write = function (chunk, encoding, callback) {
      if (bodyAllowed()) bytes += chunkBytes(chunk, encoding);
      return originalWrite.call(this, chunk, encoding, callback);
    };
    res.end = function (chunk, encoding, callback) {
      if (bodyAllowed()) bytes += chunkBytes(chunk, encoding);
      return originalEnd.call(this, chunk, encoding, callback);
    };
    res.send = function (body) {
      if (!String(res.getHeader('Content-Type') || '').startsWith('application/json')) return originalSend.call(this, body);
      jsonBytes = chunkBytes(body);
      if (canCompressJson(req)) {
        res.vary('Accept-Encoding');
        if (req.headers['x-lookup-token']) res.vary('X-Lookup-Token');
        if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'private, no-cache');
      }
      if (!canCompressJson(req) || res.statusCode !== 200 || jsonBytes < 1024 || jsonBytes > 16 * 1024 * 1024 ||
          res.getHeader('Content-Encoding') || /\bno-transform\b/i.test(String(res.getHeader('Cache-Control') || '')) ||
          req.acceptsEncodings('gzip') !== 'gzip') return originalSend.call(this, body);
      gzip(body, { level: 1 }, (error, compressed) => {
        if (res.destroyed || res.writableEnded) return;
        if (error || compressed.length >= jsonBytes) return originalSend.call(res, body);
        res.setHeader('Content-Encoding', 'gzip');
        // Express still handles ETags, conditional requests, and Content-Length.
        originalSend.call(res, compressed);
      });
      return res;
    };
    let recorded = false;
    const record = (aborted) => {
      if (recorded) return;
      recorded = true;
      // A read after a write must not join work started before/during that write.
      if (mutation) readGeneration++;
      // Route templates only. Never retain URLs, query strings, headers, IDs,
      // IP addresses, bodies, or authorization fingerprints in diagnostics.
      const route = req.route?.path;
      const template = typeof route === 'string' ? route : Array.isArray(route) ? route.join('|') : 'unmatched';
      const prefix = req.baseUrl === '/api/v1/portal' ? req.baseUrl : '';
      let key = `${req.method} ${prefix}${template} ${Math.floor(res.statusCode / 100)}xx`;
      if (!routes.has(key) && routes.size >= maxRoutes) key = 'overflow';
      const row = routes.get(key) || { responses: 0, bodyBytes: 0, jsonBytes: 0, aborted: 0 };
      row.responses++; row.bodyBytes += bytes; row.jsonBytes += jsonBytes; row.aborted += Number(aborted);
      routes.set(key, row);
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(!res.writableFinished));
    next();
  }
  return {
    middleware,
    recordUpstream(response, source = 'graph') {
      const row = upstream[source === 'graph' ? 'graph' : 'other'];
      row.responses++;
      const header = response.headers.get('content-length');
      const length = header === null ? NaN : Number(header);
      if (Number.isSafeInteger(length) && length >= 0) row.declaredBytes += length;
      else row.unknownLength++;
    },
    snapshot() {
      return { outbound: Object.fromEntries([...routes].map(([key, row]) => [key, { ...row }])),
        upstream: { graph: { ...upstream.graph }, other: { ...upstream.other } } };
    }
  };
}

// Wrap AFTER authentication and BEFORE the workload queue. Share only in-flight
// GETs with identical lookup authorization and complete query; never retain a
// snapshot after the handler settles, so writes and force refreshes stay fresh.
function coalesceLookupJson(handler, { maxPending = 100 } = {}) {
  const pending = new Map();
  return async (req, res, next) => {
    if (req.method !== 'GET') return handler(req, res, next);
    const scope = createHash('sha256').update(String(req.headers['x-lookup-token'] || req.headers.authorization || '')).digest('hex');
    const key = `${req.lookupReadGeneration || 0}:${scope}:${req.originalUrl}`;
    const existing = pending.get(key);
    if (existing) {
      const result = await existing;
      if (req.aborted || res.destroyed) return;
      res.setHeader('X-Kole-Coalesced', '1');
      if (result) return res.status(result.status).json(result.body);
      return res.status(503).json({ success: false, error: 'Dashboard refresh was interrupted. Please try again.' });
    }
    if (pending.size >= maxPending) return handler(req, res, next);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pending.set(key, promise);
    const originalJson = res.json;
    let result;
    res.json = function (body) {
      result = { status: res.statusCode, body };
      return originalJson.call(this, body);
    };
    try { return await handler(req, res, next); }
    finally {
      res.json = originalJson;
      pending.delete(key);
      resolve(result);
    }
  };
}

module.exports = { createTransferMonitor, coalesceLookupJson };
