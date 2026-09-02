'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
