const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../client/client/src/App.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../client/client/src/App.css'), 'utf8');

function extractFunction(name) {
  const start = serverSource.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) throw new Error(`Unable to find ${name}.`);
  return serverSource.slice(start, serverSource.indexOf('\n}', start) + 2);
}

function createContext(graphGet = async () => ({ value: [] })) {
  const context = vm.createContext({
    process: { env: { SITE_ID: 'synthetic-site' } },
    URLSearchParams,
    DEFAULT_OPERATOR_RATE_TEXTS_LIST_ID: 'operator-rate-list',
    LIST_READ_PAGE_SIZE: 200,
    graphGet,
    normalizeBolKey: (value) => String(value || '').trim().toUpperCase()
  });
  const functions = [
    'escapeODataString',
    'getOperatorRateTextsListId',
    'cleanOperatorRateTextValue',
    'cleanOperatorRateTextRecord',
    'compareOperatorRateTextsNewestFirst',
    'getOperatorRateConfirmationsForBol'
  ].map(extractFunction).join('\n');
  vm.runInContext(functions, context);
  return context;
}

test('record cleaning preserves multiline SMS, amounts, statuses, and optional phone values', () => {
  const context = createContext();
  const rateText = 'Rate: $1,250.00\nDetention: $75 after 2 hours\n  Keep this spacing.';
  const record = context.cleanOperatorRateTextRecord({
    id: '42',
    fields: {
      BOLNumber: 'KOL0007',
      DriverName: 'Synthetic Operator',
      RateText: rateText,
      Phone1: 5550101234,
      Phone2: null,
      DateSent: '2026-10-08T07:00:00Z',
      SendStatus: 'Partially successful'
    }
  });

  assert.equal(record.bolNumber, 'KOL0007');
  assert.equal(record.rateText, rateText);
  assert.equal(record.phone1, '5550101234');
  assert.equal(record.phone2, '');
  assert.equal(record.sendStatus, 'Partially successful');
});

test('multiple confirmations sort newest first with descending item ID as the stable tie-breaker', () => {
  const context = createContext();
  const records = [
    { id: '8', dateSent: '2026-10-07T12:00:00Z' },
    { id: '9', dateSent: '2026-10-08T12:00:00Z' },
    { id: '10', dateSent: '2026-10-08T12:00:00Z' },
    { id: '11', dateSent: '' }
  ];

  records.sort(context.compareOperatorRateTextsNewestFirst);
  assert.deepEqual(records.map((record) => record.id), ['10', '9', '8', '11']);
});

test('lookup uses a filtered paged read and preserves prefixed BOLs with leading zeros', async () => {
  const calls = [];
  const pages = [
    {
      value: [
        { id: '2', fields: { BOLNumber: 'KOL0007', DateSent: '2026-10-08T07:00:00Z', Phone1: 5550102000, Phone2: 5550102001 } },
        { id: '999', fields: { BOLNumber: 'KOL7', DateSent: '2026-10-09T07:00:00Z' } }
      ],
      '@odata.nextLink': 'opaque-next-page'
    },
    {
      value: [
        { id: '1', fields: { BOLNumber: 'kol0007', DateSent: '2026-10-07T07:00:00Z', Phone1: 5550102000 } }
      ]
    }
  ];
  const context = createContext(async (token, url, headers) => {
    calls.push({ token, url, headers });
    return pages[calls.length - 1];
  });

  const records = await context.getOperatorRateConfirmationsForBol('synthetic-token', 'KOL0007');
  const query = new URL(calls[0].url).searchParams;

  assert.equal(calls.length, 2);
  assert.equal(query.get('$filter'), "fields/BOLNumber eq 'KOL0007'");
  assert.equal(query.get('$top'), '200');
  assert.match(query.get('$expand'), /RateText/);
  assert.equal(calls[0].headers.Prefer, 'HonorNonIndexedQueriesWarningMayFailRandomly');
  assert.equal(calls[1].url, 'opaque-next-page');
  assert.deepEqual(Array.from(records, (record) => record.id), ['2', '1']);
});

test('lookup returns an empty history without treating it as an error', async () => {
  const context = createContext();
  const records = await context.getOperatorRateConfirmationsForBol('synthetic-token', 'ABC0000');
  assert.equal(records.length, 0);
});

test('upstream failure returns a modest isolated error without exposing Graph details', async () => {
  const context = vm.createContext({
    app: { get(_path, _auth, handler) { context.handler = handler; } },
    requireLookupAccess: () => {},
    getGraphToken: async () => 'synthetic-token',
    getOperatorRateConfirmationsForBol: async () => {
      throw new Error('synthetic private Graph response');
    },
    console: { error() {} }
  });
  const start = serverSource.indexOf("app.get('/operator-rate-confirmations',");
  const route = serverSource.slice(start, serverSource.indexOf('\n});', start) + 4);
  vm.runInContext(route, context);
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; }
  };

  await context.handler({ query: { bol: 'KOL0007' } }, response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.data.success, false);
  assert.equal(response.data.error, 'Rate confirmation history is temporarily unavailable.');
  assert.doesNotMatch(JSON.stringify(response.data), /private Graph/);
});

test('endpoint remains office-authenticated and is absent from mobile routes and payload builders', () => {
  assert.match(serverSource, /app\.get\('\/operator-rate-confirmations', requireLookupAccess/);
  assert.doesNotMatch(serverSource, /app\.get\('\/mobile\/operator-rate-confirmations'/);
  const mobileSection = serverSource.slice(serverSource.indexOf("app.post('/mobile/login'"));
  assert.doesNotMatch(mobileSection, /rateText|rateConfirmations|operator-rate-confirmations/i);
});

test('billing UI includes loading, empty, error, historical disclosure, wrapping, and theme-token styling', () => {
  assert.match(appSource, /Rate Confirmation/);
  assert.match(appSource, /No rate confirmation text recorded for this order\./);
  assert.match(appSource, /historical provider-submission information/);
  assert.match(appSource, /<pre>\{record\.rateText/);
  assert.match(cssSource, /\.rate-confirmation-message pre[\s\S]*white-space: pre-wrap/);
  assert.match(cssSource, /\.rate-confirmation-section[\s\S]*var\(--kole-/);
  assert.match(cssSource, /:root,\s*:root\[data-theme='dark'\][\s\S]*--kole-surface-2:/);
  assert.match(cssSource, /:root\[data-theme='light'\][\s\S]*--kole-surface-2:/);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*\.rate-confirmation-meta/);
});
