import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 5173)
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
