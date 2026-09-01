'use strict';

function normalizeMobileLoadStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isMobileLoadStatusEligible(status) {
  const normalized = normalizeMobileLoadStatus(status);
  return normalized === 'won' || normalized === 'tonu';
}

function shouldKeepMobileLoadVisible({
  status,
  hasPickupEvidence = false,
  hasDeliveryEvidence = false
} = {}) {
  const normalized = normalizeMobileLoadStatus(status);

  if (!isMobileLoadStatusEligible(normalized)) return false;

  return normalized === 'tonu'
    ? !hasPickupEvidence && !hasDeliveryEvidence
    : !hasDeliveryEvidence;
}

module.exports = {
  isMobileLoadStatusEligible,
  shouldKeepMobileLoadVisible
};
