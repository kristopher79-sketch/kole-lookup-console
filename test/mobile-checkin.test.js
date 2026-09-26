'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMobileCheckinService,
  deriveMobileStopState,
  getMobileCheckinAvailableAt,
  validateMobileStopEventInput
} = require('../mobile-checkin');

const NOW = '2026-09-02T13:47:18.000Z';

test('early-arrival override is strictly boolean and only valid for In', () => {
  for (const earlyArrival of ['true', 'false', 1, null, {}]) {
    assert.throws(() => validateMobileStopEventInput(createInput({ earlyArrival })), { code: 'INVALID_EARLY_ARRIVAL' });
  }
  assert.throws(() => validateMobileStopEventInput(createInput({ action: 'out', earlyArrival: true })), { code: 'INVALID_EARLY_ARRIVAL' });
});

test('early pickup and delivery require explicit override, preserve its flag on replay, and allow checkout', async () => {
  for (const stop of ['pickup', 'delivery']) {
    const repository = createFakeRepository({ createDelayMs: 5 });
    const service = createMobileCheckinService({ repository, now: () => '2026-09-02T12:59:59.999Z' });
    await assert.rejects(service.recordEvent({ input: createInput({ stop }), driver: DRIVER, load: LOAD }), { code: 'CHECK_IN_TOO_EARLY' });
    const request = { input: createInput({ stop, earlyArrival: true }), driver: DRIVER, load: LOAD };
    const results = await Promise.all([service.recordEvent(request), service.recordEvent(request)]);
    assert.equal(repository.createCount, 1);
    assert.ok(results.every(result => result.event.earlyArrival === true));
    const replay = await service.recordEvent({ ...request, input: createInput({ stop }) });
    assert.equal(replay.event.earlyArrival, true);
    assert.equal(replay.idempotentReplay, true);
    const checkout = await service.recordEvent({ ...request, input: createInput({ stop, action: 'out' }) });
    assert.equal(checkout.event.earlyArrival, false);
  }
});

test('override never bypasses missing appointments, ownership, or an invalid server clock', async () => {
  for (const [load, driver, now, code] of [
    [{ ...LOAD, PickupTime: '' }, DRIVER, NOW, 'CHECK_IN_APPOINTMENT_UNAVAILABLE'],
    [LOAD, { truck: '999' }, NOW, 'LOAD_NOT_AVAILABLE'],
    [LOAD, DRIVER, 'invalid', 'EVENT_TIME_UNAVAILABLE'],
  ]) {
    const repository = createFakeRepository();
    const service = createMobileCheckinService({ repository, now: () => now });
    await assert.rejects(service.recordEvent({ input: createInput({ earlyArrival: true }), driver, load }), { code });
    assert.equal(repository.createCount, 0);
  }
});

test('normal check-ins and overrides reaching the server at opening are recorded as not early', async () => {
  for (const earlyArrival of [false, true]) {
    const repository = createFakeRepository();
    const service = createMobileCheckinService({ repository, now: () => '2026-09-02T13:00:00.000Z' });
    const result = await service.recordEvent({ input: createInput({ earlyArrival }), driver: DRIVER, load: LOAD });
    assert.equal(result.event.earlyArrival, false);
  }
});
const DRIVER = Object.freeze({ truck: '412', operator: 'John Smith' });
const LOAD = Object.freeze({
  id: '18437', bol: 'D198123', truck: '0412',
  PickupDate: '2026-09-02', PickupTime: '10:00', PickupAMPM: 'AM',
  DeliveryDate: '2026-09-02', DeliveryTime: '10:00', DeliveryAMPM: 'AM'
});

function createInput(overrides = {}) {
  return {
    loadId: LOAD.id,
    stop: 'pickup',
    stopSequence: 1,
    action: 'in',
    location: {
      status: 'Captured',
      latitude: 35.123456,
      longitude: -80.123456,
      accuracy: 12
    },
    ...overrides
  };
}

function createFakeRepository({ createDelayMs = 0 } = {}) {
  const events = [];
  let createCount = 0;

  return {
    events,
    get createCount() {
      return createCount;
    },
    async listEvents(_context, loadId) {
      return events.filter((event) => event.loadId === String(loadId));
    },
    async createEvent(_context, event) {
      createCount += 1;
      if (createDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      }
      const created = { ...event, id: String(events.length + 1) };
      events.push(created);
      return created;
    }
  };
}

function createService(repository) {
  return createMobileCheckinService({ repository, now: () => NOW });
}

test('no events means the next stop action is In', () => {
  const state = deriveMobileStopState([], 'Pickup', 1);

  assert.equal(state.nextAction, 'In');
  assert.equal(state.complete, false);
});

test('an In event means the next stop action is Out', () => {
  const state = deriveMobileStopState([
    { loadId: LOAD.id, stop: 'Pickup', stopSequence: 1, action: 'In', time: NOW }
  ], 'Pickup', 1);

  assert.equal(state.nextAction, 'Out');
  assert.equal(state.arrivedEvent.action, 'In');
  assert.equal(state.complete, false);
});

test('In and Out events make the stop complete', () => {
  const state = deriveMobileStopState([
    { loadId: LOAD.id, stop: 'Pickup', stopSequence: 1, action: 'In', time: NOW },
    { loadId: LOAD.id, stop: 'Pickup', stopSequence: 1, action: 'Out', time: '2026-09-02T15:12:00.000Z' }
  ], 'Pickup', 1);

  assert.equal(state.nextAction, null);
  assert.equal(state.complete, true);
  assert.equal(state.departedEvent.action, 'Out');
});

test('duplicate In is an idempotent replay and creates no second item', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  const first = await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });
  const replay = await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });

  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.event.id, first.event.id);
  assert.equal(repository.createCount, 1);
});

test('an existing In remains an idempotent replay if its appointment changes', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);
  await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });
  const replay = await service.recordEvent({
    input: createInput(), driver: DRIVER, load: { ...LOAD, PickupTime: '' }
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(repository.createCount, 1);
});

test('simultaneous duplicate In taps share one create operation', async () => {
  const repository = createFakeRepository({ createDelayMs: 10 });
  const service = createService(repository);

  const [first, second] = await Promise.all([
    service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD }),
    service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD })
  ]);

  assert.equal(repository.createCount, 1);
  assert.equal(first.idempotentReplay, false);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.event.id, first.event.id);
});

test('duplicate Out is an idempotent replay and creates no second item', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });
  const outInput = createInput({ action: 'out' });
  const firstOut = await service.recordEvent({ input: outInput, driver: DRIVER, load: LOAD });
  const replay = await service.recordEvent({ input: outInput, driver: DRIVER, load: LOAD });

  assert.equal(firstOut.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(repository.createCount, 2);
});

test('Out without a matching In is rejected', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  await assert.rejects(
    service.recordEvent({
      input: createInput({ action: 'out' }),
      driver: DRIVER,
      load: LOAD
    }),
    (error) => error.statusCode === 409 && error.code === 'CHECK_IN_REQUIRED'
  );
  assert.equal(repository.createCount, 0);
});

test('Pickup and Delivery ordering is independent', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });
  await service.recordEvent({
    input: createInput({ stop: 'delivery' }),
    driver: DRIVER,
    load: LOAD
  });

  assert.equal(repository.events.length, 2);
  assert.deepEqual(repository.events.map((event) => event.stop), ['Pickup', 'Delivery']);
});

test('a later stop without its own appointment cannot create an In event', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });
  await assert.rejects(
    service.recordEvent({ input: createInput({ stopSequence: 2 }), driver: DRIVER, load: LOAD }),
    (error) => error.code === 'CHECK_IN_APPOINTMENT_UNAVAILABLE'
  );

  assert.equal(repository.events.length, 1);
});

test('check-in opens at the exact Eastern appointment date and time minus one hour', async () => {
  const appointment = { ...LOAD, PickupDate: '2026-09-23', PickupTime: '8:00', PickupAMPM: 'AM' };
  assert.equal(getMobileCheckinAvailableAt(appointment, 'Pickup'), '2026-09-23T11:00:00.000Z');
  const repository = createFakeRepository();
  const service = createMobileCheckinService({ repository, now: () => '2026-09-23T00:00:00.000Z' });
  await assert.rejects(
    service.recordEvent({ input: createInput(), driver: DRIVER, load: appointment }),
    (error) => error.code === 'CHECK_IN_TOO_EARLY'
  );
  assert.equal(repository.createCount, 0);
  const atOpening = createMobileCheckinService({ repository, now: () => '2026-09-23T11:00:00.000Z' });
  await atOpening.recordEvent({ input: createInput(), driver: DRIVER, load: appointment });
  assert.equal(repository.createCount, 1);
});

test('missing and invalid appointment information blocks In without affecting existing Out', async () => {
  const missing = { ...LOAD, PickupTime: '' };
  const invalid = { ...LOAD, PickupDate: '2026-02-30' };
  for (const load of [missing, invalid]) {
    const repository = createFakeRepository();
    const service = createService(repository);
    await assert.rejects(
      service.recordEvent({ input: createInput(), driver: DRIVER, load }),
      (error) => error.code === 'CHECK_IN_APPOINTMENT_UNAVAILABLE'
    );
    assert.equal(repository.createCount, 0);
  }
  const repository = createFakeRepository();
  const service = createService(repository);
  await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });
  await service.recordEvent({ input: createInput({ action: 'out' }), driver: DRIVER, load: missing });
  assert.equal(repository.createCount, 2);
});

test('Eastern winter offset is used for the appointment window', () => {
  const winter = { ...LOAD, PickupDate: '2026-12-23', PickupTime: '8:00', PickupAMPM: 'AM' };
  assert.equal(getMobileCheckinAvailableAt(winter, 'Pickup'), '2026-12-23T12:00:00.000Z');
});

test('a midnight appointment opens on the previous calendar date', () => {
  const overnight = { ...LOAD, DeliveryDate: '2026-09-23', DeliveryTime: '12:30', DeliveryAMPM: 'AM' };
  assert.equal(getMobileCheckinAvailableAt(overnight, 'Delivery'), '2026-09-23T03:30:00.000Z');
});

test('invalid coordinates are rejected when location is Captured', () => {
  const invalidLocations = [
    { status: 'Captured', latitude: 91, longitude: 0, accuracy: 1 },
    { status: 'Captured', latitude: 0, longitude: -181, accuracy: 1 },
    { status: 'Captured', latitude: 0, longitude: 0, accuracy: -1 },
    { status: 'Captured', latitude: '35', longitude: 0, accuracy: 1 }
  ];

  invalidLocations.forEach((location) => {
    assert.throws(
      () => validateMobileStopEventInput(createInput({ location })),
      (error) => error.statusCode === 400
    );
  });
});

test('Denied, Unavailable, and Timeout create events without coordinates', async () => {
  for (const status of ['Denied', 'Unavailable', 'Timeout']) {
    const repository = createFakeRepository();
    const service = createService(repository);
    const result = await service.recordEvent({
      input: createInput({
        stopSequence: 1,
        location: { status }
      }),
      driver: DRIVER,
      load: LOAD
    });

    assert.equal(result.event.locationStatus, status);
    assert.equal(result.event.latitude, null);
    assert.equal(result.event.longitude, null);
    assert.equal(result.event.accuracy, null);
  }
});

test('a different driver or truck cannot write an event for the load', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  await assert.rejects(
    service.recordEvent({
      input: createInput(),
      driver: { truck: '999', operator: 'Wrong Driver' },
      load: LOAD
    }),
    (error) => error.statusCode === 404 && error.code === 'LOAD_NOT_AVAILABLE'
  );
  assert.equal(repository.createCount, 0);
});

test('GPS failure does not block event creation', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  const result = await service.recordEvent({
    input: createInput({ location: { status: 'Unavailable' } }),
    driver: DRIVER,
    load: LOAD
  });

  assert.equal(result.event.locationStatus, 'Unavailable');
  assert.equal(repository.createCount, 1);
});

test('BOL, truck, operator, and time are derived outside client input', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);
  const result = await service.recordEvent({
    input: createInput({
      bol: 'CLIENT-BOL',
      truck: '999',
      operator: 'Client Operator',
      time: '1999-01-01T00:00:00.000Z'
    }),
    driver: DRIVER,
    load: LOAD
  });

  assert.equal(result.event.bol, LOAD.bol);
  assert.equal(result.event.truck, DRIVER.truck);
  assert.equal(result.event.operator, DRIVER.operator);
  assert.equal(result.event.time, NOW);
});
