'use strict';

function normalizeMobileLoadStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isMobileLoadStatusEligible(status) {
  const normalized = normalizeMobileLoadStatus(status);
  return normalized === 'won' || normalized === 'tonu';
}

function shouldKeepMobileLoadVisible(load = {}) {
  const normalized = normalizeMobileLoadStatus(load.Status ?? load.status);
  const hasPickupEvidence = load.hasPickupEvidence === true;
  const hasDeliveryEvidence = load.hasDeliveryEvidence === true;

  if (!isMobileLoadStatusEligible(normalized)) return false;

  return normalized === 'tonu'
    ? !hasPickupEvidence && !hasDeliveryEvidence
    : !hasDeliveryEvidence;
}

module.exports = {
  isMobileLoadStatusEligible,
  shouldKeepMobileLoadVisible
};
