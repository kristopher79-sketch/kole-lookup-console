const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyFreight,
  decodeCursor,
  encodePhotoKey,
  encodeCursor,
  findOverrideColumn,
  findSuppressionColumn,
  normalizeEngineName
} = require('../photo-library-service');

test('verifies the live suppression column only when it is a single boolean field', () => {
  const verified = findSuppressionColumn([
    { name: 'SuppressSample', displayName: 'SuppressSample', boolean: {}, required: false }
  ]);
  assert.equal(verified.verified, true);
  assert.equal(verified.internalName, 'SuppressSample');

  assert.equal(findSuppressionColumn([]).code, 'SUPPRESSION_COLUMN_MISSING');
  assert.equal(findSuppressionColumn([{ name: 'suppresssample', text: {} }]).code, 'SUPPRESSION_COLUMN_NOT_BOOLEAN');
});

test('verifies writable override fields without confusing SharePoint title aliases', () => {
  const title = findOverrideColumn([
    { name: 'Title', displayName: 'Title', text: {}, readOnly: false, hidden: false },
    { name: 'LinkTitle', displayName: 'Title', readOnly: true, hidden: false }
  ], 'Title', 'text');
  const hidden = findOverrideColumn([
    { name: 'Hidden', displayName: 'Hidden', boolean: {}, readOnly: false, hidden: false }
  ], 'Hidden', 'boolean');
  assert.equal(title.verified, true);
  assert.equal(title.internalName, 'Title');
  assert.equal(hidden.verified, true);
  assert.equal(findOverrideColumn([{ name: 'Hidden', text: {} }], 'Hidden', 'boolean').verified, false);
});

test('derives a stable canonical photo key from OneDrive identity', () => {
  const first = encodePhotoKey('drive-one', 'item-one');
  assert.equal(first, encodePhotoKey('drive-one', 'item-one'));
  assert.notEqual(first, encodePhotoKey('drive-one', 'item-two'));
  assert.match(first, /^od1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
});

test('normalizes historical engine spelling without turning unknown values into models', () => {
  assert.deepEqual(normalizeEngineName(' CFM 56 '), {
    key: 'cfm56',
    display: 'CFM56',
    source: 'CFM 56'
  });
  assert.equal(normalizeEngineName('NA'), null);
  assert.equal(normalizeEngineName(' Unknown '), null);
});

test('classifies freight while preserving a separate dynamic engine identity', () => {
  assert.equal(classifyFreight({ Freight: 'Engine Stand' }, null), 'engine-stands');
  assert.equal(classifyFreight({ Freight: 'Aircraft Component' }, null), 'aircraft-parts');
  assert.equal(classifyFreight({ Freight: 'Specialized Machinery' }, normalizeEngineName('PW1100')), 'aircraft-engines');
  assert.equal(classifyFreight({ Freight: 'Specialized Machinery' }, null), 'general-freight');
});

test('round trips opaque pagination offsets and rejects malformed cursors', () => {
  assert.equal(decodeCursor(encodeCursor(42)), 42);
  assert.throws(() => decodeCursor('not-a-cursor'), /cursor is invalid/i);
});

