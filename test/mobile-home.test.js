'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getMobileAvailableLoadItem,
  isMobileLoadEligibleForRoster,
  isMobileLoadStatusEligible,
  shouldKeepMobileLoadVisible
} = require('../mobile-home');

test('Won and TONU loads remain eligible for the assigned mobile driver', () => {
  assert.equal(isMobileLoadStatusEligible('Won'), true);
  assert.equal(isMobileLoadStatusEligible('TONU'), true);
  assert.equal(isMobileLoadStatusEligible('CAN'), false);
});

test('TONU remains visible only until either upload type has evidence', () => {
  assert.equal(shouldKeepMobileLoadVisible({ status: 'TONU' }), true);
  assert.equal(shouldKeepMobileLoadVisible({ status: 'TONU', hasPickupEvidence: true }), false);
  assert.equal(shouldKeepMobileLoadVisible({ status: 'TONU', hasDeliveryEvidence: true }), false);
});

test('Won loads continue to require Delivery evidence before leaving the mobile view', () => {
  assert.equal(shouldKeepMobileLoadVisible({ status: 'Won' }), true);
  assert.equal(shouldKeepMobileLoadVisible({ status: 'Won', hasPickupEvidence: true }), true);
  assert.equal(shouldKeepMobileLoadVisible({ status: 'Won', hasDeliveryEvidence: true }), false);
});

test('production load summaries use Status when applying upload visibility', () => {
  assert.equal(
    shouldKeepMobileLoadVisible({
      Status: 'Won',
      hasPickupEvidence: true,
      hasDeliveryEvidence: false
    }),
    true
  );
  assert.equal(
    shouldKeepMobileLoadVisible({
      Status: 'TONU',
      hasPickupEvidence: true,
      hasDeliveryEvidence: false
    }),
    false
  );
});

test('load eligibility requires the assigned truck and a live operational status', () => {
  const assignedLoad = {
    id: '42',
    fields: {
      Status: 'Won',
      Truck_x0020_Number: '0042',
      Processed: false,
      FinalSettleSent: false
    }
  };

  assert.equal(isMobileLoadEligibleForRoster({ truck: '42' }, assignedLoad), true);
  assert.equal(isMobileLoadEligibleForRoster({ truck: '77' }, assignedLoad), false);
  assert.equal(
    isMobileLoadEligibleForRoster(
      { truck: '42' },
      { ...assignedLoad, fields: { ...assignedLoad.fields, Status: 'CAN' } }
    ),
    false
  );
  assert.equal(
    isMobileLoadEligibleForRoster(
      { truck: '42' },
      { ...assignedLoad, fields: { ...assignedLoad.fields, Processed: true } }
    ),
    false
  );
  assert.equal(
    isMobileLoadEligibleForRoster(
      { truck: '42' },
      { ...assignedLoad, fields: { ...assignedLoad.fields, FinalSettleSent: 'Yes' } }
    ),
    false
  );
});

test('available-load lookup only returns current or upcoming Mobile selections', () => {
  const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
  const selection = {
    currentLoad: { id: '1' },
    upcomingLoads: [{ id: '2' }]
  };

  assert.equal(getMobileAvailableLoadItem(selection, items, '1')?.id, '1');
  assert.equal(getMobileAvailableLoadItem(selection, items, '2')?.id, '2');
  assert.equal(getMobileAvailableLoadItem(selection, items, '3'), null);
});
