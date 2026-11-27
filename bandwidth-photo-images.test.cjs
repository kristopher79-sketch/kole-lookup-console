'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function loadTs(relativePath, dependencies, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(name in dependencies, `Unexpected module ${name}`); return dependencies[name];
  }, AbortController, DOMException, ...globals });
  return module.exports;
}
function imageHarness({ observerAvailable = true } = {}) {
  let effect; let observer; let calls = 0; let updates = 0; let resolve;
  const promise = new Promise(done => { resolve = done; });
  const observers = observerAvailable ? { IntersectionObserver: class {
    constructor(callback, options) { this.callback = callback; this.options = options; observer = this; }
    observe() {} disconnect() { this.disconnected = true; }
  } } : {};
  const { LibraryImage } = loadTs('src/components/LibraryImage.tsx', {
    react: { useEffect: fn => { effect = fn; }, useRef: () => ({ current: {} }),
      useState: value => [value, () => { updates++; }] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../services': { galleryService: { loadImage: () => { calls++; return promise; } } },
    './Icons': { Icon: () => null }
  }, observers);
  return {
    mount(props) { LibraryImage(props); return effect(); },
    intersect(value) { observer.callback([{ isIntersecting: value }]); },
    resolve, get calls() { return calls; }, get updates() { return updates; }, get observer() { return observer; }
  };
}

test('lazy authenticated images wait until near the viewport and download only once', async () => {
  const harness = imageHarness();
  const cleanup = harness.mount({ source: '/synthetic/thumbnail?v=1', alt: 'Example' });
  assert.equal(harness.calls, 0);
  assert.equal(harness.observer.options.rootMargin, '240px');
  harness.intersect(false); assert.equal(harness.calls, 0);
  harness.intersect(true); harness.intersect(true); assert.equal(harness.calls, 1);
  assert.equal(harness.observer.disconnected, true);
  cleanup();
  const updates = harness.updates;
  harness.resolve('blob:synthetic'); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.updates, updates, 'unmounted fetch must not update the image');
});

test('eager lightboxes and browsers without IntersectionObserver still download immediately', () => {
  for (const options of [{ loading: 'eager', observerAvailable: true }, { loading: 'lazy', observerAvailable: false }]) {
    const harness = imageHarness(options);
    const cleanup = harness.mount({ source: '/synthetic/content?v=1', alt: 'Example', loading: options.loading });
    assert.equal(harness.calls, 1); cleanup();
  }
});

test('unmounted offscreen images never enter the download queue', () => {
  const harness = imageHarness();
  const cleanup = harness.mount({ source: '/synthetic/thumbnail', alt: 'Example' });
  cleanup(); harness.intersect(true);
  assert.equal(harness.calls, 0);
});

test('queued image requests reuse a newly cached image and cancelled requests never take a slot', async () => {
  let fetches = 0;
  const { MicrosoftGalleryService } = loadTs('src/services/microsoftGalleryService.ts', {
    './galleryService': { GalleryServiceError: class extends Error {} }
  }, { fetch: async () => { fetches++; throw Error('Unexpected download'); }, URL });
  const service = new MicrosoftGalleryService({ apiBaseUrl: 'https://synthetic.invalid' });
  service.accessToken = 'synthetic-only';
  for (let index = 0; index < 5; index++) await service.acquireImageSlot();
  const pending = service.loadImage('/thumbnail?v=1');
  service.imageCache.set('https://synthetic.invalid/thumbnail?v=1', 'blob:already-loaded');
  service.releaseImageSlot();
  assert.equal(await pending, 'blob:already-loaded'); assert.equal(fetches, 0);
  const controller = new AbortController(); controller.abort();
  const before = service.activeImageRequests;
  await assert.rejects(service.loadImage('/other', controller.signal), error => error.name === 'AbortError');
  assert.equal(service.activeImageRequests, before);
});

test('photo revisions change private cache URLs while keeping original content and stable photo IDs', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/photo-library-service.cjs'), 'utf8');
  const start = source.indexOf('  function mapPhoto(');
  const code = source.slice(start, source.indexOf('\n  }', start) + 4);
  const context = vm.createContext({ crypto, cleanText: value => String(value || ''),
    registerPhotoReference: () => 'stable-id' });
  vm.runInContext(code, context);
  const shipment = { id: 'synthetic', engineName: 'Example', pickupDate: '2026-11-27' };
  const first = context.mapPhoto({}, shipment, { lastModifiedDateTime: '2026-11-27T12:00:00Z' }, 'pickup', 'key', false);
  const next = context.mapPhoto({}, shipment, { lastModifiedDateTime: '2026-11-27T13:00:00Z' }, 'pickup', 'key', false);
  assert.equal(first.id, next.id);
  assert.match(first.thumbnailUrl, /^\/api\/photo-library\/photos\/stable-id\/thumbnail\?v=[a-f0-9]{24}$/);
  assert.match(first.fullUrl, /\/content\?v=/);
  assert.notEqual(first.fullUrl, next.fullUrl);
});
