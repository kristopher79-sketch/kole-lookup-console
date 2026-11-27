'use strict';

// Synthetic only: no environment loading, server startup, or network access.
const { gzipSync } = require('node:zlib');
const { performance } = require('node:perf_hooks');
const { createMemoryCacheBudget, estimateRetainedBytes } = require('../server-memory');

const rows = Array.from({ length: 16000 }, (_, id) => ({
  id: String(id), fields: {
    BidID: `DEMO-${id}`, Company: `Example ${id % 100}`,
    Shipment_Origin: `Example origin ${id % 120}`, Shipment_Destination: `Example destination ${id % 150}`,
    PickupDate: '2026-11-27', Status: id % 3 ? 'Won' : 'Bid',
    Notes: 'Synthetic record used only for bandwidth measurements.'
  }
}));
const payload = { success: true, rows };
const budget = createMemoryCacheBudget({ maxBytes: 32 * 1024 * 1024, maxEntryBytes: 8 * 1024 * 1024 });
const cache = budget.createCache({ name: 'synthetic', compactOversized: true });
const legacy = createMemoryCacheBudget({ maxBytes: 32 * 1024 * 1024, maxEntryBytes: 8 * 1024 * 1024 }).createCache();
legacy.set('data', payload);
const started = performance.now();
cache.set('data', payload);
const encodeMs = performance.now() - started;
const beforeRead = performance.now();
const restored = cache.get('data');
const decodeMs = performance.now() - beforeRead;
const json = Buffer.from(JSON.stringify(payload));
const gzip = gzipSync(json, { level: 1 });
console.log(JSON.stringify({
  syntheticOnly: true, rows: rows.length, jsonBytes: json.length, gzipBytes: gzip.length,
  reductionPercent: Number((100 * (1 - gzip.length / json.length)).toFixed(1)),
  estimatedObjectBytes: estimateRetainedBytes(payload), legacyCacheAdmitted: legacy.has('data'),
  compactCacheAdmitted: cache.has('data'), retainedCacheBytes: budget.diagnostics().estimatedBytes,
  encodeMs: Number(encodeMs.toFixed(1)), decodeMs: Number(decodeMs.toFixed(1)), restoredRows: restored.rows.length
}, null, 2));
