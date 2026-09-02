'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMobileCheckinService,
  deriveMobileStopState,
  validateMobileStopEventInput
} = require('../mobile-checkin');

const NOW = '2026-09-02T13:47:18.000Z';
const DRIVER = Object.freeze({ truck: '412', operator: 'John Smith' });
const LOAD = Object.freeze({ id: '18437', bol: 'D198123', truck: '0412' });

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

test('Stop Sequence participates in event identity and ordering', async () => {
  const repository = createFakeRepository();
  const service = createService(repository);

  await service.recordEvent({ input: createInput(), driver: DRIVER, load: LOAD });
  await service.recordEvent({
    input: createInput({ stopSequence: 2 }),
    driver: DRIVER,
    load: LOAD
  });
  await service.recordEvent({
    input: createInput({ stopSequence: 2, action: 'out' }),
    driver: DRIVER,
    load: LOAD
  });

  assert.equal(repository.events.length, 3);
  assert.deepEqual(repository.events.map((event) => event.stopSequence), [1, 2, 2]);
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
  for (const [index, status] of ['Denied', 'Unavailable', 'Timeout'].entries()) {
    const repository = createFakeRepository();
    const service = createService(repository);
    const result = await service.recordEvent({
      input: createInput({
        stopSequence: index + 1,
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
