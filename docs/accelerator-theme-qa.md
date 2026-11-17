# Accelerator light theme

Accelerator workspaces now start in a light theme. The toolbar switches between light and dark; `pitchy_accelerator_theme` stores a separate preference for these routes. An inline bootstrap applies the saved preference before the workspace paints, and a storage listener synchronizes open tabs. If browser storage is unavailable, switching still works in the current tab.

Coverage: organizer/tracker/expert workspace, resident workspace, invitations, attendance check-in, application and revision forms. The marketing page and the rest of Pitchy retain their existing styling. Required participant registration is rendered inside the active accelerator theme, once.

## Styling

`components/accelerator/accelerator-theme.css` is a scoped compatibility palette for the existing dark utility classes. Dark component styles remain the source of truth for dark mode. Light overrides cover existing foreground opacity levels, neutral surfaces, borders, semantic status text, native controls, hover states, and keyboard focus. New accelerator colors must have matching light styles here. Modal scrims stay translucent black. QR quiet zones stay white in both themes.

## Validation

- Full Chromium suite: 74 passed, including accelerator navigation, applications, homework, team projects, imports, QR attendance, registration, and administrative user scenarios.
- Additional isolation and themed registration checks: 2 passed in Chromium.
- Theme suite: 16 passed in Firefox and 16 passed in WebKit. Firefox needed a local launch preference (`network.proxy.type=0`) to bypass this workstation's proxy for localhost; no application code change was needed.
- TypeScript and ESLint checks for changed code passed.
- Production build passed.
- Visual inspection: light desktop (1440px) and mobile (390px), plus dark-theme screenshots. Browser assertions check no horizontal page overflow at these widths.
- Contrast test checks rendered secondary overview text against white cards at WCAG AA (4.5:1 minimum). It does not certify every possible user-generated page or image.

The browser tests mock API responses and do not validate the live backend or deploy the site. Re-run with the repository's normal dependency installation and `npm run test:e2e`; tests in `tests/accelerator-theme.spec.ts` cover persistence, keyboard operation, unavailable storage, cross-tab sync, route coverage, contrast, mobile layout, registration, and theme isolation.
