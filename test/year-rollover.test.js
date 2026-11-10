const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(__dirname, '../client/client/src/App.jsx'), 'utf8');

function extractFunction(name, fileSource = source) {
  const start = fileSource.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `Missing function ${name}`);
  return fileSource.slice(start, fileSource.indexOf('\n}', start) + 2);
}

function loadFunctions(names, bindings = {}, declarations = '') {
  const context = vm.createContext({ ...bindings });
  const code = names.map((name) => extractFunction(name)).join('\n');
  vm.runInContext(`${declarations}\n${code}`, context);
  return context;
}

test('single-year reports keep the live Bid Listing beside the matching archive', () => {
  const { getBidReportSourceListsFromLists } = loadFunctions(['getBidReportSourceListsFromLists']);
  const lists = [
    { listId: 'live', label: 'Bid Listing', year: 'Current' },
    { listId: 'a2026', label: 'Bid Listing Archive 2026', year: '2026' },
    { listId: 'a2025', label: 'Bid Listing Archive 2025', year: '2025' }
  ];

  assert.deepEqual(
    Array.from(getBidReportSourceListsFromLists(lists, [2026]), (list) => list.listId),
    ['live', 'a2026']
  );
  assert.deepEqual(
    Array.from(getBidReportSourceListsFromLists(lists.filter((list) => list.listId !== 'a2026'), [2026]), (list) => list.listId),
    ['live']
  );
});

test('migration overlap is deduplicated and the live record wins', () => {
  const context = loadFunctions([
    'normalizeText',
    'getBidReportItemSourceList',
    'getBidReportDedupeKey',
    'isLiveBidReportItem',
    'dedupeBidReportItems'
  ]);
  const archive = {
    id: '41',
    fields: { BidID: 'BID-42', BOLNumber_x0028_Won_x0029_: 'BOL-42', Quoted_x0020_Total: 100 },
    KoleSourceList: { listId: 'archive', label: 'Bid Listing Archive 2026' }
  };
  const live = {
    id: '99',
    fields: { BidID: 'bid-42', BOLNumber_x0028_Won_x0029_: 'BOL-42', Quoted_x0020_Total: 150 },
    KoleSourceList: { listId: 'live', label: 'Bid Listing' }
  };

  const result = context.dedupeBidReportItems([archive, live]);

  assert.equal(result.duplicateRecordsRemoved, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fields.Quoted_x0020_Total, 150);
  assert.equal(result.items[0].KoleSourceList.listId, 'live');
});

test('report loading merges live and archive reads before returning records', async () => {
  const mapSequentialSettled = async (items, worker) => {
    const results = [];
    for (let index = 0; index < items.length; index += 1) {
      try {
        results.push({ status: 'fulfilled', value: await worker(items[index], index) });
      } catch (reason) {
        results.push({ status: 'rejected', reason });
      }
    }
    return results;
  };
  const context = loadFunctions([
    'normalizeText',
    'getBidReportItemSourceList',
    'tagBidReportItem',
    'getBidReportDedupeKey',
    'isLiveBidReportItem',
    'dedupeBidReportItems',
    'getBidReportItemsFromSources'
  ], {
    mapSequentialSettled,
    getAllListItemsWithFieldsResilient: async (_token, listId) => ({
      items: [{
        id: listId === 'live' ? '99' : '41',
        fields: { BidID: 'BID-42', Quoted_x0020_Total: listId === 'live' ? 150 : 100 }
      }],
      usedFallback: false,
      warning: ''
    })
  });
  const sourceLists = [
    { listId: 'live', label: 'Bid Listing', year: 'Current' },
    { listId: 'archive', label: 'Bid Listing Archive 2026', year: '2026' }
  ];

  const result = await context.getBidReportItemsFromSources('token', sourceLists, 'BidID');

  assert.equal(result.scannedRecords, 2);
  assert.equal(result.duplicateRecordsRemoved, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].KoleSourceList.listId, 'live');
});

test('January recruiting snapshot always includes the fluid live list', () => {
  const { getRecruitingSnapshotSourceLists } = loadFunctions(
    ['getRecruitingSnapshotSourceLists'],
    {},
    'function getRecruitingSnapshotWindowYears() { return new Set([2026]); }'
  );
  const lists = [
    { listId: 'live', label: 'Bid Listing', year: 'Current' },
    { listId: 'a2025', label: 'Bid Listing Archive 2025', year: '2025' }
  ];

  assert.deepEqual(
    Array.from(getRecruitingSnapshotSourceLists(lists, {}), (list) => list.listId),
    ['live']
  );
});

test('2027 Sales Lead totals subtract every completed supported year', () => {
  const { cleanSalesLeadItem } = loadFunctions(
    ['cleanSalesLeadItem'],
    {
      formatEasternDate: () => '2027-01-06',
      normalizeCustomerName: (value) => String(value || '').toLowerCase(),
      getFlexibleFieldValue: (value) => value || '',
      isSalesFollowUpDue: () => false,
      isPlaceholderFutureDate: () => false
    },
    'const SALES_LEAD_YEARS = Object.freeze([2024, 2025, 2026, 2027, 2028, 2029, 2030]);'
  );
  const lead = cleanSalesLeadItem({
    id: '1',
    fields: {
      CompanyName: 'Example',
      QuoteCount: 20,
      QuotesWon: 10,
      Quotes2024: 2,
      Quotes2025: 3,
      Quotes2026: 4,
      Wins2024: 1,
      Wins2025: 2,
      Wins2026: 3
    }
  });
  const current = lead.YearDetails.find((detail) => detail.year === 2027);

  assert.equal(current.quotes, 11);
  assert.equal(current.wins, 4);
  assert.equal(current.isCurrentYear, true);
});

test('archive discovery no longer stops at 2030', () => {
  const { getArchiveYear } = loadFunctions(
    ['getArchiveYear'],
    {},
    'const ARCHIVE_YEAR_MIN = 2024;'
  );

  assert.equal(getArchiveYear('Bid Listing Archive 2031'), 2031);
  assert.equal(getArchiveYear('Bid Listing Archive 2023'), null);
});

test('client report periods switch years on Eastern midnight', () => {
  const context = vm.createContext({ Intl, Date });
  const code = [
    'getEasternDateInputValue',
    'getEasternYearMonth',
    'getPreviousEasternYearMonth',
    'getDefaultSettlementCutoffDate'
  ].map((name) => extractFunction(name, clientSource)).join('\n');
  vm.runInContext(code, context);

  const beforeMidnight = new Date('2027-01-01T04:59:59Z');
  const atMidnight = new Date('2027-01-01T05:00:00Z');

  assert.deepEqual(
    { ...context.getEasternYearMonth(beforeMidnight) },
    { year: 2026, month: 12 }
  );
  assert.deepEqual(
    { ...context.getEasternYearMonth(atMidnight) },
    { year: 2027, month: 1 }
  );
  assert.deepEqual(
    { ...context.getPreviousEasternYearMonth(atMidnight) },
    { year: 2026, month: 12 }
  );
  assert.equal(context.getDefaultSettlementCutoffDate(atMidnight), '2026-12-31');
});
