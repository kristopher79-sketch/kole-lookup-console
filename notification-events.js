'use strict';

const crypto = require('crypto');

const NOTIFICATION_EVENT_TYPES = Object.freeze({
  NEW_LOAD: 'NEW_LOAD',
  LOAD_UPDATED: 'LOAD_UPDATED',
  LOAD_CANCELLED: 'LOAD_CANCELLED',
  LOAD_TONU: 'LOAD_TONU',
  LOAD_REMOVED: 'LOAD_REMOVED'
});

const DRIVER_IMPACTING_FIELD_DEFINITIONS = Object.freeze([
  { field: 'Shipment_x0020_Origin', type: 'text' },
  { field: 'Shipment_x0020_Destination', type: 'text' },
  { field: 'Pickup_x0020_Offer_x0020_Date', type: 'date' },
  { field: 'Pickup1PickupTime', type: 'text' },
  { field: 'Pickup1AMorPM', type: 'text' },
  { field: 'Pickup1Name', type: 'text' },
  { field: 'Pickup1Address1', type: 'text' },
  { field: 'Pickup1City', type: 'text' },
  { field: 'Pickup2State', type: 'text' },
  { field: 'Pickup2Zip', type: 'text' },
  { field: 'Pickup1ContactName', type: 'text' },
  { field: 'Pickup1ContactNumber', type: 'text' },
  { field: 'Expected_x0020_Delivery_x0020_Da', type: 'date' },
  { field: 'Delivery1Time', type: 'text' },
  { field: 'Delivery1AMorPM', type: 'text' },
  { field: 'Delivery1Name', type: 'text' },
  { field: 'Deliver1Address1', type: 'text' },
  { field: 'Delivery1City', type: 'text' },
  { field: 'Delivery1State', type: 'text' },
  { field: 'Delivery1Zip', type: 'text' },
  { field: 'Delivery1ContactName', type: 'text' },
  { field: 'Delivery1ContactNumber', type: 'text' },
  { field: 'Freight_x0020_Description', type: 'text' },
  { field: 'Item1QTY', type: 'number' },
  { field: 'Item1Description', type: 'text' },
  { field: 'TotalPieces', type: 'number' },
  { field: 'Item1Serial', type: 'text' },
  { field: 'Item1Dimensions', type: 'text' },
  { field: 'Length', type: 'number' },
  { field: 'Width', type: 'number' },
  { field: 'Height', type: 'number' },
  { field: 'EstimatedWeight', type: 'number' },
  { field: 'Route', type: 'text' },
  { field: 'Team_x0020_Required', type: 'boolean' },
  { field: 'No_x002e_ofTarpsNeeded', type: 'number' },
  { field: 'OrderNotes', type: 'richText' }
]);

const DRIVER_IMPACTING_FIELDS = Object.freeze(
  DRIVER_IMPACTING_FIELD_DEFINITIONS.map((definition) => definition.field)
);

const UNASSIGNED_TRUCK_VALUES = new Set(['', '-', 'UNASSIGNED', 'NONE', 'N/A']);

function getChoiceValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.Value ?? value.value ?? value.Label ?? value.label ?? '';
  }

  return value ?? '';
}

function getItemFields(item) {
  if (item?.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)) {
    return item.fields;
  }

  return item && typeof item === 'object' && !Array.isArray(item) ? item : {};
}

function normalizeTextValue(value) {
  const resolved = getChoiceValue(value);

  if (Array.isArray(resolved)) {
    return resolved.map(normalizeTextValue).filter(Boolean).sort().join('|');
  }

  return String(resolved ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeRichTextValue(value) {
  return decodeBasicHtmlEntities(getChoiceValue(value))
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

function normalizeDateValue(value) {
  const text = normalizeTextValue(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : text;
}

function normalizeNumberValue(value) {
  const text = normalizeTextValue(value).replace(/,/g, '');
  if (!text) return '';

  const number = Number(text);
  return Number.isFinite(number) ? String(number) : text;
}

function normalizeBooleanValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const text = normalizeTextValue(value).toLowerCase();
  if (['true', 'yes', '1'].includes(text)) return 'true';
  if (['false', 'no', '0', ''].includes(text)) return 'false';
  return text;
}

function normalizeComparableFieldValue(definition, value) {
  if (definition.type === 'date') return normalizeDateValue(value);
  if (definition.type === 'number') return normalizeNumberValue(value);
  if (definition.type === 'boolean') return normalizeBooleanValue(value);
  if (definition.type === 'richText') return normalizeRichTextValue(value);
  return normalizeTextValue(value);
}

function getDriverImpactingChangedFields(previousFields = {}, currentFields = {}) {
  return DRIVER_IMPACTING_FIELD_DEFINITIONS
    .filter((definition) => (
      normalizeComparableFieldValue(definition, previousFields[definition.field]) !==
      normalizeComparableFieldValue(definition, currentFields[definition.field])
    ))
    .map((definition) => definition.field);
}

function areDriverImpactingChangesOnlyAdditions(previousFields, currentFields, changedFields) {
  if (changedFields.length === 0) return false;

  return changedFields.every((field) => {
    const definition = DRIVER_IMPACTING_FIELD_DEFINITIONS.find((candidate) => candidate.field === field);
    if (!definition) return false;

    return (
      normalizeComparableFieldValue(definition, previousFields[field]) === '' &&
      normalizeComparableFieldValue(definition, currentFields[field]) !== ''
    );
  });
}

function normalizeStatus(value) {
  return normalizeTextValue(value).toUpperCase();
}

function normalizeTruckNumber(value) {
  const truck = normalizeTextValue(value).toUpperCase();
  return UNASSIGNED_TRUCK_VALUES.has(truck) ? '' : truck;
}

function getPayloadText(currentFields, previousFields, field) {
  const currentValue = normalizeTextValue(currentFields[field]);
  return currentValue || normalizeTextValue(previousFields[field]);
}

function getPayloadDate(currentFields, previousFields, field) {
  const currentValue = normalizeDateValue(currentFields[field]);
  return currentValue || normalizeDateValue(previousFields[field]);
}

function getPayloadTime(currentFields, previousFields, timeField, ampmField) {
  const time = getPayloadText(currentFields, previousFields, timeField);
  const ampm = getPayloadText(currentFields, previousFields, ampmField).toUpperCase();

  if (!time || !ampm || /\b(?:AM|PM)$/i.test(time)) return time;
  return `${time} ${ampm}`;
}

function createEventId({ sourceListId, sourceItemId, sourceRevision, eventType, truckNumber }) {
  const fingerprint = [
    sourceListId,
    sourceItemId,
    sourceRevision,
    eventType,
    normalizeTruckNumber(truckNumber)
  ].map((value) => String(value || '').trim()).join('|');

  return `kne_${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 40)}`;
}

function createNotificationEvent(context, eventType, truckNumber, options = {}) {
  const {
    currentFields,
    previousFields,
    sourceListId,
    sourceItemId,
    sourceModified,
    sourceVersion,
    sourceRevision,
    createdAt,
    status,
    previousStatus,
    previousTruckNumber
  } = context;
  const targetTruck = normalizeTruckNumber(truckNumber);

  return {
    eventType,
    eventId: createEventId({
      sourceListId,
      sourceItemId,
      sourceRevision,
      eventType,
      truckNumber: targetTruck
    }),
    createdAt,
    bidId: getPayloadText(currentFields, previousFields, 'BidID'),
    loadId: sourceItemId,
    bolNumber: getPayloadText(currentFields, previousFields, 'BOLNumber_x0028_Won_x0029_'),
    truckNumber: targetTruck,
    previousTruckNumber: normalizeTruckNumber(options.previousTruckNumber ?? previousTruckNumber),
    origin: getPayloadText(currentFields, previousFields, 'Shipment_x0020_Origin'),
    destination: getPayloadText(currentFields, previousFields, 'Shipment_x0020_Destination'),
    pickupDate: getPayloadDate(currentFields, previousFields, 'Pickup_x0020_Offer_x0020_Date'),
    pickupTime: getPayloadTime(currentFields, previousFields, 'Pickup1PickupTime', 'Pickup1AMorPM'),
    deliveryDate: getPayloadDate(currentFields, previousFields, 'Expected_x0020_Delivery_x0020_Da'),
    deliveryTime: getPayloadTime(currentFields, previousFields, 'Delivery1Time', 'Delivery1AMorPM'),
    loadDetailsAdded: options.loadDetailsAdded === true,
    changedFields: Array.from(new Set(options.changedFields || [])),
    status,
    previousStatus,
    sourceListId,
    sourceItemId,
    sourceModified,
    sourceVersion
  };
}

function createBidListingNotificationEvents(input = {}) {
  const previousItem = input.previousItem || null;
  const currentItem = input.currentItem || {};
  const previousFields = getItemFields(previousItem);
  const currentFields = getItemFields(currentItem);
  const sourceItemId = String(input.sourceItemId || currentItem.id || previousItem?.id || '').trim();
  const sourceListId = String(input.sourceListId || '').trim();
  const sourceModified = String(
    input.sourceModified || currentItem.lastModifiedDateTime || currentItem.modified || ''
  ).trim();
  const sourceVersion = String(
    input.sourceVersion || currentItem.sourceVersion || ''
  ).trim();
  const sourceRevision = sourceModified || sourceVersion || String(currentItem.eTag || currentItem['@odata.etag'] || '').trim();

  if (!sourceItemId || !sourceRevision) {
    throw new Error('Notification change detection requires a source item ID and revision.');
  }

  const createdAt = String(input.createdAt || new Date().toISOString());
  const previousStatus = normalizeStatus(previousFields.Status);
  const status = normalizeStatus(currentFields.Status);
  const previousTruckNumber = normalizeTruckNumber(previousFields.Truck_x0020_Number);
  const truckNumber = normalizeTruckNumber(currentFields.Truck_x0020_Number);
  const previousBolNumber = normalizeTextValue(previousFields.BOLNumber_x0028_Won_x0029_);
  const bolNumber = normalizeTextValue(currentFields.BOLNumber_x0028_Won_x0029_);
  const loadDetailsAdded = !previousBolNumber && Boolean(bolNumber);
  const wasWon = previousStatus === 'WON';
  const isWon = status === 'WON';
  const statusChanged = status !== previousStatus;
  const truckChanged = truckNumber !== previousTruckNumber;
  const controlChangedFields = [];

  if (!previousItem || statusChanged) controlChangedFields.push('Status');
  if (!previousItem || truckChanged) controlChangedFields.push('Truck_x0020_Number');

  const context = {
    currentFields,
    previousFields,
    sourceListId,
    sourceItemId,
    sourceModified,
    sourceVersion,
    sourceRevision,
    createdAt,
    status,
    previousStatus,
    previousTruckNumber
  };

  if (wasWon && previousTruckNumber && status === 'CAN') {
    return [createNotificationEvent(
      context,
      NOTIFICATION_EVENT_TYPES.LOAD_CANCELLED,
      previousTruckNumber,
      { changedFields: controlChangedFields, previousTruckNumber }
    )];
  }

  if (wasWon && previousTruckNumber && status === 'TONU') {
    return [createNotificationEvent(
      context,
      NOTIFICATION_EVENT_TYPES.LOAD_TONU,
      previousTruckNumber,
      { changedFields: controlChangedFields, previousTruckNumber }
    )];
  }

  if (wasWon && isWon && truckChanged) {
    const events = [];

    if (previousTruckNumber) {
      events.push(createNotificationEvent(
        context,
        NOTIFICATION_EVENT_TYPES.LOAD_REMOVED,
        previousTruckNumber,
        { changedFields: ['Truck_x0020_Number'], previousTruckNumber }
      ));
    }

    if (truckNumber) {
      events.push(createNotificationEvent(
        context,
        NOTIFICATION_EVENT_TYPES.NEW_LOAD,
        truckNumber,
        { changedFields: ['Truck_x0020_Number'], previousTruckNumber }
      ));
    }

    return events;
  }

  if (isWon && truckNumber && (!wasWon || !previousTruckNumber)) {
    return [createNotificationEvent(
      context,
      NOTIFICATION_EVENT_TYPES.NEW_LOAD,
      truckNumber,
      { changedFields: controlChangedFields, previousTruckNumber }
    )];
  }

  if (wasWon && isWon && truckNumber && truckNumber === previousTruckNumber) {
    const changedFields = getDriverImpactingChangedFields(previousFields, currentFields);

    if (loadDetailsAdded) {
      return [createNotificationEvent(
        context,
        NOTIFICATION_EVENT_TYPES.LOAD_UPDATED,
        truckNumber,
        { changedFields, previousTruckNumber, loadDetailsAdded: true }
      )];
    }

    if (
      input.registrationWindowActive === true ||
      (
        !bolNumber &&
        areDriverImpactingChangesOnlyAdditions(previousFields, currentFields, changedFields)
      )
    ) {
      return [];
    }

    if (changedFields.length > 0) {
      return [createNotificationEvent(
        context,
        NOTIFICATION_EVENT_TYPES.LOAD_UPDATED,
        truckNumber,
        { changedFields, previousTruckNumber }
      )];
    }
  }

  return [];
}

function normalizeDriverTruckKey(value) {
  const truck = normalizeTruckNumber(value);
  if (/^0*\d+$/.test(truck)) return truck.replace(/^0+(?=\d)/, '').padStart(4, '0');
  return truck.replace(/[^A-Z0-9]/g, '');
}

function findActiveMobileDriverForTruck(rosterItems = [], truckNumber = '') {
  const targetKey = normalizeDriverTruckKey(truckNumber);
  if (!targetKey) return null;

  return rosterItems.find((item) => (
    normalizeDriverTruckKey(item?.truck) === targetKey &&
    normalizeStatus(item?.status) === 'ACTIVE' &&
    Boolean(String(item?.pin || '').trim())
  )) || null;
}

module.exports = {
  NOTIFICATION_EVENT_TYPES,
  DRIVER_IMPACTING_FIELDS,
  createBidListingNotificationEvents,
  findActiveMobileDriverForTruck,
  getDriverImpactingChangedFields,
  normalizeTruckNumber
};
