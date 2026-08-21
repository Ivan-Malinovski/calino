# Calino - AI Agent Guidelines

**Versioning:** semver, and still pre-1.0 — bump minor for features, patch for fixes. The current version lives in `package.json`.

React 19 + TypeScript + Vite calendar app with CalDAV sync, NLP event creation, and PWA support.

## Commands

```bash
pnpm install          # Install deps
pnpm dev              # Dev server
pnpm build            # Production build
pnpm lint             # ESLint
pnpm lint:fix         # ESLint with auto-fix
pnpm typecheck        # TypeScript
pnpm test             # Run tests (Vitest, jsdom unit tests)
pnpm test:run         # Run tests once
pnpm test:e2e         # Run Playwright smoke tests against the dev server
pnpm test:e2e:ui      # Same, with Playwright's UI inspector
pnpm test:e2e:headed  # Same, in a visible browser window
pnpm format           # Prettier format
pnpm check            # Run all CI checks (typecheck + lint + test + build)
```

## Testing — proactive, not reactive

The Playwright suite is a regression net for the refactor. **Treat it as a
living artifact** — every behavioral change ships with a test, not as a
follow-up.

### Hard rule: write/update a spec before you stop

If you're changing user-visible behavior in this refactor, your task is not
done until a Playwright spec exercises the changed path and passes.

This applies to:

- Stores, hooks, or components that produce visible output (event creation,
  settings, navigation, view switching, sync flows, undo/redo)
- Route changes, command palette commands, keyboard shortcuts, modal triggers
- CalDAV request/response handling, credential storage, sync logic
- Error and loading states the user can observe

It does **not** apply to:

- Internal refactors with no observable change (rename, extract, dedupe)
- Pure type-only changes
- CSS-only changes that don't change semantics

### How to add a spec

1. **Copy the template**: `e2e/templates/user-flow.spec.ts` →
   `e2e/<area>.spec.ts`. The template has the conventions baked in.
2. **Use the existing helpers** from `e2e/fixtures/localstorage.ts`:
   - `clearState(page)` — wipes Calino state + dismisses onboarding/cookie
   - `seedAccount(page, account)` — adds a CalDAV account to localStorage
   - `seedRecurringEvent(page, seed)` — adds a recurring event to the calendar store
3. **Selector order** (most stable first):
   1. `data-component="..."` attributes (exposed throughout `src/features/calendar/components/*`)
   2. `aria-label` for icon-only buttons
   3. `getByRole('button', { name })` or `getByLabel('...')` for labelled elements
4. **Assert on user-visible state**, not implementation details. Prefer
   `getByText(...)` or `toContainText(...)` over checking specific CSS classes
   or data-* attributes you didn't intend to be public.
5. **Run the spec twice**: once on unchanged code (must pass — proves the
   spec actually exercises the feature), then after your change (must still
   pass). `pnpm test:e2e -- --grep "<test name>"` runs a single test.

### Where tests live

- `e2e/smoke.spec.ts` — top-level smoke: app boot, view switcher, command
  palette, modal save, undo/redo, settings nav, CalDAV account add,
  localStorage round-trip. Anything that should pass on every commit.
- `e2e/<area>.spec.ts` — focused specs for individual features:
  `events.spec.ts`, `sync.spec.ts`, `themes.spec.ts`, etc. Add to these
  (or create new files) when you touch a specific feature.

### Naming convention

```
e2e/
  smoke.spec.ts                    # broad coverage, runs on every CI
  events.spec.ts                   # event CRUD, recurrence, NLP
  sync.spec.ts                     # CalDAV account + sync flow
  settings.spec.ts                 # settings persistence per section
  accessibility.spec.ts            # axe-core scans (WCAG A+AA) per surface
  keyboard-nav.spec.ts             # grid arrow navigation, skip link
  ...
  fixtures/
    localstorage.ts                # state-priming helpers
    vite-caldav-mock.ts            # optional same-origin mock (CALINO_E2E_MOCK=1)
  templates/
    user-flow.spec.ts              # starting point for new specs
```

### What a good E2E test looks like

```ts
test('editing a recurring event with "This and following events" splits the series', async ({
  page,
}) => {
  // Arrange: deterministic seed, no NLP / no real CalDAV.
  await seedRecurringEvent(page, { id: 'weekly', title: 'Weekly', ... })

  // Act: drive the UI the way a user would.
  await page.goto('/week')
  await page.getByRole('button', { name: /Weekly/ }).first().click()
  await page.locator('[data-component="event-preview"]')
    .getByRole('button', { name: /Open event/ }).click()
  await page.locator('[data-component="event-title-input"]').fill('Weekly (updated)')
  await page.locator('[data-component="modal-save"]').click()

  // Assert: the dialog appears and the future-only branch works.
  const dialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /This and following events/ }).click()
  await expect(dialog).toBeHidden()
})
```

## E2E Tests (Playwright)

The E2E suite lives in `e2e/`. It runs against the Vite dev server (started
automatically by Playwright via `webServer`) and covers the user-visible flows
a refactor is most likely to break: render, navigation, persistence,
command palette, event creation, undo/redo, view switcher, and CalDAV
account plumbing.

```bash
pnpm test:e2e           # headless, ~12s for the offline tests
pnpm test:e2e:ui        # interactive — set breakpoints, replay failures
pnpm test:e2e:headed    # visible browser window
pnpm test:e2e:report    # open the last HTML report
```

### Live-CalDAV tests

Two specs in `e2e/smoke.spec.ts` exercise a real CalDAV server:
`add CalDAV account flow` and `settings persist across reload`. Both
**skip if any of these env vars is missing** — no credentials are ever
hardcoded:

```bash
CALINO_TEST_CALDAV_URL=https://your-server/principal/
CALINO_TEST_CALDAV_USER=alice
CALINO_TEST_CALDAV_PASS=secret
```

Set them in your shell, in a `.env.test` file (gitignored, see
`e2e/.env.test.example`), or via your CI secrets.

### Known gotchas

- **Vite CSP** blocks `connect-src` to anything other than `'self'` and
  `https:`. Custom-host mocks need a same-origin path or `--disable-web-security`.
- **Onboarding modal** must be dismissed or the modal covers everything.
  `clearState()` handles this; you shouldn't need to touch it.
- **localStorage init scripts** (`page.addInitScript`) re-run on every
  navigation, including `page.reload()`. The provided helpers use
  `sessionStorage` flags so they fire only once per test — copy that
  pattern if you write your own.
- **RecurrenceDialog/DeleteDialog** are plain dialogs (not the shared Modal
  shell). They're named via `aria-labelledby`, so
  `getByRole('dialog', { name: /Edit recurring event/ })` works.

## Release Script
