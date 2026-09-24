'use strict';

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
  class MemoryBoundMap extends Map {
    constructor() { super(); this.budgetEntries = new Map(); }
    set(key, value) {
      this.delete(key);
      const bytes = estimateRetainedBytes(value, Math.min(maxEntryBytes, maxBytes));
      if (bytes > maxEntryBytes || bytes > maxBytes) { skippedEntries++; return this; }
      while (retainedBytes + bytes > maxBytes && entries.size) {
        const oldest = entries.keys().next().value;
        oldest.owner.delete(oldest.key);
        evictions++;
      }
      const entry = { owner: this, key, bytes, cachedAt: Date.now() };
      this.budgetEntries.set(key, entry);
      entries.set(entry, true);
      retainedBytes += bytes;
      return super.set(key, value);
    }
    get(key) {
      const entry = this.budgetEntries.get(key);
      if (entry) { entries.delete(entry); entries.set(entry, true); }
      return super.get(key);
    }
    delete(key) {
      const entry = this.budgetEntries.get(key);
      if (entry) { retainedBytes -= entry.bytes; entries.delete(entry); this.budgetEntries.delete(key); }
      return super.delete(key);
    }
    clear() { for (const key of this.keys()) this.delete(key); }
  }
  return {
    createCache: () => new MemoryBoundMap(),
    sweep: () => {
      for (const entry of entries.keys()) {
        if (Date.now() - entry.cachedAt > maxAgeMs) entry.owner.delete(entry.key);
      }
    },
    diagnostics: () => ({ estimatedBytes: retainedBytes, maxBytes, maxEntryBytes, entries: entries.size, evictions, skippedEntries })
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
