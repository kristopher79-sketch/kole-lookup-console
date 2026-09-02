'use strict';

const MOBILE_CHECKIN_MAX_STOP_SEQUENCE = 100;
const MOBILE_CHECKIN_STOPS = Object.freeze({
  pickup: 'Pickup',
  delivery: 'Delivery'
});
const MOBILE_CHECKIN_ACTIONS = Object.freeze({
  in: 'In',
  out: 'Out'
});
const MOBILE_CHECKIN_LOCATION_STATUSES = Object.freeze({
  captured: 'Captured',
  denied: 'Denied',
  unavailable: 'Unavailable',
  timeout: 'Timeout'
});

function createMobileCheckinError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeMobileCheckinText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMobileTruckKey(value) {
  const cleaned = String(value || '').trim().toUpperCase();

  if (!cleaned) return '';
  if (/^0*\d+$/.test(cleaned)) {
    return cleaned.replace(/^0+(?=\d)/, '').padStart(4, '0');
  }

  return cleaned.replace(/[^A-Z0-9]+/g, '');
}

function getCanonicalValue(value, allowedValues) {
  return allowedValues[normalizeMobileCheckinText(value)] || '';
}

function validateMobileStopEventInput(input = {}) {
  const loadId = String(input.loadId || '').trim();
  if (!/^\d{1,12}$/.test(loadId)) {
    throw createMobileCheckinError(
      'A valid load is required.',
      400,
      'INVALID_LOAD_ID'
    );
  }

  const stop = getCanonicalValue(input.stop, MOBILE_CHECKIN_STOPS);
  if (!stop) {
    throw createMobileCheckinError(
      'Stop must be Pickup or Delivery.',
      400,
      'INVALID_STOP'
    );
  }

  const stopSequence = input.stopSequence;
  if (
    !Number.isInteger(stopSequence) ||
    stopSequence < 1 ||
    stopSequence > MOBILE_CHECKIN_MAX_STOP_SEQUENCE
  ) {
    throw createMobileCheckinError(
      `Stop sequence must be a whole number from 1 through ${MOBILE_CHECKIN_MAX_STOP_SEQUENCE}.`,
      400,
      'INVALID_STOP_SEQUENCE'
    );
  }

  const action = getCanonicalValue(input.action, MOBILE_CHECKIN_ACTIONS);
  if (!action) {
    throw createMobileCheckinError(
      'Action must be In or Out.',
      400,
      'INVALID_ACTION'
    );
  }

  const rawLocation = input.location && typeof input.location === 'object'
    ? input.location
    : {};
  const locationStatus = getCanonicalValue(
    rawLocation.status,
    MOBILE_CHECKIN_LOCATION_STATUSES
  );
  if (!locationStatus) {
    throw createMobileCheckinError(
      'Location status must be Captured, Denied, Unavailable, or Timeout.',
      400,
      'INVALID_LOCATION_STATUS'
    );
  }

  const location = {
    status: locationStatus,
    latitude: null,
    longitude: null,
    accuracy: null
  };

  if (locationStatus === 'Captured') {
    if (!Number.isFinite(rawLocation.latitude) || rawLocation.latitude < -90 || rawLocation.latitude > 90) {
      throw createMobileCheckinError(
        'Captured latitude must be a number from -90 through 90.',
        400,
        'INVALID_LATITUDE'
      );
    }
    if (!Number.isFinite(rawLocation.longitude) || rawLocation.longitude < -180 || rawLocation.longitude > 180) {
      throw createMobileCheckinError(
        'Captured longitude must be a number from -180 through 180.',
        400,
        'INVALID_LONGITUDE'
      );
    }
    if (!Number.isFinite(rawLocation.accuracy) || rawLocation.accuracy < 0) {
      throw createMobileCheckinError(
        'Captured location accuracy must be a nonnegative number.',
        400,
        'INVALID_ACCURACY'
      );
    }

    location.latitude = rawLocation.latitude;
    location.longitude = rawLocation.longitude;
    location.accuracy = rawLocation.accuracy;
  }

  return {
    loadId,
    stop,
    stopSequence,
    action,
    location
  };
}

function getMobileStopEventIdentity(event = {}) {
  return [
    String(event.loadId || '').trim(),
    normalizeMobileCheckinText(event.stop),
    String(event.stopSequence || '').trim(),
    normalizeMobileCheckinText(event.action)
  ].join('|');
}

function isSameMobileStopEventIdentity(left, right) {
  return getMobileStopEventIdentity(left) === getMobileStopEventIdentity(right);
}

function findMobileStopEvent(events = [], identity) {
  return events.find((event) => isSameMobileStopEventIdentity(event, identity)) || null;
}

function getMobileStopEventsForStop(events = [], stop, stopSequence) {
  const canonicalStop = getCanonicalValue(stop, MOBILE_CHECKIN_STOPS);

  return events.filter((event) => (
    normalizeMobileCheckinText(event.stop) === normalizeMobileCheckinText(canonicalStop) &&
    Number(event.stopSequence) === Number(stopSequence)
  ));
}

function getEarliestMobileStopEvent(events, action) {
  const canonicalAction = getCanonicalValue(action, MOBILE_CHECKIN_ACTIONS);

  return events
    .filter((event) => normalizeMobileCheckinText(event.action) === normalizeMobileCheckinText(canonicalAction))
    .sort((left, right) => {
      const leftTime = Date.parse(left.time || '') || Number.MAX_SAFE_INTEGER;
      const rightTime = Date.parse(right.time || '') || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })[0] || null;
}

function deriveMobileStopState(events = [], stop, stopSequence = 1) {
  const stopEvents = getMobileStopEventsForStop(events, stop, stopSequence);
  const arrivedEvent = getEarliestMobileStopEvent(stopEvents, 'In');
  const departedEvent = getEarliestMobileStopEvent(stopEvents, 'Out');

  return {
    stop: getCanonicalValue(stop, MOBILE_CHECKIN_STOPS),
    stopSequence,
    arrivedEvent,
    departedEvent,
    nextAction: departedEvent ? null : arrivedEvent ? 'Out' : 'In',
    complete: Boolean(arrivedEvent && departedEvent)
  };
}

function assertMobileStopEventOwnership(driver = {}, load = {}) {
  const driverTruck = normalizeMobileTruckKey(driver.truck);
  const loadTruck = normalizeMobileTruckKey(load.truck);

  if (!driverTruck || !loadTruck || driverTruck !== loadTruck) {
    throw createMobileCheckinError(
      'That load is not available for this Mobile session.',
      404,
      'LOAD_NOT_AVAILABLE'
    );
  }
}

function buildMobileStopEventRecord({ input, driver, load, now }) {
  assertMobileStopEventOwnership(driver, load);

  const bol = String(load.bol || '').trim();
  if (!bol) {
    throw createMobileCheckinError(
      'This load does not have a BOL reference yet.',
      409,
      'BOL_NOT_AVAILABLE'
    );
  }

  const timestamp = String(now || '').trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw createMobileCheckinError(
      'The server could not determine the event time.',
      500,
      'EVENT_TIME_UNAVAILABLE'
    );
  }

  return {
    id: '',
    bol,
    loadId: String(load.id || input.loadId || '').trim(),
    truck: String(driver.truck || '').trim(),
    operator: String(driver.operator || '').trim(),
    stop: input.stop,
    stopSequence: input.stopSequence,
    action: input.action,
    time: new Date(timestamp).toISOString(),
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    accuracy: input.location.accuracy,
    locationStatus: input.location.status
  };
}

function cleanMobileStopEventItem(item = {}, fieldNames = {}) {
  const fields = item.fields || {};
  const getField = (name) => name ? fields[name] : undefined;
  const getNullableNumber = (name) => {
    const value = getField(name);
    if (value === '' || value === null || value === undefined) return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  };

  return {
    id: String(item.id || ''),
    bol: String(getField(fieldNames.bol) || '').trim(),
    loadId: String(getField(fieldNames.loadId) || '').trim(),
    truck: String(getField(fieldNames.truck) || '').trim(),
    operator: String(getField(fieldNames.operator) || '').trim(),
    stop: getCanonicalValue(getField(fieldNames.stop), MOBILE_CHECKIN_STOPS) || String(getField(fieldNames.stop) || '').trim(),
    stopSequence: getNullableNumber(fieldNames.stopSequence),
    action: getCanonicalValue(getField(fieldNames.action), MOBILE_CHECKIN_ACTIONS) || String(getField(fieldNames.action) || '').trim(),
    time: String(getField(fieldNames.time) || '').trim(),
    latitude: getNullableNumber(fieldNames.latitude),
    longitude: getNullableNumber(fieldNames.longitude),
    accuracy: getNullableNumber(fieldNames.accuracy),
    locationStatus: getCanonicalValue(
      getField(fieldNames.locationStatus),
      MOBILE_CHECKIN_LOCATION_STATUSES
    ) || String(getField(fieldNames.locationStatus) || '').trim()
  };
}

function toMobileStopEventResponse(event = {}) {
  return {
    id: String(event.id || ''),
    stop: event.stop || '',
    stopSequence: Number(event.stopSequence) || 0,
    action: event.action || '',
    time: event.time || '',
    latitude: Number.isFinite(event.latitude) ? event.latitude : null,
    longitude: Number.isFinite(event.longitude) ? event.longitude : null,
    accuracy: Number.isFinite(event.accuracy) ? event.accuracy : null,
    locationStatus: event.locationStatus || ''
  };
}

function createMobileCheckinService({ repository, now = () => new Date().toISOString() } = {}) {
  if (
    !repository ||
    typeof repository.listEvents !== 'function' ||
    typeof repository.createEvent !== 'function'
  ) {
    throw new TypeError('A Mobile check-in repository is required.');
  }

  const inFlightEvents = new Map();

  async function recordEvent({ input, driver, load, context } = {}) {
    const validatedInput = validateMobileStopEventInput(input);
    assertMobileStopEventOwnership(driver, load);

    if (String(load?.id || '').trim() !== validatedInput.loadId) {
      throw createMobileCheckinError(
        'That load is not available for this Mobile session.',
        404,
        'LOAD_NOT_AVAILABLE'
      );
    }

    const identity = getMobileStopEventIdentity(validatedInput);
    const pending = inFlightEvents.get(identity);
    if (pending) {
      const pendingResult = await pending;
      return { ...pendingResult, idempotentReplay: true };
    }

    const operation = (async () => {
      const existingEvents = await repository.listEvents(context, validatedInput.loadId);
      const existingEvent = findMobileStopEvent(existingEvents, validatedInput);

      if (existingEvent) {
        return { event: existingEvent, idempotentReplay: true };
      }

      if (validatedInput.action === 'Out') {
        const stopState = deriveMobileStopState(
          existingEvents,
          validatedInput.stop,
          validatedInput.stopSequence
        );

        if (!stopState.arrivedEvent) {
          throw createMobileCheckinError(
            `Check in at ${validatedInput.stop} before checking out.`,
            409,
            'CHECK_IN_REQUIRED'
          );
        }
      }

      const eventRecord = buildMobileStopEventRecord({
        input: validatedInput,
        driver,
        load,
        now: now()
      });

      try {
        const createdEvent = await repository.createEvent(context, eventRecord);
        return { event: createdEvent, idempotentReplay: false };
      } catch (error) {
        const replayEvents = await repository.listEvents(context, validatedInput.loadId).catch(() => []);
        const replayEvent = findMobileStopEvent(replayEvents, validatedInput);

        if (replayEvent) {
          return { event: replayEvent, idempotentReplay: true };
        }

        throw error;
      }
    })();

    inFlightEvents.set(identity, operation);

    try {
      return await operation;
    } finally {
      if (inFlightEvents.get(identity) === operation) {
        inFlightEvents.delete(identity);
      }
    }
  }

  return { recordEvent };
}

module.exports = {
  MOBILE_CHECKIN_ACTIONS,
  MOBILE_CHECKIN_LOCATION_STATUSES,
  MOBILE_CHECKIN_MAX_STOP_SEQUENCE,
  MOBILE_CHECKIN_STOPS,
  assertMobileStopEventOwnership,
  buildMobileStopEventRecord,
  cleanMobileStopEventItem,
  createMobileCheckinError,
  createMobileCheckinService,
  deriveMobileStopState,
  findMobileStopEvent,
  getMobileStopEventIdentity,
  isSameMobileStopEventIdentity,
  normalizeMobileTruckKey,
  toMobileStopEventResponse,
  validateMobileStopEventInput
};
