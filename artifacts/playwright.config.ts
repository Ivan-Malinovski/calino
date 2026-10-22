import { defineConfig } from '@playwright/test';

// Standalone concept checks: pnpm exec playwright test -c artifacts/playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: 'category-styling.pw.ts',
  outputDir: '../node_modules/.cache/category-styling-results',
  reporter: 'list',
  use: { browserName: 'chromium' },
});
