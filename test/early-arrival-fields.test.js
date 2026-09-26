'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMobileCheckinError, cleanMobileStopEventItem, toMobileStopEventResponse } = require('../mobile-checkin');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const context = { createMobileCheckinError };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function getCheckInTimesWriteValue('), source.indexOf('async function createCheckInTimesEvent(')), context);

test('SharePoint Yes/No writes and reads preserve both boolean values', () => {
  const schema = { columns: { earlyArrival: { boolean: {} } }, fieldNames: { earlyArrival: 'EarlyArrival' } };
  for (const value of [true, false]) {
    const fields = context.buildCheckInTimesFields(schema, { earlyArrival: value });
    assert.equal(fields.EarlyArrival, value);
    assert.equal(Object.keys(fields).length, 1);
    const event = cleanMobileStopEventItem({ fields }, schema.fieldNames);
    assert.equal(toMobileStopEventResponse(event).earlyArrival, value);
  }
});

test('unavailable or incompatible override column prevents unlogged early check-in', () => {
  for (const column of [undefined, { text: {} }, { boolean: {}, readOnly: true }]) {
    const schema = { columns: { earlyArrival: column }, fieldNames: {} };
    assert.throws(() => context.buildCheckInTimesFields(schema, { earlyArrival: true }), { code: 'EARLY_ARRIVAL_UNAVAILABLE' });
    assert.equal(Object.keys(context.buildCheckInTimesFields(schema, { earlyArrival: false })).length, 0);
  }
});
