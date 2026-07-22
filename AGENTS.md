# Kole Connect - Agent Guide

This guide applies to the entire repository. Follow the repository and Kris's explicit task instructions when they are more specific.

## Architecture and active files

Kole Connect is an internal operations console backed mainly by SharePoint and OneDrive through Microsoft Graph.

- `server.js`: active CommonJS Node/Express backend. Owns app-only Graph authentication, SharePoint/OneDrive access, validation, business rules, reports, caching, and HTTP routes.
- `package.json`: backend dependencies and `npm start`.
- `client/client/src/App.jsx`: active React 19/Vite client and client-side request/state orchestration.
- `client/client/src/App.css`: active themes, layout, feature styles, responsive rules, and print rules.
- `client/client/src/main.jsx` and `index.css`: client bootstrap and global base styles.
- `client/client/src-tauri/`: thin Tauri 2 desktop wrapper around the same Vite client.
- `netlify.toml`: web deployment entry point.

Do not treat `*LastStable*`, `OriginalforWebAPP.jsx`, generated output, or old drop-in/reference files as active source. Do not update them unless Kris explicitly requests a recovery/snapshot task. The generic Vite README is not an architecture specification.

## Run and verify

From the repository root:

```powershell
npm start
node --check server.js
```

From `client/client`:

```powershell
npm run dev
npm run build
npx eslint src/App.jsx src/main.jsx
```

`npm run dev` launches Vite and the root Express server. Express does not hot-reload; restart it after backend changes. For Tauri-only work, also run `cargo check --manifest-path src-tauri/Cargo.toml` when the toolchain is available.

There is no automated test suite or `test` script. Do not claim tests passed. Broad lint includes historical/generated paths and fails; targeted active-file lint also has established findings. Compare with the baseline and do not add findings in touched code.

## Authentication and configuration

- The client stores the lookup token only in `sessionStorage` as `koleLookupToken`.
- Protected client requests must use `authedFetch`, which sends `X-Lookup-Token` and clears the session on `401`/`403`.
- Express protects operational routes with `requireLookupAccess`.
- Microsoft Graph uses server-side client credentials through `getGraphToken`; Graph tokens never reach the browser.
- Never print, summarize, commit, or expose `.env`, credentials, tokens, authorization headers, or operational data.
- `VITE_KOLE_API_BASE` is public client configuration and must never contain secrets.
- Preserve the API-base behavior: configured override, localhost port `5000` in development, hosted API in production.
- Do not activate the unused MSAL client configuration, change authentication, or broaden Graph permissions without an explicit design task.

Public health routes must not expose tenant configuration, data, tokens, or upstream errors.

## Established code conventions

Work surgically in the large active files; do not introduce an architecture rewrite, TypeScript migration, new state framework, duplicate API/Graph client, or new design system as incidental cleanup.

Backend naming:

- `DEFAULT_*`, `*_MS`, and feature-prefixed uppercase constants for configuration/policy.
- `cached*`, `*Cache`, and `inFlight*` for bounded caches and request coalescing.
- `get*` for retrieval, `clean*` for Graph-to-app mapping, `build*` for response/report construction, `normalize*`/`parse*` for validation, `format*` for display values, and `clear*Caches` after writes.
- API responses follow `{ success: true, ... }` or `{ success: false, error, ... }`.

Client naming:

- Feature-local state uses `[featureValue, setFeatureValue]`.
- Handlers use `load*`, `open*`, `close*`, `save*`, and `handle*` consistently.
- Use the existing modal, drilldown, return-trail, cache, and `AbortController` patterns.
- External links go through `openExternalLink` for browser/Tauri compatibility.

CSS naming:

- Use existing `--kole-*` tokens and feature-scoped kebab-case classes.
- Dark is the default; light and `data-season` palettes are supported.
- Use existing z-index tokens, focus styles, and `prefers-reduced-motion` behavior.
- Do not append a new chronological CSS "pass," scatter hard-coded theme colors, increment the CSS cache-buster casually, or add `!important` without a demonstrated integration need.

## Microsoft Graph and SharePoint

- Use `getGraphToken`, `graphGet`, `graphPatch`, and `graphPost`; do not create another Graph boundary.
- Preserve timeouts, bounded retries, backoff/jitter, `Retry-After`, GET coalescing, and opaque `@odata.nextLink` pagination.
- Reads may retry transient failures. Posts must not retry automatically without duplicate prevention.
- Prefer narrow `$select`/`$expand`; use a resilient full-field fallback only where schema variation requires it.
- Validate all route/query/body input before building Graph requests. Encode path identifiers and escape filter values.
- Translate upstream failures into safe operational messages. Never return raw Graph JSON or log URLs, bodies, fields, documents, customer/driver details, or credentials.

SharePoint internal names are the contract. Important quirks include:

- BOL: `BOLNumber_x0028_Won_x0029_`
- Origin/destination: `Shipment_x0020_Origin`, `Shipment_x0020_Destination`
- Pickup/delivery dates: `Pickup_x0020_Offer_x0020_Date`, `Expected_x0020_Delivery_x0020_Da`
- Operator/truck: `Operator_x002f_Team`, `Truck_x0020_Number`
- Permit/escort fees: `Permits_x002f_Escort_x0020_Fees_`
- Pickup state/ZIP are stored as `Pickup2State` and `Pickup2Zip`.
- Delivery address is misspelled internally as `Deliver1Address1`.
- Bid Listing `Company`, `Truck Number`, and `Operator/Team` are choice fields, not lookups; read approved values from column metadata and write strings.

Do not create, rename, delete, or change SharePoint lists, libraries, columns, content types, choices, folders, or permissions without explicit approval. Preserve missing versus empty/null/false/zero values.

All mutations must validate server-side, respect current-list/archive boundaries and business locks, use ETag/`If-Match` where established, be duplicate-safe, return normalized app data, and invalidate every affected server/client cache. Archived Bid Listing rows and final-settled orders remain read-only.

## Intelligent Quote Engine contracts

- Total miles = loaded miles + empty/deadhead miles; never price deadhead separately.
- Choose the all-mile rate from empty miles: `<= 250` uses `$3.25`; `> 250` uses `$3.10`. Apply that rate to all miles.
- Apply percentage adjustments to transportation first, then add permits, escorts, holding, and other extraordinary costs.
- Round calculated/percentage-adjusted customer totals to the nearest `$50`; preserve an explicit final flat-rate override exactly.
- Preflight create fields against live Bid Listing column metadata. Categorize missing, read-only, required, and incompatible fields; never change schema from the app.
- Omit `BidID` from create payloads; Power Automate assigns it. A temporarily blank Bid ID is pending automation, not permission to create a duplicate.
- Never automatically retry creation. Preserve request IDs, publish-result caching, and duplicate checks for uncertain outcomes.
- Buffer free-typed inputs locally and commit on blur/submit so keystrokes do not rerender all of `App`; dates, switches, and selections may update immediately.

Pricing-policy, rounding, required-field, or duplicate-definition changes require Kris's explicit approval.

## Business time and reports

Business time is `America/New_York`. Reuse the established Eastern helpers; never use server/browser local time or naive UTC slicing for business dates. Preserve date-only values and inclusive/exclusive boundaries.

Monthly Driver Summary, Monthly Operations Summary, and Customer Booking Trends unlock at 8:00 AM Eastern on the fifth day of the following month. Archive discovery begins in 2024 and uses `Bid Listing Archive YYYY`; do not assume every archive exists. When changing a formula, document sources, date basis, boundaries, exclusions, grouping, and rounding, then verify a boundary case.

## UI and completion rules

- Preserve the dense desktop-first workflow and support wide desktop, `1100x700`, and about `700px` width.
- Handle loading, empty, error, stale/partial, success, and post-mutation states deliberately; do not flash empty content while loading.
- Disable duplicate submissions, provide clear feedback, preserve modal/filter/return context, and use semantic controls, labels, keyboard focus, and `aria-live` where appropriate.
- Never communicate state by color alone. Check dark/light themes, long names, missing values, overflow, nested modals, and seasonal tokens when relevant.

Before editing, inspect the nearest comparable end-to-end path. Before handoff, run proportional checks and review the diff for secrets, raw Graph data, missing auth, stale caches, date shifts, schema assumptions, generated/historical files, and unrelated formatting.

Preserve unrelated working-tree changes. Do not add/upgrade production dependencies, commit, push, deploy, publish, or mutate live Microsoft 365 data/schema unless Kris explicitly authorizes that action.
