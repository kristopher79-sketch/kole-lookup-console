Kole Connect Driver Summary Report - v3

Drop-in replacement files:
- server.js
- App.jsx
- App.css

What this version includes:
1. Monthly Driver Route Summary report remains in the Reports card and previews in a modal.
2. Pickup Offer Date remains the report month anchor.
3. Backend enforces the report lock rule:
   - Unlocks at 8:00 AM Eastern on the 5th day of the following month.
4. 2024 and 2025 report years now route to archive lists automatically when available.
   - Current Eastern year routes to Bid Listing.
   - Prior years route to Bid Listing Archive YYYY.
   - If the archive list is not found, the API returns a clear source-list error instead of silently pulling current Bid Listing.
5. Report rows now support order click-through:
   - Click the BOL in the report table to open the full order screen.
   - Double-click the row as a secondary shortcut.

Notes:
- Archive support depends on the archive list names matching the existing Kole Connect discovery pattern: Bid Listing Archive 2024, Bid Listing Archive 2025, etc.
- The report endpoint still supports includeArchives=true from the frontend, but the backend now chooses archive lists automatically for prior years.
- This does not add user-level permissions yet.
- This does not add PDF or email generation yet.

V4 update:
- Driver Summary load rows now open the full order screen with a normal single row click.
- BOL values are plain text again; no underlined link/button behavior needed.
