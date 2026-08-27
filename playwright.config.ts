import { defineConfig, devices } from '@playwright/test'

// Deliberately NOT vite's default 5173. `reuseExistingServer` is on locally, so
// sharing a port with `pnpm dev` means Playwright silently attaches to a plain
// dev server that was started without CALINO_E2E_MOCK=1 — the mock CalDAV
// backend is then absent and the sync specs fail in ways that look like flakes.
// Its own port keeps the suite self-contained and lets `pnpm dev` keep running.
const PORT = Number(process.env.E2E_PORT ?? 5199)
const BASE_URL = `http://localhost:${PORT}`
const BROWSER_SESSION_PORT = Number(process.env.BROWSER_SESSION_E2E_PORT ?? PORT + 1)
const BROWSER_SESSION_BASE_URL = `http://localhost:${BROWSER_SESSION_PORT}`
const DAV_PORT = Number(process.env.DAV_PORT ?? 8099)
const IS_CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/__*.template.ts'],
  fullyParallel: true,
  forbidOnly: IS_CI,
  // Locally 1, not 0. CI has always retried twice, so a zero-retry local run
  // was the strictest gate anywhere — and `calendar-sync:295` is intermittent
  // under parallel load: it asserts a deleted occurrence has gone while the
  // app's own sync may still be in flight, and loses that race maybe one run
  // in three. It passes serially every time and the product behaviour is
  // sound. A retry does not hide a real break (that fails both attempts); it
  // stops a known race from blocking a release. The race itself is worth
  // fixing in the spec rather than papering over indefinitely.
  retries: IS_CI ? 2 : 1,
  // Capped rather than left to Playwright's default (half the CPU count). All
  // workers share ONE vite process, which serves both the module graph and the
  // mock CalDAV middleware — so past a handful of browsers the server, not the
  // machine, is the bottleneck, and sync-driven assertions start timing out.
  // On a 16-core box the default of 8 failed calendar-sync/event-move on every
  // full run while passing them serially; those were never defects. 4 still
  // dropped calendar-sync. 2 matches CI and is the fewest failures observed,
  // but it is not on its own sufficient — calendar-sync:295 has flaked here
  // too, which is what the raised expect timeout below is for.
  // Costs ~4.6m against ~2.3m; override with `--workers=N` for a quick loop.
  workers: 2,
  reporter: IS_CI ? [['github'], ['list']] : [['list']],
  outputDir: './e2e/test-results',
  timeout: 30_000,
  // 10s, not Playwright's 5s default. Nearly every assertion in this suite is
  // an eventual-consistency wait — a sync landing, a persisted store
  // hydrating, a delete propagating to the mock backend — and the workers
  // share one vite process, so under load those legitimately take longer than
  // 5s. Raising it hides nothing: a genuinely wrong assertion still fails,
  // 5s later. `calendar-sync:295` and `journal-timezone:104` both timed out
  // here while passing serially in ~3s.
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/browser-session-dav.spec.ts'],
    },
    {
      name: 'browser-session-dav',
      testMatch: ['**/browser-session-dav.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BROWSER_SESSION_BASE_URL,
      },
    },
  ],
  webServer: [
    {
      command: `CALINO_DEV_HOST=localhost CALINO_E2E_MOCK=1 pnpm dev --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // A separately compiled app instance exercises the deployment-time
      // browser-session DAV configuration without auto-connecting every
      // other E2E spec to a CalDAV account.
      command: `CALINO_DEV_HOST=localhost CALINO_E2E_MOCK=1 VITE_CALINO_BROWSER_SESSION_DAV_URL=/mock-caldav/dav/ VITE_CALINO_BROWSER_SESSION_ACCOUNT_NAME='Managed Calendar' pnpm dev --port ${BROWSER_SESSION_PORT} --strictPort`,
      url: BROWSER_SESSION_BASE_URL,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // A DAV server on its own origin, for e2e/diagnostics.spec.ts. The vite
      // mock can't serve those specs: it's middleware on the app's origin, so
      // its responses are same-origin and never exercise CORS — which is the
      // only thing diagnostics has to reason about. HTTPS because the app's
      // CSP is `connect-src 'self' https:`; the cert is self-signed, hence
      // `ignoreHTTPSErrors` in the spec.
      command: `node e2e/fixtures/dav-server.mjs`,
      url: `https://localhost:${DAV_PORT}/good/`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !IS_CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
