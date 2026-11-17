# Accelerator navigation history

Internal navigation now records independent browser history entries instead of only replacing the URL. A shared navigation-state hook preserves Next.js history fields, batches synchronous changes from one action, restores views on popstate and handles reloads. Initialization and automatic cohort selection replace the initial entry and do not add artificial Back steps. Repeated clicks on the active view do not add entries.

Both organizer and resident Back buttons use internal history; a directly opened view falls back to the cohort overview or resident Today screen. Explicit links named Dashboard / Pitchy remain available as exits. Internal route changes between participant streams retain the same Back chain.

History covers staff sections, cohort selection, settings panels, participant cards, resident sections and passport editor, application queues / cards / detail tabs, attendance drawers / detail tabs / QR, program and homework form views, review / assignment modes, tracker expansions, tracking / matchmaking views, demo-day tabs, and setup / closure steps. View snapshots do not replay API mutations or store form drafts as undoable actions. Restored attendance and tracker views reload their read-only data.

Validation:

- Full Chromium suite: 89 passed.
- Focused navigation and QR follow-up: 10 passed in Chromium.
- Navigation / resident Back scenarios: 6 passed in Firefox and 6 in WebKit.
- Tests cover Back / Forward, in-site Back, direct links, reload, repeated clicks, cohort selection, cross-stream routing, nested QR / event dialogs and resident passport closure.
- TypeScript and production build passed. Existing lint findings in legacy components remain; new navigation hook and tests pass ESLint.

Browser tests mock API responses. The first browser Back from a newly opened accelerator with no internal navigation may still leave the site, following normal browser behavior; the in-site Back button has an accelerator fallback.
