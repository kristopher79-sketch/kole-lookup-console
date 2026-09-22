'use strict';

// Validate the backend notice without calculating location or changing arrival state.
function getMobileProximityNoticeKey(fields = {}) {
  const key = typeof fields.ProximityNoticeKey === 'string' ? fields.ProximityNoticeKey.trim() : '';
  const parts = key.split('|');
  if (parts.length !== 2 || key.length > 512 || /[\x00-\x1f\x7f<>]/.test(key)) return '';
  const [bol, stop] = parts.map((part) => part.trim());
  if (!bol || !stop || bol !== String(fields.BOLNumber_x0028_Won_x0029_ || '').trim()) return '';
  if (normalizeMobileLoadStatus(getMobileChoiceValue(fields.Status)) !== 'won' ||
      parseMobileLoadFlag(fields.Processed) || parseMobileLoadFlag(fields.FinalSettleSent)) return '';
  return `${bol}|${stop}`;
}


function normalizeMobileLoadStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isMobileLoadStatusEligible(status) {
  const normalized = normalizeMobileLoadStatus(status);
  return normalized === 'won' || normalized === 'tonu';
}

function getMobileChoiceValue(value) {
  if (value && typeof value === 'object') {
    return value.Value || value.value || value.Label || value.label || '';
  }

  return value || '';
}

function normalizeMobileTruckKey(value) {
  const cleaned = String(getMobileChoiceValue(value) || '').trim().toUpperCase();

  if (!cleaned) return '';

  if (/^0*\d+$/.test(cleaned)) {
    return cleaned.replace(/^0+(?=\d)/, '').padStart(4, '0');
  }

  return cleaned.replace(/[^A-Z0-9]+/g, '');
}

function parseMobileLoadFlag(value) {
  const normalized = normalizeMobileLoadStatus(value);

  return (
    value === true ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === '1'
  );
}

function isMobileLoadEligibleForRoster(roster = {}, item = {}) {
  const fields = item?.fields || {};
  const status = getMobileChoiceValue(fields.Status);
  const truckKey = normalizeMobileTruckKey(roster.truck);
  const itemTruckKey = normalizeMobileTruckKey(
    fields.Truck_x0020_Number || fields['Truck_x0020_Number/Value']
  );

  return (
    isMobileLoadStatusEligible(status) &&
    Boolean(truckKey) &&
    itemTruckKey === truckKey &&
    !parseMobileLoadFlag(fields.Processed) &&
    !parseMobileLoadFlag(fields.FinalSettleSent)
  );
}

function getMobileAvailableLoadItem(selection = {}, items = [], loadId) {
  const normalizedLoadId = String(loadId || '').trim();
  if (!normalizedLoadId) return null;

  const availableLoad = [
    selection.currentLoad,
    ...(selection.upcomingLoads || [])
  ].filter(Boolean).find((load) => String(load.id || '') === normalizedLoadId);

  if (!availableLoad) return null;

  return (items || []).find((item) => String(item?.id || '') === normalizedLoadId) || null;
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
  getMobileProximityNoticeKey,
  getMobileAvailableLoadItem,
  isMobileLoadEligibleForRoster,
  isMobileLoadStatusEligible,
  normalizeMobileTruckKey,
  shouldKeepMobileLoadVisible
};
