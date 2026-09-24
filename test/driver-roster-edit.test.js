const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DRIVER_ROSTER_EDIT_FIELDS, buildDriverRosterEditSchema, buildDriverRosterEditPatch, driverRosterEditError } = require('../driver-roster-edit');

function columns() {
  return DRIVER_ROSTER_EDIT_FIELDS.map((field) => ({ name: field.field,
    ...(field.kind === 'date' ? { dateTime: { format: 'dateOnly' } }
      : ['number', 'integer'].includes(field.kind) || field.key === 'trailerYear' ? { number: {} } : { text: { maxLength: 255 } })
  }));
}
const initialFields = { Trucks: '101', Status: 'Active', TMSName: 'Synthetic Driver', TermDate: '', EmptyWeight: 10 };

test('patch contains only supplied allowed fields, preserving zero, clearing and omitted values', () => {
  const patch = buildDriverRosterEditPatch({ cellPhone1: '', emptyWeight: 0, steerAxleWeight: null }, columns(), initialFields);
  assert.deepEqual(patch, { CellPhone1: '', EmptyWeight: 0, SteerAxleWeight: null });
  assert.equal(Object.hasOwn(patch, 'Trucks'), false);
  assert.deepEqual(buildDriverRosterEditPatch({}, columns(), initialFields), {});
  for (const key of ['pin', 'status', 'termDate', 'OrdersTaggedforInactive', 'Title']) {
    assert.throws(() => buildDriverRosterEditPatch({ [key]: 'changed' }, columns(), initialFields), /cannot be edited/);
  }
});

test('live required, read-only, missing, incompatible and choice metadata are enforced', () => {
  const schema = columns();
  Object.assign(schema.find((field) => field.name === 'TMSName'), { required: true });
  Object.assign(schema.find((field) => field.name === 'TractorVIN'), { readOnly: true });
  schema.splice(schema.findIndex((field) => field.name === 'TractorMake'), 1);
  schema.find((field) => field.name === 'DriverType').text = undefined;
  schema.find((field) => field.name === 'DriverType').choice = { choices: ['Owner', 'Company'], displayAs: 'dropDownMenu' };
  assert.throws(() => buildDriverRosterEditPatch({ tmsName: '' }, schema, initialFields), /required/);
  assert.throws(() => buildDriverRosterEditPatch({ tractorVin: '123' }, schema, initialFields), /read-only/);
  assert.throws(() => buildDriverRosterEditPatch({ tractorMake: 'Make' }, schema, initialFields), /unavailable/);
  assert.throws(() => buildDriverRosterEditPatch({ driverType: 'Unapproved' }, schema, initialFields), /approved choice/);
  assert.equal(buildDriverRosterEditPatch({ driverType: 'Owner' }, schema, initialFields).DriverType, 'Owner');
  assert.ok(buildDriverRosterEditSchema(schema).find((field) => field.key === 'tractorVin').disabledReason);
});

test('numeric ranges, integer axles, emails and unit lengths are checked without truncation', () => {
  const schema = columns(); schema.find((field) => field.name === 'EmptyWeight').number = { minimum: 0, maximum: 100000, decimalPlaces: 'none' };
  assert.equal(buildDriverRosterEditPatch({ emptyWeight: '12,345.5' }, schema, initialFields).EmptyWeight, 12345.5);
  for (const changes of [{ emptyWeight: '-1' }, { emptyWeight: '100001' }, { emptyWeight: '1,23' }, { tractorAxles: '2.5' }, { emailAddress1: 'bad' }, { truck: 'x'.repeat(18) }, { truck: '' }, { trailerYear: 'Infinity' }]) {
    assert.throws(() => buildDriverRosterEditPatch(changes, schema, initialFields));
  }
});

test('calendar dates preserve date-only values and cannot start after termination', () => {
  assert.equal(buildDriverRosterEditPatch({ startDate: '2024-02-29' }, columns(), initialFields).StartDate, '2024-02-29');
  assert.throws(() => buildDriverRosterEditPatch({ startDate: '2025-02-29' }, columns(), initialFields), /valid calendar/);
  assert.throws(() => buildDriverRosterEditPatch({ startDate: '2026-09-25' }, columns(), { ...initialFields, TermDate: '2026-09-24' }), /termination/);
  assert.equal(buildDriverRosterEditPatch({ startDate: '' }, columns(), initialFields).StartDate, null);
});

test('function uses approved existing values and driver identity cannot be erased', () => {
  assert.throws(() => buildDriverRosterEditPatch({ soloOrTeam: 'Unknown' }, columns(), initialFields), /approved choice/);
  assert.equal(buildDriverRosterEditPatch({ soloOrTeam: 'Absentee - Team' }, columns(), initialFields).SoloorTeam, 'Absentee - Team');
  assert.throws(() => buildDriverRosterEditPatch({ tmsName: '', operatorTeamName: '' }, columns(), initialFields), /required/);
});

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function setup(overrides = {}) {
  let writes = 0; let invalidations = 0; let payload; let headers;
  let item = { id: '1', eTag: '"v1"', fields: { ...initialFields } };
  const context = vm.createContext({
    app: { patch(_path, _auth, handler) { context.handler = handler; } }, requireLookupAccess: () => {},
    getGraphToken: async () => 'synthetic', assertDriverRosterConfig: () => ({ siteId: 'synthetic', listId: 'roster' }),
    getDriverRosterItemById: async () => item, getAllQuoteEngineColumns: async () => columns(),
    buildDriverRosterEditPatch, driverRosterEditError,
    graphGet: async () => ({ value: [] }),
    graphPatch: async (_token, _url, body, extraHeaders) => { writes++; payload = body; headers = extraHeaders; item = { ...item, eTag: '"v2"', fields: { ...item.fields, ...body } }; },
    clearDriverRosterMutationCaches: () => invalidations++,
    buildFleetEquipmentReportResponse: (rows) => ({ rows }), buildAvailableTruckRosterOptions: () => [],
    normalizeText: (value) => String(value || '').trim().toLowerCase(),
    ...overrides
  });
  const names = ['getDriverRosterEditItemId', 'getDriverRosterEditETag', 'assertDriverRosterTruckAvailable', 'normalizeTruckKey', 'cleanPhoneText', 'cleanRosterText', 'cleanDriverRosterItem'];
  const functions = names.map((name) => { const start = source.search(new RegExp(`(?:async )?function ${name}\\(`)); return source.slice(start, source.indexOf('\n}', start) + 2); }).join('\n');
  const start = source.indexOf("app.patch('/driver-roster/:itemId',");
  vm.runInContext(`const LIST_READ_PAGE_SIZE=200; const inFlightDriverRosterEdits=new Set(); const inFlightDriverRosterTruckEdits=new Set(); ${functions}\n${source.slice(start, source.indexOf('\n});', start) + 4)}`, context);
  return { context, get writes() { return writes; }, get invalidations() { return invalidations; }, get payload() { return payload; }, get headers() { return headers; } };
}
async function save(env, changes, etag = '"v1"') {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  await env.context.handler({ params: { itemId: '1' }, body: { etag, changes } }, res);
  return res;
}

test('save writes once with If-Match and returns normalized values after invalidating caches', async () => {
  const env = setup(); const res = await save(env, { cellPhone1: '555 0100' });
  assert.equal(res.statusCode, 200); assert.equal(env.writes, 1); assert.equal(env.invalidations, 1);
  assert.deepEqual(env.payload, { CellPhone1: '555 0100' }); assert.equal(env.headers['If-Match'], '"v1"');
  assert.equal(res.data.roster.cellPhone1, '5550100');
});

test('stale versions and wildcard versions never write', async () => {
  const env = setup(); const conflict = await save(env, { tmsName: 'Edited' }, '"old"');
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.data.requiresReload, true); assert.equal(env.writes, 0);
  const wildcard = await save(env, { tmsName: 'Edited' }, '*'); assert.equal(wildcard.statusCode, 400); assert.equal(env.writes, 0);
});

test('truck reassignment checks all pages and rejects another active driver', async () => {
  let calls = 0;
  const env = setup({ graphGet: async () => ++calls === 1 ? { value: [], '@odata.nextLink': 'opaque-next' }
    : { value: [{ id: '2', fields: { Trucks: '0102', Status: 'Active' } }] } });
  const res = await save(env, { truck: '102' }); assert.equal(res.statusCode, 409); assert.equal(env.writes, 0); assert.equal(calls, 2);
});

test('unknown save outcome blocks blind retry without exposing upstream errors', async () => {
  let attempts = 0;
  const env = setup({ graphPatch: async () => { attempts++; throw Error('synthetic private upstream content'); } });
  const res = await save(env, { emptyWeight: 0 });
  assert.equal(res.statusCode, 502); assert.equal(res.data.requiresReload, true); assert.equal(attempts, 1); assert.equal(env.invalidations, 1);
  assert.doesNotMatch(JSON.stringify(res.data), /private upstream/);
});

test('confirmed save remains successful if follow-up read fails', async () => {
  let reads = 0;
  const env = setup({ getDriverRosterItemById: async () => { if (++reads > 1) throw Error('unavailable'); return { id: '1', eTag: '"v1"', fields: initialFields }; } });
  const res = await save(env, { emptyWeight: 0 });
  assert.equal(env.writes, 1); assert.equal(res.data.success, true); assert.equal(res.data.roster.emptyWeight, 0); assert.ok(res.data.warning);
});

test('simultaneous submissions for a driver are rejected until the first save completes', async () => {
  let release; let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const env = setup({ graphPatch: async () => { entered(); await new Promise((resolve) => { release = resolve; }); } });
  const first = save(env, { cellPhone1: '555' }); await started;
  const second = await save(env, { cellPhone1: '666' }); assert.equal(second.statusCode, 409);
  release(); assert.equal((await first).statusCode, 200);
});
