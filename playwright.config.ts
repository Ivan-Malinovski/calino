import { defineConfig, devices } from '@playwright/test'

// Deliberately NOT vite's default 5173. `reuseExistingServer` is on locally, so
// sharing a port with `pnpm dev` means Playwright silently attaches to a plain
// dev server that was started without CALINO_E2E_MOCK=1 — the mock CalDAV
// backend is then absent and the sync specs fail in ways that look like flakes.
// Its own port keeps the suite self-contained and lets `pnpm dev` keep running.
const PORT = Number(process.env.E2E_PORT ?? 5199)
const BASE_URL = `http://localhost:${PORT}`
const DAV_PORT = Number(process.env.DAV_PORT ?? 8099)
const IS_CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/__*.template.ts'],
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  // Capped rather than left to Playwright's default (half the CPU count). All
  // workers share ONE vite process, which serves both the module graph and the
  // mock CalDAV middleware — so past a handful of browsers the server, not the
  // machine, is the bottleneck, and sync-driven assertions start timing out.
  // On a 16-core box the default of 8 failed calendar-sync/event-move on every
  // full run while passing them serially; those were never defects. 4 still
  // dropped calendar-sync. 2 is the measured-stable figure, and matches CI —
  // a release gate that cries wolf is a release gate people stop reading.
  // Costs ~4.4m against ~2.3m; override with `--workers=N` for a quick loop.
  workers: 2,
  reporter: IS_CI ? [['github'], ['list']] : [['list']],
  outputDir: './e2e/test-results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
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
    },
  ],
  webServer: [
    {
      command: `CALINO_E2E_MOCK=1 pnpm dev --port ${PORT} --strictPort`,
      url: BASE_URL,
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
