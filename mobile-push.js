'use strict';

const crypto = require('crypto');

const MOBILE_PUSH_DELIVERY_STATUSES = Object.freeze({
  PENDING: 'Pending',
  DELIVERED: 'Delivered',
  NO_ACTIVE_DRIVER: 'NoActiveDriver',
  TARGET_LOOKUP_PENDING: 'TargetLookupPending',
  NO_SUBSCRIPTION: 'NoSubscription',
  DELIVERY_FAILED: 'DeliveryFailed'
});

const MOBILE_PUSH_EVENT_TITLES = Object.freeze({
  NEW_LOAD: 'New Load Assigned',
  LOAD_UPDATED: 'Load Updated',
  LOAD_CANCELLED: 'Load Cancelled',
  LOAD_TONU: 'Load TONU',
  LOAD_REMOVED: 'Load Removed'
});

const MOBILE_PUSH_CHANGED_FIELD_LABELS = Object.freeze({
  Shipment_x0020_Origin: 'origin',
  Shipment_x0020_Destination: 'destination',
  Pickup_x0020_Offer_x0020_Date: 'pickup date',
  Pickup1PickupTime: 'pickup time',
  Pickup1AMorPM: 'pickup time',
  Pickup1Name: 'pickup location',
  Pickup1Address1: 'pickup location',
  Pickup1City: 'pickup location',
  Pickup2State: 'pickup location',
  Pickup2Zip: 'pickup location',
  Pickup1ContactName: 'pickup contact',
  Pickup1ContactNumber: 'pickup contact',
  Expected_x0020_Delivery_x0020_Da: 'delivery date',
  Delivery1Time: 'delivery time',
  Delivery1AMorPM: 'delivery time',
  Delivery1Name: 'delivery location',
  Deliver1Address1: 'delivery location',
  Delivery1City: 'delivery location',
  Delivery1State: 'delivery location',
  Delivery1Zip: 'delivery location',
  Delivery1ContactName: 'delivery contact',
  Delivery1ContactNumber: 'delivery contact',
  Freight_x0020_Description: 'freight details',
  Item1QTY: 'freight details',
  Item1Description: 'freight details',
  TotalPieces: 'freight details',
  Item1Serial: 'freight details',
  Item1Dimensions: 'freight dimensions',
  Length: 'freight dimensions',
  Width: 'freight dimensions',
  Height: 'freight dimensions',
  EstimatedWeight: 'estimated weight',
  Route: 'route',
  Team_x0020_Required: 'team requirement',
  No_x002e_ofTarpsNeeded: 'tarp requirement',
  OrderNotes: 'order notes'
});
const MOBILE_PUSH_MAX_SUBSCRIPTIONS_PER_DRIVER = 10;

function createMobilePushError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function cleanMobilePushText(value, maxLength = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function validateMobilePushEndpoint(value) {
  const endpoint = cleanMobilePushText(value, 4096);

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    throw createMobilePushError(
      'The browser push subscription endpoint is invalid.',
      400,
      'MOBILE_PUSH_INVALID_ENDPOINT'
    );
  }

  return endpoint;
}

function validateMobilePushKey(value, label, minLength) {
  const key = String(value || '').trim();

  if (
    key.length < minLength ||
    key.length > 1024 ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(key)
  ) {
    throw createMobilePushError(
      `The browser push subscription ${label} key is invalid.`,
      400,
      'MOBILE_PUSH_INVALID_KEYS'
    );
  }

  return key;
}

function normalizeMobilePushSubscription(input = {}) {
  const keys = input?.keys && typeof input.keys === 'object' ? input.keys : {};

  return {
    endpoint: validateMobilePushEndpoint(input.endpoint),
    keys: {
      p256dh: validateMobilePushKey(keys.p256dh, 'p256dh', 40),
      auth: validateMobilePushKey(keys.auth, 'auth', 8)
    }
  };
}

function createMobilePushSubscriptionId(endpoint) {
  const normalizedEndpoint = validateMobilePushEndpoint(endpoint);
  return `kps_${crypto.createHash('sha256').update(normalizedEndpoint).digest('hex').slice(0, 40)}`;
}

function assertAuthenticatedMobileDriver(driver = {}) {
  const driverRosterItemId = cleanMobilePushText(driver.id, 100);
  const truckNumber = cleanMobilePushText(driver.truck, 100);

  if (!driverRosterItemId || !truckNumber) {
    throw createMobilePushError(
      'The authenticated Mobile driver identity is incomplete.',
      401,
      'MOBILE_PUSH_DRIVER_REQUIRED'
    );
  }

  return { driverRosterItemId, truckNumber };
}

function assertMobilePushSubscriptionOwnership(subscription, driverRosterItemId) {
  if (
    subscription &&
    String(subscription.driverRosterItemId || '') !== String(driverRosterItemId || '')
  ) {
    throw createMobilePushError(
      'This push subscription belongs to a different Mobile session.',
      403,
      'MOBILE_PUSH_SUBSCRIPTION_OWNERSHIP'
    );
  }
}

function formatChangedFieldList(changedFields = []) {
  const labels = Array.from(new Set(
    changedFields
      .map((field) => MOBILE_PUSH_CHANGED_FIELD_LABELS[field])
      .filter(Boolean)
  ));

  if (labels.length === 0) return 'Load details changed. Tap to review.';
  if (labels.length === 1) return `${labels[0][0].toUpperCase()}${labels[0].slice(1)} changed. Tap to review.`;
  if (labels.length === 2) return `${labels[0][0].toUpperCase()}${labels[0].slice(1)} and ${labels[1]} changed. Tap to review.`;

  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)} changed. Tap to review.`
    .replace(/^./, (value) => value.toUpperCase());
}

function buildMobilePushBody(event = {}) {
  if (event.eventType === 'NEW_LOAD') {
    const route = [event.origin, event.destination].map((value) => cleanMobilePushText(value, 120)).filter(Boolean);
    return route.length === 2 ? `${route[0]} → ${route[1]}` : 'A new load is ready to review.';
  }

  if (event.loadDetailsAdded === true) {
    return 'Open Kole Connect to review this load.';
  }

  if (event.eventType === 'LOAD_UPDATED') {
    return formatChangedFieldList(Array.isArray(event.changedFields) ? event.changedFields : []);
  }

  if (event.eventType === 'LOAD_CANCELLED') return 'This load was cancelled and is no longer active.';
  if (event.eventType === 'LOAD_TONU') return 'This load was marked TONU. Tap to review.';
  if (event.eventType === 'LOAD_REMOVED') return 'This load is no longer assigned to your truck.';
  return 'A load changed. Tap to review.';
}

function buildMobilePushPayload(event = {}) {
  const loadId = cleanMobilePushText(event.loadId, 100);
  const eventType = cleanMobilePushText(event.eventType, 50);

  return {
    eventType,
    title: event.loadDetailsAdded === true
      ? 'Load Details Have Been Added'
      : MOBILE_PUSH_EVENT_TITLES[eventType] || 'Kole Connect Mobile',
    body: buildMobilePushBody(event),
    loadId,
    bidId: cleanMobilePushText(event.bidId, 100),
    truckNumber: cleanMobilePushText(event.truckNumber, 100),
    changedFields: Array.isArray(event.changedFields) ? event.changedFields.slice(0, 50) : [],
    url: loadId ? `/?loadId=${encodeURIComponent(loadId)}` : '/'
  };
}

function getMobilePushProviderError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const expired = statusCode === 404 || statusCode === 410;

  return {
    statusCode,
    expired,
    message: expired
      ? `Push subscription expired (${statusCode}).`
      : statusCode
        ? `Push delivery failed (${statusCode}).`
        : 'Push delivery failed.'
  };
}

function buildMobilePushPublicConfiguration({ configured = false, publicKey = '' } = {}) {
  return {
    configured: Boolean(configured && String(publicKey || '').trim()),
    publicKey: configured ? String(publicKey || '').trim() : ''
  };
}

function createMobilePushService({ repository, sendNotification, now = () => new Date().toISOString() }) {
  if (!repository) throw new Error('A Mobile Push repository is required.');

  async function subscribe({ driver, subscription, userAgent = '', platform = '' }) {
    const identity = assertAuthenticatedMobileDriver(driver);
    const normalized = normalizeMobilePushSubscription(subscription);
    const subscriptionId = createMobilePushSubscriptionId(normalized.endpoint);
    const existing = await repository.getSubscriptionById(subscriptionId);

    assertMobilePushSubscriptionOwnership(existing, identity.driverRosterItemId);

    const timestamp = now();
    const saved = await repository.saveSubscription({
      subscriptionId,
      driverRosterItemId: identity.driverRosterItemId,
      truckNumber: identity.truckNumber,
      endpoint: normalized.endpoint,
      p256dh: normalized.keys.p256dh,
      auth: normalized.keys.auth,
      userAgent: cleanMobilePushText(userAgent, 500),
      platform: cleanMobilePushText(platform, 100),
      active: true,
      createdAt: existing?.createdAt || timestamp,
      lastSeenAt: timestamp,
      disabledAt: null,
      lastError: ''
    }, existing || null);

    assertMobilePushSubscriptionOwnership(saved, identity.driverRosterItemId);

    return {
      subscriptionId,
      created: !existing,
      active: true
    };
  }

  async function unsubscribe({ driver, endpoint }) {
    const identity = assertAuthenticatedMobileDriver(driver);
    const subscriptionId = createMobilePushSubscriptionId(endpoint);
    const existing = await repository.getSubscriptionById(subscriptionId);

    if (!existing) {
      return { subscriptionId, deactivated: false, idempotentReplay: true };
    }

    assertMobilePushSubscriptionOwnership(existing, identity.driverRosterItemId);

    await repository.deactivateSubscription(existing, {
      active: false,
      disabledAt: now(),
      lastSeenAt: now()
    });

    return { subscriptionId, deactivated: true, idempotentReplay: false };
  }

  async function deliverEvent(event = {}) {
    if (event.deliveryStatus !== MOBILE_PUSH_DELIVERY_STATUSES.PENDING) {
      return {
        attempted: false,
        skipped: true,
        deliveryStatus: event.deliveryStatus || ''
      };
    }

    if (typeof sendNotification !== 'function') {
      return {
        attempted: false,
        skipped: true,
        reason: 'push_not_configured',
        deliveryStatus: MOBILE_PUSH_DELIVERY_STATUSES.PENDING
      };
    }

    const driverRosterItemId = cleanMobilePushText(event.driverRosterItemId, 100);
    const subscriptions = driverRosterItemId
      ? await repository.listActiveSubscriptions(driverRosterItemId)
      : [];
    const boundedSubscriptions = subscriptions.slice(0, MOBILE_PUSH_MAX_SUBSCRIPTIONS_PER_DRIVER);

    if (boundedSubscriptions.length === 0) {
      await repository.updateEventDelivery(event.itemId, {
        deliveryStatus: MOBILE_PUSH_DELIVERY_STATUSES.NO_SUBSCRIPTION,
        deliveredAt: null
      });

      return {
        attempted: false,
        deliveredCount: 0,
        failedCount: 0,
        deliveryStatus: MOBILE_PUSH_DELIVERY_STATUSES.NO_SUBSCRIPTION
      };
    }

    const payload = buildMobilePushPayload(event);
    const payloadText = JSON.stringify(payload);
    const outcomes = await Promise.all(boundedSubscriptions.map(async (subscription) => {
      try {
        await sendNotification({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        }, payloadText, event);

        return { subscription, success: true };
      } catch (error) {
        return {
          subscription,
          success: false,
          providerError: getMobilePushProviderError(error)
        };
      }
    }));
    const deliveredAt = now();

    await Promise.allSettled(outcomes.map((outcome) => {
      if (outcome.success) {
        return repository.updateSubscriptionDelivery(outcome.subscription, {
          lastDeliveredAt: deliveredAt,
          lastError: ''
        });
      }

      return repository.updateSubscriptionDelivery(outcome.subscription, {
        active: outcome.providerError.expired ? false : outcome.subscription.active !== false,
        disabledAt: outcome.providerError.expired ? deliveredAt : outcome.subscription.disabledAt || null,
        lastError: outcome.providerError.message
      });
    }));

    const deliveredCount = outcomes.filter((outcome) => outcome.success).length;
    const deliveryStatus = deliveredCount > 0
      ? MOBILE_PUSH_DELIVERY_STATUSES.DELIVERED
      : MOBILE_PUSH_DELIVERY_STATUSES.DELIVERY_FAILED;

    await repository.updateEventDelivery(event.itemId, {
      deliveryStatus,
      deliveredAt: deliveredCount > 0 ? deliveredAt : null
    });

    return {
      attempted: true,
      deliveredCount,
      failedCount: outcomes.length - deliveredCount,
      deliveryStatus
    };
  }

  return { subscribe, unsubscribe, deliverEvent };
}

module.exports = {
  MOBILE_PUSH_DELIVERY_STATUSES,
  buildMobilePushPayload,
  buildMobilePushPublicConfiguration,
  createMobilePushError,
  createMobilePushService,
  createMobilePushSubscriptionId,
  getMobilePushProviderError,
  normalizeMobilePushSubscription
};
