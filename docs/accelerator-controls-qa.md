# Accelerator controls follow-up

- Application queues now use explicit selected-state foreground/background pairs in both themes.
- Attendance actions use bordered secondary buttons, including a readable destructive action inside the event drawer.
- Event headers reserve a separate column for actions and wrap long titles within the remaining width. Smaller screens use stacked columns.
- QR containers no longer combine `bg-white` (inverted by the compatibility palette) with the invariant white QR surface.
- Resident project selection no longer forces dark native controls. The resident project card offers the complete existing passport editor, rendered inside the active accelerator theme. It refreshes membership data after save and shows inline API errors without losing edits.
- Attendance `PATCH` accepts `not_marked`. It shares the existing lifecycle locks, membership validation, authorization and progress reconciliation. It removes the current attendance record, writes `attendance.cleared` with its previous status, and returns `not_marked`. The UI exposes “Снять отметку” only on marked rows, disables mark buttons during writes and refreshes attendance and event counts. No live records were changed during development.

## Validation

- Full Chromium browser suite: 83 passed.
- Targeted controls / QR / resident editing: 14 passed in Chromium after final styling changes; 14 passed in Firefox and 14 passed in WebKit during cross-browser validation.
- Backend attendance suite: 28 passed, 1 skipped (existing concurrency test needs real PostgreSQL; other tests ran with migrated SQLite).
- New backend cases cover clearing all three marks, authorization, foreign cohorts, closed cohorts, audit trail, idempotent empty reset, QR check-in after reset, and reconciliation of auto-completed program stages.
- Passport test fills every field from the server readiness schema, checks failed-save retention, saves, reopens and verifies every value, including lists.
- TypeScript and production build passed. ESLint passes for new tests and the otherwise clean touched components. Four legacy components have five pre-existing `react-hooks/set-state-in-effect` errors, unchanged from main; no new lint errors introduced.
- Manually inspected light-mode event actions at 1952px and the passport editor. Browser cases also cover 390px and 1440px, selected queues in both themes, a white QR background and failure handling for clearing attendance.

Browser tests mock the API; the production database and deployment have not been modified by these tests.
