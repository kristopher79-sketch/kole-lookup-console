'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const names = [
  'normalizeText',
  'normalizeSearchValue',
  'getNumberValue',
  'normalizeTruckKey',
  'normalizeEasternDateOnly',
  'sortDriverRosterRecords',
  'getSettlementRevenueMatchKeys',
  'getRosterRevenueMatchKeys',
  'buildSettlementRevenueKeySet',
  'hasAnyRevenueKeyMatch',
  'isExcludedActiveNoRevenueSettlementRosterRow',
  'buildActiveDriversWithNoSettlementRevenue'
];

const context = vm.createContext({});
const code = names.map((name) => {
  const start = source.search(new RegExp(`function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');
vm.runInContext(code, context);

function roster(id, startDate, extra = {}) {
  return {
    id,
    status: 'Active',
    startDate,
    truck: id,
    tmsName: `Driver ${id}`,
    operatorTeamName: '',
    ...extra
  };
}

test('historical settlement no-pay list excludes drivers who started after its cutoff', () => {
  const rows = context.buildActiveDriversWithNoSettlementRevenue([
    roster('1001', '2026-05-01'),
    roster('1002', '2026-05-08'),
    roster('1003', '2026-05-09'),
    roster('1004', '')
  ], [], [], '2026-05-08');

  assert.deepEqual(Array.from(rows, (row) => row.id), ['1001', '1002', '1004']);
});

test('historical cutoff filter preserves revenue matching and inactive filtering', () => {
  const rows = context.buildActiveDriversWithNoSettlementRevenue([
    roster('2001', '2026-05-01'),
    roster('2002', '2026-05-01'),
    roster('2003', '2026-05-01', { status: 'Inactive' })
  ], [
    { Operator: 'Driver 2001', OperatorTeam: '', Truck: '2001', BidAmount: 1000 }
  ], [
    { Operator: 'Driver 2002', OperatorTeam: '', Truck: '2002', BidAmount: 1000 }
  ], '2026-05-08');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '2002');
  assert.equal(rows[0].hasMainSettlementRevenue, false);
  assert.equal(rows[0].hasLikelyNextWeekRevenue, true);
});
