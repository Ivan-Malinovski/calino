import { defineConfig, devices } from '@playwright/test'

// Deliberately NOT vite's default 5173. `reuseExistingServer` is on locally, so
// sharing a port with `pnpm dev` means Playwright silently attaches to a plain
// dev server that was started without CALINO_E2E_MOCK=1 — the mock CalDAV
// backend is then absent and the sync specs fail in ways that look like flakes.
// Its own port keeps the suite self-contained and lets `pnpm dev` keep running.
const PORT = Number(process.env.E2E_PORT ?? 5199)
const BASE_URL = `http://localhost:${PORT}`
const IS_CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/__*.template.ts'],
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 2 : undefined,
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
  webServer: {
    command: `CALINO_E2E_MOCK=1 pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
