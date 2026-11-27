'use strict';

const { serialize, deserialize } = require('node:v8');
const { deflateSync, inflateSync } = require('node:zlib');

// Conservative retained-size estimate, not a measurement of V8 heap or RSS.
// Walk without JSON serialization, which would allocate another large copy.
function estimateRetainedBytes(value, limit = Infinity) {
  const seen = new WeakSet();
  let bytes = 0;
  function visit(item, depth) {
    if (bytes > limit) return;
    if (item === null || item === undefined) { bytes += 8; return; }
    if (typeof item === 'string') { bytes += 32 + item.length * 2; return; }
    if (typeof item !== 'object') { bytes += 16; return; }
    if (seen.has(item)) return;
    if (depth > 64) { bytes = Infinity; return; }
    seen.add(item);
    bytes += 64;
    if (ArrayBuffer.isView(item)) { bytes += item.byteLength; return; }
    if (item instanceof ArrayBuffer) { bytes += item.byteLength; return; }
    if (item instanceof Map || item instanceof Set) {
      for (const entry of item) {
        bytes += 48;
        if (item instanceof Map) { visit(entry[0], depth + 1); visit(entry[1], depth + 1); }
        else visit(entry, depth + 1);
        if (bytes > limit) break;
      }
    } else {
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        bytes += 24 + key.length * 2;
        visit(item[key], depth + 1);
        if (bytes > limit) break;
      }
    }
  }
  visit(value, 0);
  return bytes;
}

function createMemoryCacheBudget({ maxBytes, maxEntryBytes, maxAgeMs = 10 * 60 * 1000 }) {
  const entries = new Map();
  let retainedBytes = 0;
  let evictions = 0;
  let skippedEntries = 0;
  const cacheStats = new Map();
  class MemoryBoundMap extends Map {
    constructor({ name = 'other', compactOversized = false } = {}) {
      super(); this.budgetEntries = new Map(); this.compactOversized = compactOversized; this.revision = 0;
      if (!cacheStats.has(name)) cacheStats.set(name, { compacted: 0, skippedSize: 0, skippedEncoding: 0, skippedInputLimit: 0 });
      this.stats = cacheStats.get(name);
    }
    set(key, value) {
      this.removeEntry(key);
      let bytes = estimateRetainedBytes(value, Math.min(maxEntryBytes, maxBytes));
      let stored = value;
      let compacted = false;
      if (bytes > maxEntryBytes || bytes > maxBytes) {
        let skipReason = 'skippedSize';
        // Bound temporary encoding work as well as retained memory. V8 encoding
        // preserves undefined, dates, Maps, Sets, and cycles without JSON loss.
        if (this.compactOversized && estimateRetainedBytes(value, 64 * 1024 * 1024) <= 64 * 1024 * 1024) {
          try {
            const encoded = serialize(value);
            if (encoded.length <= 16 * 1024 * 1024) {
              const compressed = deflateSync(encoded, { level: 1 });
              // Avoid retaining zlib's larger backing slab for a small result.
              const data = Buffer.allocUnsafeSlow(compressed.length);
              compressed.copy(data);
              stored = { data, length: encoded.length };
              bytes = estimateRetainedBytes(stored);
              compacted = true;
            } else skipReason = 'skippedInputLimit';
          } catch {
            skipReason = 'skippedEncoding';
          }
        } else if (this.compactOversized) skipReason = 'skippedInputLimit';
        if (bytes > maxEntryBytes || bytes > maxBytes) {
          skippedEntries++; this.stats[skipReason]++; return this;
        }
      }
      while (retainedBytes + bytes > maxBytes && entries.size) {
        const oldest = entries.keys().next().value;
        oldest.owner.delete(oldest.key);
        evictions++;
      }
      const entry = { owner: this, key, bytes, compacted, cachedAt: Date.now(), recordCachedAt: value?.cachedAt, empty: !value };
      this.budgetEntries.set(key, entry);
      entries.set(entry, true);
      retainedBytes += bytes;
      if (compacted) this.stats.compacted++;
      return super.set(key, stored);
    }
    get(key) {
      const entry = this.budgetEntries.get(key);
      if (entry) { entries.delete(entry); entries.set(entry, true); }
      const stored = super.get(key);
      return entry?.compacted ? deserialize(inflateSync(stored.data, { maxOutputLength: stored.length })) : stored;
    }
    *entries() { for (const key of this.keys()) yield [key, this.get(key)]; }
    *values() { for (const key of this.keys()) yield this.get(key); }
    [Symbol.iterator]() { return this.entries(); }
    forEach(callback, thisArg) { for (const [key, value] of this) callback.call(thisArg, value, key, this); }
    sweepExpired(ttlMs) {
      const now = Date.now();
      for (const [key, entry] of this.budgetEntries) {
        if (entry.empty || now - entry.recordCachedAt > ttlMs) this.delete(key);
      }
    }
    removeEntry(key) {
      const entry = this.budgetEntries.get(key);
      if (entry) { retainedBytes -= entry.bytes; entries.delete(entry); this.budgetEntries.delete(key); }
      return super.delete(key);
    }
    delete(key) { this.revision++; return this.removeEntry(key); }
    clear() { this.revision++; for (const key of this.keys()) this.removeEntry(key); }
  }
  return {
    createCache: (options) => new MemoryBoundMap(options),
    sweep: () => {
      for (const entry of entries.keys()) {
        if (Date.now() - entry.cachedAt > maxAgeMs) entry.owner.delete(entry.key);
      }
    },
    diagnostics: () => ({ estimatedBytes: retainedBytes, maxBytes, maxEntryBytes, entries: entries.size, evictions, skippedEntries,
      caches: Object.fromEntries([...cacheStats].map(([name, stats]) => [name, { ...stats }])) })
  };
}

// A closed socket does not cancel an async handler. Keep its slot until its
// work settles; on success also wait for the response buffer to finish/close.
async function runWithWorkloadSlot(handler, req, res, release) {
  let handlerDone = false;
  let responseDone = res.destroyed || res.writableFinished;
  let released = false;
  const finish = () => {
    if (released || !handlerDone || !responseDone) return;
    released = true;
    res.removeListener('finish', onResponseDone);
    res.removeListener('close', onResponseDone);
    release();
  };
  const onResponseDone = () => { responseDone = true; finish(); };
  res.once('finish', onResponseDone);
  res.once('close', onResponseDone);
  try {
    return await handler(req, res);
  } catch (error) {
    // Express owns error handling after this promise rejects.
    responseDone = true;
    throw error;
  } finally {
    handlerDone = true;
    responseDone ||= res.destroyed || res.writableFinished;
    finish();
  }
}

async function mapSequentialSettled(values, work) {
  const results = [];
  for (let index = 0; index < values.length; index++) {
    try { results.push({ status: 'fulfilled', value: await work(values[index], index) }); }
    catch (reason) { results.push({ status: 'rejected', reason }); }
  }
  return results;
}

module.exports = { estimateRetainedBytes, createMemoryCacheBudget, runWithWorkloadSlot, mapSequentialSettled };
