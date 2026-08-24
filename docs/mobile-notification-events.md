# Kole Connect Mobile Web Push notifications

Kole Connect now records each qualifying Bid Listing change as a durable SharePoint event and then attempts standards-based Web Push delivery to the authenticated driver's active devices. Power Automate remains the only production entry point for Bid Listing changes.

## End-to-end flow

1. SharePoint creates or modifies a **Bid Listing** item.
2. Power Automate sends an authenticated `POST` to `/mobile/notification-events/bid-listing-change`.
3. The server reads the requested/current SharePoint version and its immediately preceding version.
4. The existing transition rules produce zero or more deterministic notification events.
5. Each event is written to **Mobile Notification Events** before any push attempt.
6. A newly persisted `Pending` event resolves the active Mobile driver and that driver's active device subscriptions.
7. The server sends a bounded Web Push attempt and audits the event and subscription results in SharePoint.
8. A notification tap opens Kole Connect Mobile at `/?loadId=<LoadID>`; the client uses the existing targeted-load path.

The quote engine, contract-lane booking, and operations-console `/record/:id` route do not invoke notification delivery directly. This avoids duplicate delivery alongside the canonical Power Automate flow.

## Server configuration

The following environment variables are required in the deployed server environment:

| Variable | Purpose |
|---|---|
| `MOBILE_NOTIFICATION_EVENTS_LIST_ID` | Durable event list ID |
| `MOBILE_NOTIFICATION_EVENTS_SITE_ID` | Optional event-list site override; defaults to `SITE_ID` |
| `MOBILE_NOTIFICATION_INGEST_SECRET` | Shared secret used only by the Power Automate ingestion request |
| `MOBILE_PUSH_SUBSCRIPTIONS_LIST_ID` | Push Subscriptions list ID on `SITE_ID` |
| `VAPID_PUBLIC_KEY` | Browser-safe application server public key |
| `VAPID_PRIVATE_KEY` | Server-only VAPID signing key |
| `VAPID_SUBJECT` | VAPID contact subject, such as a `mailto:` address |

The private VAPID key is configured only in the Node process. The authenticated public-key endpoint returns `configured` and `publicKey`; it never returns the private key or VAPID subject.

## Power Automate ingestion contract

Configure one flow:

1. Trigger when an item is created or modified in **Bid Listing**.
2. Keep trigger concurrency at one so versions are observed in order.
3. Send `POST /mobile/notification-events/bid-listing-change` with `Content-Type: application/json`.
4. Set `X-Kole-Notification-Secret` to `MOBILE_NOTIFICATION_INGEST_SECRET`.
5. Include the SharePoint item ID and modification timestamp. Include the version when the trigger exposes it.

Example body:

```json
{
  "itemId": "42",
  "sourceModified": "2026-08-24T14:35:21Z",
  "sourceVersion": "7.0"
}
```

`sourceVersion` is optional. `sourceModified` is strongly recommended so a delayed flow run selects the intended SharePoint version rather than a newer edit. Bid Listing version history must be enabled. The flow does not calculate field differences and must not call the Mobile subscribe/unsubscribe routes.

## Trigger contract

The event vocabulary is `NEW_LOAD`, `LOAD_UPDATED`, `LOAD_CANCELLED`, `LOAD_TONU`, and `LOAD_REMOVED`. Status and `Truck_x0020_Number` are transition controls, not ordinary edit notifications.

`LOAD_UPDATED` uses this exact allowlist:

- Route summary: `Shipment_x0020_Origin`, `Shipment_x0020_Destination`
- Pickup: `Pickup_x0020_Offer_x0020_Date`, `Pickup1PickupTime`, `Pickup1AMorPM`, `Pickup1Name`, `Pickup1Address1`, `Pickup1City`, `Pickup2State`, `Pickup2Zip`, `Pickup1ContactName`, `Pickup1ContactNumber`
- Delivery: `Expected_x0020_Delivery_x0020_Da`, `Delivery1Time`, `Delivery1AMorPM`, `Delivery1Name`, `Deliver1Address1`, `Delivery1City`, `Delivery1State`, `Delivery1Zip`, `Delivery1ContactName`, `Delivery1ContactNumber`
- Freight/operations: `Freight_x0020_Description`, `Item1QTY`, `Item1Description`, `TotalPieces`, `Item1Serial`, `Item1Dimensions`, `Length`, `Width`, `Height`, `EstimatedWeight`, `Route`, `Team_x0020_Required`, `No_x002e_ofTarpsNeeded`, `OrderNotes`

All other fields—including workflow flags, automation timestamps, tracking IDs, and paperwork state—are ignored by `LOAD_UPDATED` detection.

## Mobile Notification Events list

The application validates this contract but does not create or alter the list. `NotificationID` must be indexed and enforce unique values.

| Internal name | Suggested SharePoint type | Required behavior |
|---|---|---|
| `Title` | Single line text | Existing default column |
| `NotificationID` | Single line text | Required, indexed, unique |
| `EventType` | Choice or single line text | Five event types listed above |
| `BidID` | Single line text | Optional |
| `LoadID` | Single line text | Bid Listing item ID used for Mobile deep linking |
| `BOLNumber` | Single line text | Optional |
| `TruckNumber` | Single line text | Target truck |
| `PreviousTruckNumber` | Single line text | Optional |
| `DriverRosterItemID` | Single line text | Resolved Mobile Driver Roster item ID when available |
| `ChangedFields` | Multiple lines, plain text | JSON array of allowlisted internal field names |
| `CreatedAt` | Date and time | Event creation time |
| `DeliveryStatus` | Choice or single line text | `Pending`, `Delivered`, `NoActiveDriver`, `TargetLookupPending`, `NoSubscription`, `DeliveryFailed` |
| `DeliveredAt` | Date and time | Set only when at least one device accepts the push |
| `SourceListID` | Single line text | Bid Listing list ID |
| `SourceItemID` | Single line text | Bid Listing item ID |
| `SourceModified` | Single line text | Source modification timestamp |
| `SourceVersion` | Single line text | Optional SharePoint version |
| `Status` | Single line text | Current normalized status |
| `PreviousStatus` | Single line text | Previous normalized status |
| `Origin` | Single line text | Optional |
| `Destination` | Single line text | Optional |
| `PickupDate` | Single line text | Date-only `YYYY-MM-DD` |
| `PickupTime` | Single line text | Optional time including AM/PM |
| `DeliveryDate` | Single line text | Date-only `YYYY-MM-DD` |
| `DeliveryTime` | Single line text | Optional time including AM/PM |
| `EventPayload` | Multiple lines, plain text | Compact provider-neutral JSON payload |

`NotificationID` is deterministic from the source list, item, source revision, event type, and target truck. The unique-value constraint is the concurrency-safe duplicate guard. A replay finds the existing event; an already `Delivered` event is never sent again.

## Mobile Push Subscriptions list

The configured list must contain these exact internal names. `SubscriptionID` must be indexed and enforce unique values. The server derives `DriverRosterItemID` and `TruckNumber` from the authenticated Mobile session and rejects attempts to claim or deactivate another driver's device.

| Internal name | Purpose |
|---|---|
| `Title` | Readable SharePoint row title |
| `SubscriptionID` | Deterministic hash of the browser endpoint; indexed and unique |
| `DriverRosterItemID` | Mobile identity owner |
| `TruckNumber` | Audited truck assignment at registration |
| `Endpoint` | Browser Push Service endpoint |
| `P256dh` | Browser public encryption key |
| `Auth` | Browser authentication secret |
| `UserAgent` | Registration audit value |
| `Platform` | Coarse server-derived platform label |
| `Active` | Delivery eligibility |
| `CreatedAt` | First registration time, preserved by upsert |
| `LastSeenAt` | Most recent registration or deactivation activity |
| `LastDeliveredAt` | Most recent successful push |
| `DisabledAt` | User deactivation or expiry time |
| `LastError` | Concise provider result; never a raw response body |

One driver may register multiple devices. Re-registering the same browser endpoint updates its keys and audit data without creating another row.

## Authenticated Mobile routes

- `GET /mobile/push/public-key` returns the public VAPID configuration.
- `POST /mobile/push/subscribe` accepts the browser's standard `PushSubscription` JSON and upserts it for `req.mobileDriver`.
- `POST /mobile/push/unsubscribe` accepts the endpoint and deactivates that authenticated driver's row without deleting its history.

These routes use the existing Mobile bearer session. They do not accept client-supplied driver IDs or truck ownership.

## Delivery and failure behavior

- The durable event is always created before Web Push is attempted.
- Delivery fans out to at most ten active devices for one driver per event.
- No active subscription changes the event to `NoSubscription`.
- At least one accepted push changes the event to `Delivered` and sets `DeliveredAt`, even if another device fails.
- HTTP `404` or `410` from a Push Service deactivates that subscription and audits the expiry.
- If every attempted device fails, the event changes to `DeliveryFailed` and leaves `DeliveredAt` empty.
- Missing/invalid VAPID configuration leaves the durable event `Pending`; event ingestion still succeeds.
- Provider response bodies and browser keys are not written to logs or API responses.

The push payload contains `eventType`, a friendly `title` and `body`, `loadId`, `bidId`, `truckNumber`, `changedFields`, and `url`. Internal SharePoint field names may remain in the structured `changedFields` audit value, but driver-facing wording maps them to labels such as pickup time, delivery date, route, freight details, and order notes.

## Mobile client behavior

The Mobile web client registers `/sw.js` and exposes notification settings on the **Me** tab. Browser permission is requested only after the signed-in driver taps **Enable Notifications**. The screen distinguishes enabled, off, blocked, unsupported, checking, and error states, and provides a device-level disable action.

The service worker displays pushes and tells every open Mobile window to refresh its authenticated Home data immediately, without changing the active tab. It also focuses or opens the Mobile app when a notification is tapped. Sign-out deactivates and removes the local browser subscription so a shared device cannot continue receiving the prior driver's notifications. The web manifest supports installed-app behavior; on platforms that restrict Web Push to installed web apps, install Kole Connect Mobile before enabling notifications.

## Rollout and verification

1. Confirm both SharePoint lists match the contracts above; do not let the application modify their schema.
2. Confirm all server environment variables are present without printing their values.
3. Deploy the Node server and Mobile web client over HTTPS.
4. Sign in to Mobile, open **Me**, and enable notifications from a user gesture.
5. Confirm one active Push Subscriptions row is created for the authenticated Driver Roster item.
6. Make one allowlisted Bid Listing change and verify Power Automate receives a successful ingestion response.
7. Confirm the durable event is created first, then reaches the expected delivery status.
8. Tap the notification and confirm the intended `LoadID` opens.
9. Disable notifications and confirm the subscription row becomes inactive without being deleted.

Local notification checks run with `npm run test:notifications`. The Mobile project should also pass `npm run lint` and `npm run build` before deployment.
