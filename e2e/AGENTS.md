# E2E test guidance

Every user-visible behavior change needs a passing Playwright spec. This
includes stores, hooks, routes, commands, shortcuts, modal flows, sync,
persistence, and visible loading or error states. Pure type changes, internal
refactors with no visible effect, and semantic-neutral CSS changes are exempt.

Use the fixtures in `e2e/fixtures/localstorage.ts`, especially `clearState`,
`seedAccount`, `seedRecurringEvent`, `seedJournal`, and the other focused seed
helpers. Start new specs from `e2e/__user-flow.template.ts`; there is no
`e2e/templates/` directory.

Prefer selectors in this order:

1. Public `data-component` or `data-action` attributes.
2. Accessible labels and roles (`aria-label`, `getByRole`, `getByLabel`).
3. Other stable user-visible text.

Assert on what the user can see or do, not incidental CSS classes or private
implementation details. Scope modal assertions to their dialog. Run a focused
test with `pnpm test:e2e -- --grep "test name"`.

The suite is broader than `e2e/smoke.spec.ts`: focused coverage also exists for
calendar views, tasks, journals, recurrence, time zones, contacts,
imports/exports, sync, settings, accessibility, keyboard navigation, and mobile
layouts. Vitest excludes E2E files and runs its unit tests in both
`America/New_York` and `Europe/Copenhagen`.

## Environment gotchas

- Playwright starts Vite with `CALINO_E2E_MOCK=1`; the mock CalDAV server is
  same-origin at `/mock-caldav/*`. Use `fixtures/dav-server.mjs` for browser
  CORS tests rather than a separate HTTP mock origin.
- The E2E server uses port `5199`; the diagnostics fixture uses HTTPS port
  `8099`. Override them with `E2E_PORT` and `DAV_PORT` respectively.
- `index.html` permits `connect-src 'self' https:`. Custom HTTPS fixtures must
  account for that; the diagnostics fixture uses a self-signed certificate.
- `page.addInitScript()` runs on every navigation, including reloads. Seed
  helpers use session-storage one-shot flags; follow that pattern for new ones.
- Live CalDAV tests require `CALINO_TEST_CALDAV_URL`,
  `CALINO_TEST_CALDAV_USER`, and `CALINO_TEST_CALDAV_PASS`. Never hard-code
  credentials. The gitignored `e2e/.env.test` is only a local reference and is
  not loaded automatically by Playwright.
