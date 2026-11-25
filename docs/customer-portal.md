# KOLE Customer Portal

This extends the existing Netlify tracking frontend and Render backend. Shipment-specific tracking sessions and the existing dispatch tracking workflow remain in use.

## Customer experience

- **Equipment Availability** is public. It shows current/projected opportunities grouped by date, location, and equipment type, with no unit numbers, driver names, commitments, or fleet totals.
- **My Shipments** requires a company code and shared password. It shows that company's current and future Won bookings from the current Bid Listing. Processed, settled, cancelled/TONU, and delivery-confirmed shipments are excluded. Expected delivery dates alone do not establish delivery.
- **View Tracking** uses the existing shipment detail/map. Every request checks ownership and eligibility. Tracking joins by both Bid Listing item ID and BOL; no BOL-only ownership fallback is used.
- **Request Tracking** sets `EnableTracking` through the same helper used by dispatch's IntelliTrack action. `TrackingActive` remains a status field. Dispatch completes the established setup. Already active/requested shipments are not submitted again. The public request checks current ownership, completion state, and an ETag before changing the flag.
- Tracking email links still open their specific shipment directly. A shipment session grants no company dashboard access.

## Company access

Add `PortalPassword` as an editable, single-line Text column on **Sales Leads**. It stores a salted scrypt verifier rather than a readable password. `CustomerCode` must identify exactly one company and match Bid Listing's `CustomerCode`.

In KOLE Connect, open the customer's existing **Edit Order Tracking Preferences (IntelliTrack)** window. **Customer Portal access** generates a password and displays a copyable invitation once. It does not send invitations automatically. Opening the panel does not replace an existing password. A deliberate reset ends existing company sessions on their next API request. Closing the panel removes the displayed credential from component memory.

`GET /sales-leads/:id/portal-access` and `POST /sales-leads/:id/portal-access` use existing internal lookup authentication. Credential writes preflight the live column and use the account ETag. Public shipment-link visits do not create or reveal company credentials.

The separate HttpOnly, SameSite=Lax company cookie is scoped to `/api/v1/portal`, expires after 12 hours, and is bound to the current account, customer code, and password verifier. Changing or clearing the verifier invalidates access on the next request. Password checks are rate limited; expensive hashing is serialized to limit memory use.

## Public capacity rules

- Publication hours: 6:00 AM until 6:00 PM `America/New_York`.
- Current candidates: today's published **Available Trucks Single Line** rows. Projected candidates: the latest **Project Equipment Availability** run. Publications older than 24 hours are hidden.
- Projected fields: `ProjectedEmpty`, `Location`, `Operator`, `Equipment`, `RunDateandTime`. `Equipment` is actually an internal truck reference; displayed equipment type comes from Driver Roster.
- Return candidates also come directly from the live **Time Off Log** using the calendar day after `EndDate` and `LaunchingPoint`. Time off includes its end date, matching KOLE Connect's current-time-off calculation: November 25–30 yields projected availability on December 1. Returns today through seven days ahead are projected even without a posted available truck or forecast run; their publication time is when the live data was checked. Cancelled/inactive records, missing locations, and invalid dates cannot create availability.
- Each candidate must resolve to exactly one active Solo roster record. Teams, unknown equipment, ambiguous assignments, unverified locations, and invalid dates are excluded.
- Won pickups block through seven days after the candidate date, inclusive. Time off blocks through that window plus two days, inclusive. Future projected candidates may rely on open loads scheduled to deliver today or later, on or before the projected date. Loads extending past the projected date, invalid schedules, and unconfirmed deliveries dated before today still block publication. Today's current or projected availability requires completion confirmation for open loads scheduled to finish on or before today; delivery dates alone do not establish an empty unit today.
- A return candidate falls after its own time-off end date. Other time off and all existing roster/booking checks still apply. Driver Roster supplies the public equipment family; driver names, truck numbers, and source records stay private.
- Business date-only values retain their calendar date rather than shifting from UTC midnight to the previous Eastern date.
- Public rows are deduplicated by date, location, equipment, and availability class. No quantities are published. Sanitized results are cached up to 60 seconds and invalidated after time-off additions/edits in KOLE Connect; raw operational lists stay request-scoped.
- The inquiry form requires origin, destination, and needed date, then prepares an email to dispatch in the customer's email app. It does not claim a message was sent or book equipment automatically.

## Configuration and delivery

Existing Graph credentials, site configuration, and `KOLE_TRACK_SESSION_SECRET` (or `MOBILE_SESSION_SECRET` fallback) remain server-side. The module uses the existing Graph boundary and adds no production dependencies or Graph permissions.

Optional backend overrides:

- `PROJECT_EQUIPMENT_AVAILABILITY_LIST_ID`: defaults to the verified forecast list.
- `KOLE_PORTAL_ALLOWED_ORIGINS`: comma-separated extra browser origins. The established Netlify origin and localhost port 5174 are allowed by default.

Vite and Netlify proxy `/api/v1/portal/*` to the existing backend. Deploy the backend before the frontend when authorized. No live schema, customer records/passwords, or production deployments were changed during implementation.

## Verification and preview

Backend: `node --check server.js`, `node --check customer-portal.js`, `node --test test/customer-portal.test.js test/customer-tracking.test.js`.

Build both the tracking frontend and KOLE Connect client using their existing build commands. The development-only preview is `http://127.0.0.1:5174/?demo=1`. Select **My Shipments**, then **Preview demo dashboard** for synthetic bookings. Demo requests do not mutate Microsoft 365. Production does not enable the demo switch.
