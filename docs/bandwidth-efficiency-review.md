# KOLE Connect bandwidth efficiency review

November 27, 2026. Source changes are ready for review in the existing app projects. No commits, pushes, deployment, installer packaging, Microsoft 365 writes, or schema changes were performed. All four working trees were clean before work began.

## Changes ranked by likely benefit

The ranking reflects source-supported opportunities, not a measured breakdown of November's Render bill.

| Priority | Change | Expected benefit | Source |
| --- | --- | --- | --- |
| 1 | Compress eligible successful JSON reads with negotiated gzip, level 1 | Smaller outbound Render response bodies; originals, PDFs, credential responses and no-transform responses bypass compression | [server-transfer.js](C:/Projects/kole-lookup-console/server-transfer.js:7) |
| 2 | Serialize client bootstrap requests and share equivalent pending requests; coalesce identical authorized server requests before the workload queue | Eliminate duplicate client transfers and repeated backend computations; different authorization, queries and mutation generations remain separate | [dashboard-refresh.js](C:/Projects/kole-lookup-console/client/client/src/dashboard-refresh.js:3), [server-transfer.js](C:/Projects/kole-lookup-console/server-transfer.js:105) |
| 3 | Compact oversized cache entries losslessly before rejecting them; protect cache writes from invalidation races | Reduce repeated Graph retrievals without increasing the 32 MiB retained budget or 8 MiB retained entry limit | [server-memory.js](C:/Projects/kole-lookup-console/server-memory.js:42), [server.js](C:/Projects/kole-lookup-console/server.js:1795) |
| 4 | Defer Photo Reference Library authenticated image downloads until near the viewport; recheck the image cache after waiting for a slot | Avoid downloads of unseen gallery tiles and some repeated queued images | [LibraryImage.tsx](C:/Projects/PhotoReferenceLibrary/src/components/LibraryImage.tsx:17), [microsoftGalleryService.ts](C:/Projects/PhotoReferenceLibrary/src/services/microsoftGalleryService.ts:304) |

The client also checks native Tauri minimize state before periodic refreshes and refreshes due modules on visibility, resize and focus events. Unfocused visible windows remain eligible. Existing 2/3/5/10-minute module cadences and the 30-second scheduling tick are unchanged. Post-driver-edit and termination refreshes explicitly run after older bootstrap work. Ended sessions cannot start queued requests or apply old bootstrap responses. An old upload-date response cannot replace the currently selected digest date.

A bootstrap transport/server failure now keeps the existing screen and reports the failure without issuing up to eight separate fallback requests. Legacy fallback remains for HTTP 404/405, preserving compatibility with a server that lacks the bootstrap route. Normal scheduled refreshes and existing user refresh actions remain available.

## Verified request and deployment paths

### KOLE office desktop and responsive frontend

[App.jsx](C:/Projects/kole-lookup-console/client/client/src/App.jsx:682) is shared by the web client and thin Tauri wrapper. The configured API override, localhost development API and hosted production default remain unchanged. Netlify builds the client from client/client; Tauri packages the same Vite output.

| Recurring activity | Existing cadence | Network behavior |
| --- | --- | --- |
| Operations, driver positions, IntelliTrack | 2 minutes | Due modules batched in bootstrap |
| Upload Digest, action alerts | 3 minutes | Due modules batched in bootstrap |
| Available trucks | 5 minutes | Due module batched in bootstrap |
| Recruiting, distribution list | 10 minutes | Due modules batched in bootstrap |
| Dashboard scheduler | 30 seconds | Checks due modules; does not fetch everything each tick |
| Seasonal date check | 30 minutes | Local date/theme work |
| Startup elapsed indicator | 250 milliseconds while displayed | Local display work |
| Search debounce and status/splash timers | One-shot timers | Search is input-triggered; status/splash timers are local |

Browser hidden-tab suppression and immediate checking on visibility return already existed. The new native minimize check strengthens desktop handling. No office service worker polling loop was found. [Refresh effect](C:/Projects/kole-lookup-console/client/client/src/App.jsx:3294).

### Driver mobile app

The separate C:/Projects/koleconnectdriver project loads on session/tab/user actions and push messages. Its push-triggered home refresh already has a single-flight loop with a queued follow-up. Its service worker displays notifications and informs existing clients; it does not run recurring data polling. The check-in opening-time timer updates local eligibility, not backend data. These source files were left unchanged. [Push refresh](C:/Projects/koleconnectdriver/src/App.jsx:2078), [service worker](C:/Projects/koleconnectdriver/public/sw.js:9).

### Customer Availability and Tracking Portal

C:/Projects/TrackingPortal uses Netlify proxy routes to the shared KOLE backend. Availability, shipments and tracking load on mount or deliberate refresh; there are no recurring data polling intervals. Requests carry cookies and use no-store. Company authorization and ownership checks remain per request.

The backend already coalesces and caches the public capacity calculation for 60 seconds and invalidates it on affected changes. The 6 AM to 6 PM Eastern publication window, projections, LaunchingPoint, time-off rules, customer isolation and tracking-request ETag checks were preserved. No frontend changes were justified. The shared backend now compresses eligible portal capacity and shipment JSON. [Portal capacity](C:/Projects/kole-lookup-console/customer-portal.js:397), [shipment source](C:/Projects/kole-lookup-console/customer-portal.js:278), [frontend refresh](C:/Projects/TrackingPortal/src/App.jsx:91).

### Photo Reference Library

The current desktop build sets VITE_PHOTO_LIBRARY_DESKTOP_LOCAL and connects to a private backend on each PC. That code path bypasses Render. The repository also retains hosted API configuration and configurable web/development paths; the installed versions and active production configuration were not inspected. [Desktop build](C:/Projects/PhotoReferenceLibrary/scripts/build-desktop.mjs:6), [desktop connection](C:/Projects/PhotoReferenceLibrary/src/components/DesktopStartup.tsx:18).

The gallery has no recurring polling loop. Its lazy img attribute previously acted only after loadImage had already downloaded a blob. The fetch itself now waits until the placeholder is within 240 pixels of the viewport. Eager lightboxes remain eager; browsers without IntersectionObserver retain immediate loading. Cancellation prevents unmounted images from entering the queue or updating state.

Photo URLs now include a hash of the existing file revision/modified timestamp, in both active photo service implementations. Existing private browser image caching can distinguish revised content without changing opaque photo IDs or original bytes. This does not extend cache lifetimes or introduce public caching. [Shared service](C:/Projects/kole-lookup-console/photo-library-service.js:630), [standalone service](C:/Projects/PhotoReferenceLibrary/backend/photo-library-service.cjs:766).

## Retrieval scope and deferred changes

Operations retrieves selected fields from the complete **current** Bid Listing, then applies existing operational rules. Routine bootstrap does not retrieve archive item datasets. Search and reporting paths can deliberately read archives. Current-list scans still include older rows retained in that list. Replacing them with date/status filters could change counts, settlement/reporting eligibility or exceptional records, so no speculative filtering or delta synchronization was added. [Dashboard source](C:/Projects/kole-lookup-console/server.js:19041), [Operations builder](C:/Projects/kole-lookup-console/server.js:21243).

Operation note indicators and a cold per-order notes request still retrieve the notes list with resilient field selection. Additional server filters require verifying SharePoint indexing and all BOL/Bid ID matching semantics. The existing per-order cache was preserved; no shared source TTL was added that could compound freshness windows. [Indicators](C:/Projects/kole-lookup-console/server.js:4800), [per-order notes](C:/Projects/kole-lookup-console/server.js:4882).

The former cache implementation rejected an entry when its estimated retained size exceeded the per-entry/total budget; excessively deep objects could also produce an infinite estimate. Unused aggregate capacity did not override the per-entry gate. Zero notes/comparables entries can also be normal when their on-demand paths have not been used. Live rejection sizes and the actual November cause remain unmeasured.

Compaction uses V8 serialization plus deflate to preserve undefined, null, empty strings, false, zero, Maps, Sets, dates and cycles. It is opt-in on the four existing large caches. Input work is capped at a 64 MiB object estimate and 16 MiB serialized payload. Unsupported, excessive or still-oversized entries remain uncached. LRU eviction, expiration and existing TTLs remain in effect. Expiry sweeps inspect timestamp metadata without inflating cached datasets. Diagnostics distinguish size, encoding and input-limit skips by fixed cache name. Retained-size estimates remain estimates, not an RSS limit; encoding/decoding uses bounded temporary memory and CPU.

## Photos PDFs and conditional responses

Office delivery galleries already used IntersectionObserver and actual Graph medium thumbnails. Reference galleries already used Graph thumbnails, a five-download concurrency limit, private image caching and a bounded count of blob URLs. Full images and PDF export remain on demand. Existing thumbnail fallbacks and HEIC conversion behavior were preserved. No downsampling, PDF rewrite, upload compression or quality change was introduced. [Office gallery](C:/Projects/kole-lookup-console/client/client/src/DeliveryPhotoPackage.jsx:8), [image routes](C:/Projects/kole-lookup-console/server.js:14547).

Mobile paperwork continues to authorize each load/document and stream its PDF with private no-store headers. Long-lived PDF caching was deferred because access and order eligibility may change. [Paperwork stream](C:/Projects/kole-lookup-console/server.js:25161).

Express ETags and conditional handling remain compatible with compressed representations; regression checks verify 304 with no body. Vary includes Accept-Encoding and lookup authorization where relevant, and eligible internal JSON defaults to private revalidation. Existing frontend no-store/no-cache requests and generated timestamps limit actual 304 reuse. No production 304 saving is claimed, and no broad client caching policy was changed.

## Transfer measurement

[server-transfer.js](C:/Projects/kole-lookup-console/server-transfer.js:22) records response counts, body bytes submitted to write/end, pre-compression JSON bytes and aborted responses by bounded method/route-template/status-class buckets. It covers root-backend JSON, image and PDF responses. Every five minutes the root process logs cumulative aggregate totals. No new public diagnostics endpoint exists. Raw URLs, query values, identifiers, headers, tokens and bodies are excluded.

Upstream Graph and other fetch responses are counted separately using declared Content-Length when available, with unknown lengths counted explicitly. These header totals are incomplete ingress estimates; they are not measured socket traffic. Outbound body totals omit HTTP/TLS overhead and can overstate delivered bytes for aborted connections. Neither is a direct reconstruction of Render billing or edge compression. Standalone Photo Library processes have their own traffic and are outside these root-process totals.

The touched bootstrap error path also now logs fixed module/status information and returns safe messages rather than raw upstream errors.

## Measured synthetic result

Run `node test/bandwidth-benchmark.js` without environment files or network access. One local run using 16,000 synthetic rows produced:

| Measurement | Result |
| --- | --- |
| JSON body | 4,173,755 bytes |
| gzip level 1 body | 297,562 bytes |
| Body reduction | 92.9% |
| Estimated retained object size | 16,709,454 bytes |
| Former 8 MiB admission | Rejected |
| Compacted retained cache estimate | 235,678 bytes, admitted |
| Restored rows | All 16,000 |
| Cache encoding / decoding in that run | 89.0 ms / 46.5 ms |

This demonstrates functionality and its CPU tradeoff, not a forecast of bill reduction. Real response sizes, traffic mix, hit rates, Render edge behavior and deployed versions must determine production savings.

## Verification

### KOLE backend and office frontend

- Backend/module syntax checks and Vite production build passed. Vite retains its large-chunk warning.
- `npm run test:bandwidth` covers coalescing, authorization/query separation, mutation barriers, serialization, stale-session handling, visibility gates, fallback behavior, compression negotiation, ETags, byte accounting, cache bounds and invalidation races.
- Full local backend run: 209 checks, 207 passed, two failures also present before edits. The existing failures concern shared check-in hydration source assertions and billing UI wording in operator-rate-confirmations checks. They were not rewritten to hide failures.
- Targeted active frontend lint: unchanged baseline of 32 errors and five warnings; no additional diagnostic signatures. The new dashboard helper is clean.

### Photo Reference Library

- TypeScript/Vite build, all 59 existing server checks and all five new image regressions passed. New checks can be rerun with `npm run test:images`.
- Two desktop lifecycle checks passed. The existing resource-manifest check fails because ignored src-tauri/desktop-backend/company-connection.json is absent. The manifest, startup component and packaging inputs used by that assertion were not changed. Private credential packaging was not attempted.

### TrackingPortal

Production build and source lint passed. Source files remain unchanged; the build retains its large map-chunk warning.

### Driver mobile app

Production build, source lint, six stop-event checks and five paperwork checks passed. Source files and push behavior remain unchanged.

### Review boundaries

Diff review found no credential/data additions, authentication bypasses, schema changes, business-date/formula changes, production dependency changes or generated/historical source edits. Native installed-app minimize/resume behavior and authenticated visual workflows still need a real desktop/user-session smoke check. No Rust source changed, and no native installer build or cargo check was run. Production savings cannot be measured from these local checks; publication remains subject to Kris's review.
