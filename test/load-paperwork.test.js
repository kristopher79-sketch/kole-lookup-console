const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanLoadPaperworkFiles,
  findLoadPaperworkLoadFolder,
  findLoadPaperworkTmsFolder,
  getUniqueLoadPaperworkFileName,
  sanitizeLoadPaperworkFileName
} = require('../load-paperwork');

test('finds only the matching TMS folder', () => {
  const folders = [
    { id: '1', name: 'Acme Dispatch', folder: {} },
    { id: '2', name: 'Other TMS', folder: {} }
  ];

  assert.equal(findLoadPaperworkTmsFolder(folders, 'ACME  Dispatch')?.id, '1');
  assert.equal(findLoadPaperworkTmsFolder(folders, 'Missing TMS'), null);
});

test('prefers the exact BOL, driver, and route folder for an order', () => {
  const folders = [
    { id: 'first', name: 'D197963 - Dana Driver - Albany to Boston', folder: {} },
    { id: 'second', name: 'D197964 - Dana Driver - Boston to Albany', folder: {} }
  ];

  const result = findLoadPaperworkLoadFolder(folders, {
    BOL: 'D197963',
    Driver: 'Dana Driver',
    Route: 'Albany to Boston'
  });

  assert.equal(result.folder?.id, 'first');
  assert.equal(result.matchStrategy, 'exact-order-folder');
});

test('does not confuse a BOL with a longer BOL prefix', () => {
  const folders = [
    { id: 'longer', name: 'D1979630 - Dana Driver - Albany to Boston', folder: {} }
  ];

  const result = findLoadPaperworkLoadFolder(folders, { BOL: 'D197963' });
  assert.equal(result.folder, null);
  assert.equal(result.ambiguous, false);
});

test('refuses an ambiguous duplicate BOL folder', () => {
  const folders = [
    { id: 'a', name: 'D197963 - Driver A - Route A', folder: {} },
    { id: 'b', name: 'D197963 - Driver B - Route B', folder: {} }
  ];

  const result = findLoadPaperworkLoadFolder(folders, { BOL: 'D197963' });
  assert.equal(result.folder, null);
  assert.equal(result.ambiguous, true);
});

test('sanitizes OneDrive filenames while retaining the validated extension', () => {
  assert.equal(
    sanitizeLoadPaperworkFileName('Customer: BOL #42?.PDF', '.pdf'),
    'Customer- BOL -42-.pdf'
  );
  assert.equal(sanitizeLoadPaperworkFileName('CON.pdf', '.pdf'), 'file-CON.pdf');
  assert.equal(sanitizeLoadPaperworkFileName('..\\..\\instructions.exe', '.pdf'), 'instructions.pdf');
});

test('adds a non-destructive suffix for duplicate filenames', () => {
  const existing = new Set(['customer bol.pdf', 'CUSTOMER BOL (2).PDF']);
  assert.equal(
    getUniqueLoadPaperworkFileName('Customer BOL.pdf', existing),
    'Customer BOL (3).pdf'
  );
});

test('returns files only and keeps a dispatch sheet at the top', () => {
  const files = cleanLoadPaperworkFiles([
    {
      id: 'customer',
      name: 'Customer BOL.pdf',
      size: 120,
      file: { mimeType: 'application/pdf' },
      lastModifiedDateTime: '2026-09-02T13:00:00Z'
    },
    { id: 'folder', name: 'Nested', folder: {} },
    {
      id: 'dispatch',
      name: 'Dispatch Sheet D197963.pdf',
      size: 240,
      file: { mimeType: 'application/pdf' },
      lastModifiedDateTime: '2026-09-01T13:00:00Z'
    }
  ]);

  assert.deepEqual(files.map((file) => file.id), ['dispatch', 'customer']);
  assert.equal(files[0].isDispatchSheet, true);
});
