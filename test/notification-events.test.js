'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DRIVER_IMPACTING_FIELDS,
  createBidListingNotificationEvents,
  findActiveMobileDriverForTruck
} = require('../notification-events');

const SOURCE = Object.freeze({
  sourceListId: 'bid-list',
  sourceItemId: '42',
  sourceModified: '2026-08-24T12:00:00Z',
  sourceVersion: '7.0',
  createdAt: '2026-08-24T12:00:01Z'
});

function item(fields, overrides = {}) {
  return {
    id: '42',
    lastModifiedDateTime: SOURCE.sourceModified,
    fields: {
      BidID: 'BID-42',
      BOLNumber_x0028_Won_x0029_: 'BOL-42',
      Shipment_x0020_Origin: 'Middletown, CT',
      Shipment_x0020_Destination: 'Foley, AL',
      Pickup_x0020_Offer_x0020_Date: '2026-08-25T12:00:00Z',
      Expected_x0020_Delivery_x0020_Da: '2026-08-27T12:00:00Z',
      ...fields
    },
    ...overrides
  };
}

function detect(previousFields, currentFields, sourceOverrides = {}) {
  return createBidListingNotificationEvents({
    ...SOURCE,
    ...sourceOverrides,
    previousItem: previousFields === null ? null : item(previousFields),
    currentItem: item(currentFields)
  });
}

test('new Won load assigned to a truck creates NEW_LOAD', () => {
  const events = detect(
    { Status: 'Quote', Truck_x0020_Number: '123' },
    { Status: 'Won', Truck_x0020_Number: '123' }
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'NEW_LOAD');
  assert.equal(events[0].truckNumber, '123');
  assert.equal(events[0].loadId, '42');
});

test('newly created Won item with an assigned truck creates NEW_LOAD', () => {
  const events = detect(null, {
    Status: 'Won',
    Truck_x0020_Number: '123',
    Pickup1PickupTime: '8:00',
    Pickup1AMorPM: 'AM',
    Delivery1Time: '4:30 PM'
  });

  assert.deepEqual(events.map((event) => event.eventType), ['NEW_LOAD']);
  assert.deepEqual(events[0].changedFields, ['Status', 'Truck_x0020_Number']);
  assert.equal(events[0].pickupTime, '8:00 AM');
  assert.equal(events[0].deliveryTime, '4:30 PM');
});

test('Won order without a truck creates no event', () => {
  assert.deepEqual(detect(
    { Status: 'Quote', Truck_x0020_Number: '-' },
    { Status: 'Won', Truck_x0020_Number: '-' }
  ), []);
});

test('truck populated on an unfinished bid creates no event', () => {
  assert.deepEqual(detect(
    { Status: 'Quote', Truck_x0020_Number: '-' },
    { Status: 'Quote', Truck_x0020_Number: '123' }
  ), []);
});

test('truck assigned after an order is already Won creates NEW_LOAD', () => {
  const events = detect(
    { Status: 'Won', Truck_x0020_Number: '-' },
    { Status: 'Won', Truck_x0020_Number: '456' }
  );

  assert.deepEqual(events.map((event) => event.eventType), ['NEW_LOAD']);
  assert.equal(events[0].truckNumber, '456');
});

test('Won order cancellation targets the previously assigned truck', () => {
  const events = detect(
    { Status: 'Won', Truck_x0020_Number: '123' },
    { Status: 'CAN', Truck_x0020_Number: '-' }
  );

  assert.equal(events[0].eventType, 'LOAD_CANCELLED');
  assert.equal(events[0].truckNumber, '123');
});

test('TONU remains distinct from cancellation', () => {
  const events = detect(
    { Status: 'Won', Truck_x0020_Number: '123' },
    { Status: 'TONU', Truck_x0020_Number: '123' }
  );

  assert.equal(events[0].eventType, 'LOAD_TONU');
});

test('pickup time edit creates one LOAD_UPDATED event', () => {
  const events = detect(
    { Status: 'Won', Truck_x0020_Number: '123', Pickup1PickupTime: '8:00' },
    { Status: 'Won', Truck_x0020_Number: '123', Pickup1PickupTime: '9:00' }
  );

  assert.equal(events[0].eventType, 'LOAD_UPDATED');
  assert.deepEqual(events[0].changedFields, ['Pickup1PickupTime']);
});

test('registration field fills stay silent until a BOL is assigned', () => {
  const events = detect(
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      BOLNumber_x0028_Won_x0029_: '',
      No_x002e_ofTarpsNeeded: ''
    },
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      BOLNumber_x0028_Won_x0029_: '',
      No_x002e_ofTarpsNeeded: 2
    }
  );

  assert.deepEqual(events, []);
});

test('a real edit to existing Bid-ID-only load details still notifies', () => {
  const events = detect(
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      BOLNumber_x0028_Won_x0029_: '',
      Pickup1PickupTime: '8:00'
    },
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      BOLNumber_x0028_Won_x0029_: '',
      Pickup1PickupTime: '9:00'
    }
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'LOAD_UPDATED');
  assert.deepEqual(events[0].changedFields, ['Pickup1PickupTime']);
});

test('bid-to-BOL registration creates one consolidated load-details event', () => {
  const events = detect(
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      BOLNumber_x0028_Won_x0029_: '',
      No_x002e_ofTarpsNeeded: ''
    },
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      BOLNumber_x0028_Won_x0029_: 'BOL-42',
      No_x002e_ofTarpsNeeded: 2
    }
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'LOAD_UPDATED');
  assert.equal(events[0].loadDetailsAdded, true);
  assert.equal(events[0].bolNumber, 'BOL-42');
  assert.deepEqual(events[0].changedFields, ['No_x002e_ofTarpsNeeded']);
});

test('registration window suppresses follow-up detail-fill revisions', () => {
  const events = detect(
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      Pickup1PickupTime: '',
      Pickup1Name: ''
    },
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      Pickup1PickupTime: '8:00',
      Pickup1Name: 'Kole Terminal'
    },
    { registrationWindowActive: true }
  );

  assert.deepEqual(events, []);
});

test('delivery date edit compares business date rather than timestamp suffix', () => {
  const unchanged = detect(
    { Status: 'Won', Truck_x0020_Number: '123', Expected_x0020_Delivery_x0020_Da: '2026-08-27T04:00:00Z' },
    { Status: 'Won', Truck_x0020_Number: '123', Expected_x0020_Delivery_x0020_Da: '2026-08-27T12:00:00Z' }
  );
  const changed = detect(
    { Status: 'Won', Truck_x0020_Number: '123', Expected_x0020_Delivery_x0020_Da: '2026-08-27T12:00:00Z' },
    { Status: 'Won', Truck_x0020_Number: '123', Expected_x0020_Delivery_x0020_Da: '2026-08-28T12:00:00Z' }
  );

  assert.deepEqual(unchanged, []);
  assert.deepEqual(changed[0].changedFields, ['Expected_x0020_Delivery_x0020_Da']);
});

test('Order Notes rich-text edit creates LOAD_UPDATED', () => {
  const events = detect(
    { Status: 'Won', Truck_x0020_Number: '123', OrderNotes: '<p>Call on arrival</p>' },
    { Status: 'Won', Truck_x0020_Number: '123', OrderNotes: '<p>Call 30 minutes before arrival</p>' }
  );

  assert.deepEqual(events[0].changedFields, ['OrderNotes']);
});

test('freight details edit creates one aggregated LOAD_UPDATED event', () => {
  const events = detect(
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      Freight_x0020_Description: 'Machine',
      Item1QTY: 1,
      EstimatedWeight: 1000
    },
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      Freight_x0020_Description: 'Machine parts',
      Item1QTY: 2,
      EstimatedWeight: 1200
    }
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changedFields, [
    'Freight_x0020_Description',
    'Item1QTY',
    'EstimatedWeight'
  ]);
});

test('administrative-only changes create no event', () => {
  assert.deepEqual(detect(
    { Status: 'Won', Truck_x0020_Number: '123', WonNoticeSent: false },
    { Status: 'Won', Truck_x0020_Number: '123', WonNoticeSent: true }
  ), []);
});

test('truck reassignment creates LOAD_REMOVED for old and NEW_LOAD for new', () => {
  const events = detect(
    { Status: 'Won', Truck_x0020_Number: '123', Pickup1PickupTime: '8:00' },
    { Status: 'Won', Truck_x0020_Number: '456', Pickup1PickupTime: '9:00' }
  );

  assert.deepEqual(events.map((event) => [event.eventType, event.truckNumber]), [
    ['LOAD_REMOVED', '123'],
    ['NEW_LOAD', '456']
  ]);
});

test('truck removal without a replacement creates LOAD_REMOVED', () => {
  const events = detect(
    { Status: 'Won', Truck_x0020_Number: '123' },
    { Status: 'Won', Truck_x0020_Number: '-' }
  );

  assert.deepEqual(events.map((event) => event.eventType), ['LOAD_REMOVED']);
  assert.equal(events[0].truckNumber, '123');
});

test('multiple meaningful fields remain one event with an exact allowlisted summary', () => {
  const events = detect(
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      Pickup1PickupTime: '8:00',
      Pickup1ContactNumber: '555-0100',
      OrderNotes: 'Old note'
    },
    {
      Status: 'Won',
      Truck_x0020_Number: '123',
      Pickup1PickupTime: '9:00',
      Pickup1ContactNumber: '555-0199',
      OrderNotes: 'New note'
    }
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changedFields, [
    'Pickup1PickupTime',
    'Pickup1ContactNumber',
    'OrderNotes'
  ]);
});

test('same SharePoint revision produces the same deterministic event ID', () => {
  const first = detect(
    { Status: 'Quote', Truck_x0020_Number: '123' },
    { Status: 'Won', Truck_x0020_Number: '123' }
  );
  const replay = detect(
    { Status: 'Quote', Truck_x0020_Number: '123' },
    { Status: 'Won', Truck_x0020_Number: '123' }
  );

  assert.equal(first[0].eventId, replay[0].eventId);
});

test('driver targeting uses the active Mobile authentication roster mapping', () => {
  const roster = [
    { id: 'inactive', truck: '123', status: 'Inactive', pin: '1111' },
    { id: 'disabled', truck: '123', status: 'Active', pin: '' },
    { id: 'active', truck: '0123', status: 'Active', pin: '2222' }
  ];

  assert.equal(findActiveMobileDriverForTruck(roster, '123')?.id, 'active');
  assert.equal(findActiveMobileDriverForTruck(roster, '999'), null);
});

test('allowlist contains only intentional driver-impacting fields', () => {
  assert.ok(DRIVER_IMPACTING_FIELDS.includes('OrderNotes'));
  assert.ok(DRIVER_IMPACTING_FIELDS.includes('Pickup2State'));
  assert.ok(DRIVER_IMPACTING_FIELDS.includes('Deliver1Address1'));
  assert.equal(DRIVER_IMPACTING_FIELDS.includes('WonNoticeSent'), false);
  assert.equal(DRIVER_IMPACTING_FIELDS.includes('Processed'), false);
});
