'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMobilePushPayload,
  buildMobilePushPublicConfiguration,
  createMobilePushService,
  createMobilePushSubscriptionId
} = require('../mobile-push');

const DRIVER_A = Object.freeze({ id: 'roster-a', truck: '123' });
const DRIVER_B = Object.freeze({ id: 'roster-b', truck: '456' });
const NOW = '2026-08-24T15:00:00.000Z';

function createSubscription(endpointSuffix = 'device-a') {
  return {
    endpoint: `https://push.example.test/${endpointSuffix}`,
    keys: {
      p256dh: 'B'.repeat(65),
      auth: 'a'.repeat(22)
    }
  };
}

function createFakeRepository() {
  const subscriptions = new Map();
  const events = new Map();

  return {
    subscriptions,
    events,
    async getSubscriptionById(subscriptionId) {
      return subscriptions.get(subscriptionId) || null;
    },
    async saveSubscription(record, existing) {
      const saved = { ...existing, ...record, itemId: existing?.itemId || `sub-${subscriptions.size + 1}` };
      subscriptions.set(record.subscriptionId, saved);
      return saved;
    },
    async deactivateSubscription(existing, patch) {
      subscriptions.set(existing.subscriptionId, { ...existing, ...patch });
    },
    async listActiveSubscriptions(driverRosterItemId) {
      return [...subscriptions.values()].filter((subscription) => (
        subscription.driverRosterItemId === driverRosterItemId && subscription.active !== false
      ));
    },
    async updateSubscriptionDelivery(existing, patch) {
      subscriptions.set(existing.subscriptionId, { ...existing, ...patch });
    },
    async updateEventDelivery(itemId, patch) {
      events.set(itemId, { ...(events.get(itemId) || {}), ...patch });
    }
  };
}

function createPendingEvent(overrides = {}) {
  return {
    itemId: 'event-1',
    eventId: 'kne-event-1',
    eventType: 'LOAD_UPDATED',
    deliveryStatus: 'Pending',
    driverRosterItemId: DRIVER_A.id,
    truckNumber: DRIVER_A.truck,
    loadId: '42',
    bidId: 'BID-42',
    origin: 'Middletown, CT',
    destination: 'Foley, AL',
    changedFields: ['Pickup1PickupTime', 'OrderNotes'],
    ...overrides
  };
}

test('subscription creation derives ownership from the authenticated driver', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({ repository, now: () => NOW });
  const subscription = createSubscription();
  const result = await service.subscribe({
    driver: DRIVER_A,
    subscription,
    userAgent: 'Test Browser',
    platform: 'Test'
  });
  const stored = repository.subscriptions.get(result.subscriptionId);

  assert.equal(result.created, true);
  assert.equal(stored.driverRosterItemId, DRIVER_A.id);
  assert.equal(stored.truckNumber, DRIVER_A.truck);
  assert.equal(stored.createdAt, NOW);
  assert.equal(stored.lastSeenAt, NOW);
  assert.equal(stored.active, true);
});

test('subscription re-registration upserts without changing CreatedAt', async () => {
  const repository = createFakeRepository();
  let timestamp = '2026-08-24T14:00:00.000Z';
  const service = createMobilePushService({ repository, now: () => timestamp });
  const subscription = createSubscription();

  await service.subscribe({ driver: DRIVER_A, subscription });
  timestamp = NOW;
  const result = await service.subscribe({
    driver: DRIVER_A,
    subscription: {
      ...subscription,
      keys: { ...subscription.keys, auth: 'b'.repeat(22) }
    }
  });
  const stored = repository.subscriptions.get(result.subscriptionId);

  assert.equal(result.created, false);
  assert.equal(stored.createdAt, '2026-08-24T14:00:00.000Z');
  assert.equal(stored.lastSeenAt, NOW);
  assert.equal(stored.auth, 'b'.repeat(22));
  assert.equal(stored.disabledAt, null);
  assert.equal(stored.lastError, '');
});

test('a driver cannot claim or disable another driver subscription', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({ repository, now: () => NOW });
  const subscription = createSubscription();

  await service.subscribe({ driver: DRIVER_A, subscription });

  await assert.rejects(
    service.subscribe({ driver: DRIVER_B, subscription }),
    (error) => error.statusCode === 403 && error.code === 'MOBILE_PUSH_SUBSCRIPTION_OWNERSHIP'
  );
  await assert.rejects(
    service.unsubscribe({ driver: DRIVER_B, endpoint: subscription.endpoint }),
    (error) => error.statusCode === 403 && error.code === 'MOBILE_PUSH_SUBSCRIPTION_OWNERSHIP'
  );
});

test('unsubscribe deactivates the authenticated device and preserves history', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({ repository, now: () => NOW });
  const subscription = createSubscription();
  const subscribed = await service.subscribe({ driver: DRIVER_A, subscription });
  const result = await service.unsubscribe({ driver: DRIVER_A, endpoint: subscription.endpoint });
  const stored = repository.subscriptions.get(subscribed.subscriptionId);

  assert.equal(result.deactivated, true);
  assert.equal(stored.active, false);
  assert.equal(stored.disabledAt, NOW);
  assert.equal(stored.endpoint, subscription.endpoint);
});

test('one driver can register multiple devices', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({ repository, now: () => NOW });

  await service.subscribe({ driver: DRIVER_A, subscription: createSubscription('device-a') });
  await service.subscribe({ driver: DRIVER_A, subscription: createSubscription('device-b') });

  assert.equal(repository.subscriptions.size, 2);
  assert.equal((await repository.listActiveSubscriptions(DRIVER_A.id)).length, 2);
});

test('Pending event with a subscription becomes Delivered', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({
    repository,
    sendNotification: async () => ({ statusCode: 201 }),
    now: () => NOW
  });
  await service.subscribe({ driver: DRIVER_A, subscription: createSubscription() });

  const result = await service.deliverEvent(createPendingEvent());

  assert.equal(result.deliveryStatus, 'Delivered');
  assert.equal(result.deliveredCount, 1);
  assert.deepEqual(repository.events.get('event-1'), {
    deliveryStatus: 'Delivered',
    deliveredAt: NOW
  });
});

test('push payload keeps the required fields and uses driver-friendly change wording', () => {
  const payload = buildMobilePushPayload(createPendingEvent());

  assert.deepEqual(Object.keys(payload), [
    'eventType',
    'title',
    'body',
    'loadId',
    'bidId',
    'truckNumber',
    'changedFields',
    'url'
  ]);
  assert.equal(payload.title, 'Load Updated');
  assert.match(payload.body, /Pickup time and order notes changed/);
  assert.equal(payload.body.includes('Pickup1PickupTime'), false);
  assert.equal(payload.url, '/?loadId=42');
});

test('Pending event without a subscription becomes NoSubscription', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({
    repository,
    sendNotification: async () => ({ statusCode: 201 }),
    now: () => NOW
  });

  const result = await service.deliverEvent(createPendingEvent());

  assert.equal(result.deliveryStatus, 'NoSubscription');
  assert.equal(repository.events.get('event-1').deliveryStatus, 'NoSubscription');
});

test('expired subscription is disabled and the event becomes DeliveryFailed', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({
    repository,
    sendNotification: async () => {
      const error = new Error('gone');
      error.statusCode = 410;
      throw error;
    },
    now: () => NOW
  });
  const subscribed = await service.subscribe({ driver: DRIVER_A, subscription: createSubscription() });

  const result = await service.deliverEvent(createPendingEvent());
  const stored = repository.subscriptions.get(subscribed.subscriptionId);

  assert.equal(result.deliveryStatus, 'DeliveryFailed');
  assert.equal(stored.active, false);
  assert.equal(stored.disabledAt, NOW);
  assert.equal(stored.lastError, 'Push subscription expired (410).');
});

test('all non-expired push attempts failing produces DeliveryFailed', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({
    repository,
    sendNotification: async () => {
      const error = new Error('provider unavailable');
      error.statusCode = 503;
      throw error;
    },
    now: () => NOW
  });
  await service.subscribe({ driver: DRIVER_A, subscription: createSubscription() });

  const result = await service.deliverEvent(createPendingEvent());

  assert.equal(result.deliveryStatus, 'DeliveryFailed');
  assert.equal(repository.events.get('event-1').deliveredAt, null);
});

test('one successful device makes a multi-device event Delivered', async () => {
  const repository = createFakeRepository();
  const service = createMobilePushService({
    repository,
    sendNotification: async (subscription) => {
      if (subscription.endpoint.endsWith('device-b')) throw Object.assign(new Error('failed'), { statusCode: 503 });
      return { statusCode: 201 };
    },
    now: () => NOW
  });
  await service.subscribe({ driver: DRIVER_A, subscription: createSubscription('device-a') });
  await service.subscribe({ driver: DRIVER_A, subscription: createSubscription('device-b') });

  const result = await service.deliverEvent(createPendingEvent());

  assert.equal(result.deliveryStatus, 'Delivered');
  assert.equal(result.deliveredCount, 1);
  assert.equal(result.failedCount, 1);
});

test('one delivery attempt is bounded to ten active devices', async () => {
  const repository = createFakeRepository();
  let sendCount = 0;
  const service = createMobilePushService({
    repository,
    sendNotification: async () => {
      sendCount += 1;
    },
    now: () => NOW
  });

  for (let index = 0; index < 12; index += 1) {
    await service.subscribe({
      driver: DRIVER_A,
      subscription: createSubscription(`device-${index}`)
    });
  }

  const result = await service.deliverEvent(createPendingEvent());

  assert.equal(result.deliveryStatus, 'Delivered');
  assert.equal(result.deliveredCount, 10);
  assert.equal(sendCount, 10);
});

test('an already-Delivered duplicate event is never resent', async () => {
  const repository = createFakeRepository();
  let sendCount = 0;
  const service = createMobilePushService({
    repository,
    sendNotification: async () => {
      sendCount += 1;
    },
    now: () => NOW
  });
  await service.subscribe({ driver: DRIVER_A, subscription: createSubscription() });

  const result = await service.deliverEvent(createPendingEvent({ deliveryStatus: 'Delivered' }));

  assert.equal(result.skipped, true);
  assert.equal(sendCount, 0);
});

test('SubscriptionID is deterministic by device endpoint, not truck number', () => {
  const endpoint = createSubscription().endpoint;
  assert.equal(createMobilePushSubscriptionId(endpoint), createMobilePushSubscriptionId(endpoint));
});

test('public VAPID configuration never returns the private key', () => {
  const response = buildMobilePushPublicConfiguration({
    configured: true,
    publicKey: 'public-key',
    privateKey: 'never-return-this'
  });

  assert.deepEqual(response, { configured: true, publicKey: 'public-key' });
  assert.equal(JSON.stringify(response).includes('never-return-this'), false);
});
