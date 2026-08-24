# Kole Connect Mobile notification event framework

This framework deliberately stops before push delivery. It classifies Bid Listing changes, resolves the target through the existing Driver Roster/Mobile login mapping, and writes durable provider-neutral events to SharePoint.

## Change ingestion

Kole Connect's own `/record/:id` edit route invokes the detector after a successful Bid Listing patch. Changes made directly in SharePoint or by Power Automate do not otherwise enter the Node backend, so one Power Automate flow is required:

1. Trigger when an item is created or modified in **Bid Listing**.
2. Keep trigger concurrency at one so versions are observed in order.
3. Send an authenticated `POST` to `/mobile/notification-events/bid-listing-change` with JSON containing the SharePoint `itemId`, its `sourceModified` timestamp, and (when available) `sourceVersion`.
4. Set the `X-Kole-Notification-Secret` header to the server-side `MOBILE_NOTIFICATION_INGEST_SECRET` value. Do not place this secret in the web or Mobile client.

The endpoint reads the specified/current item and its immediately preceding SharePoint version through Microsoft Graph. Bid Listing item version history must therefore be enabled. The flow does not need to calculate field differences.

Example body shape:

```json
{
  "itemId": "42",
  "sourceModified": "2026-08-24T14:35:21Z",
  "sourceVersion": "7.0"
}
```

`sourceVersion` is optional. `sourceModified` is strongly recommended so a delayed flow run can select the intended SharePoint version rather than a newer edit.

## Trigger contract

The internal event vocabulary is `NEW_LOAD`, `LOAD_UPDATED`, `LOAD_CANCELLED`, `LOAD_TONU`, and `LOAD_REMOVED`. Status and `Truck_x0020_Number` are control fields handled by the transition rules; they are not ordinary edit notifications.

`LOAD_UPDATED` uses this exact allowlist:

- Route summary: `Shipment_x0020_Origin`, `Shipment_x0020_Destination`
- Pickup: `Pickup_x0020_Offer_x0020_Date`, `Pickup1PickupTime`, `Pickup1AMorPM`, `Pickup1Name`, `Pickup1Address1`, `Pickup1City`, `Pickup2State`, `Pickup2Zip`, `Pickup1ContactName`, `Pickup1ContactNumber`
- Delivery: `Expected_x0020_Delivery_x0020_Da`, `Delivery1Time`, `Delivery1AMorPM`, `Delivery1Name`, `Deliver1Address1`, `Delivery1City`, `Delivery1State`, `Delivery1Zip`, `Delivery1ContactName`, `Delivery1ContactNumber`
- Freight/operations: `Freight_x0020_Description`, `Item1QTY`, `Item1Description`, `TotalPieces`, `Item1Serial`, `Item1Dimensions`, `Length`, `Width`, `Height`, `EstimatedWeight`, `Route`, `Team_x0020_Required`, `No_x002e_ofTarpsNeeded`, `OrderNotes`

All other fields—including workflow flags, automation timestamps, tracking IDs, and paperwork state—are ignored by `LOAD_UPDATED` detection.

## Notification Events SharePoint list proposal

The application does not create or alter this list. Provision it manually, then set `MOBILE_NOTIFICATION_EVENTS_LIST_ID`. Use `MOBILE_NOTIFICATION_EVENTS_SITE_ID` only when the list is on a different site from `SITE_ID`.

Create these columns with the exact internal names shown:

| Internal name | Suggested SharePoint type | Required behavior |
|---|---|---|
| `Title` | Single line text | Existing default column |
| `NotificationID` | Single line text | Required, indexed, **enforce unique values** |
| `EventType` | Choice or single line text | `NEW_LOAD`, `LOAD_UPDATED`, `LOAD_CANCELLED`, `LOAD_TONU`, `LOAD_REMOVED` |
| `BidID` | Single line text | Optional |
| `LoadID` | Single line text | Bid Listing item ID used for Mobile deep linking |
| `BOLNumber` | Single line text | Optional |
| `TruckNumber` | Single line text | Target truck |
| `PreviousTruckNumber` | Single line text | Optional |
| `DriverRosterItemID` | Single line text | Optional resolved Mobile driver roster item ID |
| `ChangedFields` | Multiple lines, plain text | JSON array of internal Bid Listing field names |
| `CreatedAt` | Date and time | Event creation time |
| `DeliveryStatus` | Choice or single line text | `Pending`, `NoActiveDriver`, `TargetLookupPending` |
| `DeliveredAt` | Date and time | Left empty by this framework |
| `SourceListID` | Single line text | Bid Listing list ID |
| `SourceItemID` | Single line text | Bid Listing item ID |
| `SourceModified` | Single line text | Source modification timestamp |
| `SourceVersion` | Single line text | Optional SharePoint version |
| `Status` | Single line text | Current normalized status |
| `PreviousStatus` | Single line text | Previous normalized status |
| `Origin` | Single line text | Optional |
| `Destination` | Single line text | Optional |
| `PickupDate` | Single line text | Date-only `YYYY-MM-DD` to avoid timezone shifts |
| `PickupTime` | Single line text | Optional pickup time including AM/PM when available |
| `DeliveryDate` | Single line text | Date-only `YYYY-MM-DD` to avoid timezone shifts |
| `DeliveryTime` | Single line text | Optional delivery time including AM/PM when available |
| `EventPayload` | Multiple lines, plain text | Compact provider-neutral JSON payload |

`NotificationID` is deterministic from the source list, item, source revision, event type, and target truck. The unique-value constraint is the final concurrency-safe duplicate guard; the server also checks for an existing ID before every non-retried create.

## Delivery handoff

A later push worker should read events with `DeliveryStatus = Pending`, send through the chosen provider, and update delivery state/`DeliveredAt`. It should use `DriverRosterItemID` as the identity boundary and `LoadID` as the Mobile deep-link target. Provider-specific wording and device tokens should remain outside the trigger module.
