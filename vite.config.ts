import { readFileSync, existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { configDefaults } from 'vitest/config'
import { caldavMockPlugin } from './e2e/fixtures/vite-caldav-mock'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Load self-hosted config at build time (baked into bundle, not served as separate file)
const configPath = new URL('./calino.config.json', import.meta.url)
let calinoConfig: Record<string, unknown> | null = null
if (existsSync(configPath)) {
  try {
    calinoConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    const accountCount = Array.isArray(calinoConfig?.accounts) ? calinoConfig.accounts.length : 0
    console.log('[build] Loaded calino.config.json —', accountCount, 'account(s)')
  } catch (e) {
    console.warn('[build] Failed to parse calino.config.json:', e)
  }
}

// Unset (the default) keeps the dev server localhost-only; see the SECURITY
// note on `server.host` below before setting it.
const devHost = process.env.CALINO_DEV_HOST

export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __CALINO_CONFIG__: JSON.stringify(calinoConfig),
    __CALINO_SELF_HOSTED__: JSON.stringify(!!calinoConfig || process.env.CALINO_SELF_HOSTED === 'true'),
  },
  plugins: [react(), nodePolyfills(), caldavMockPlugin()],
  server: {
    // SECURITY: default to localhost-only. The dev server has known
    // WebSocket arbitrary file read CVEs (CVE-2026-39363, see
    // GHSA-p9ff-h696-f583) — binding to 0.0.0.0 means anyone on the
    // local network can read source files via the dev WebSocket. Set
    // CALINO_DEV_HOST=0.0.0.0 only when you actually need LAN access
    // (e.g. testing on a phone).
    host: devHost ?? 'localhost',
    // Guards against DNS rebinding, so this is a hostname allowlist — bare IPs
    // are permitted by Vite already. Add whatever name you reach the dev box by
    // (plus CALINO_DEV_ALLOWED_HOSTS for one-offs that don't belong in git).
    allowedHosts: [
      'jankyboi',
      'desktop',
      'desktop.camel-vibe.ts.net',
      'localhost',
      ...(process.env.CALINO_DEV_ALLOWED_HOSTS?.split(',').map((h) => h.trim()) ?? []),
    ].filter(Boolean),
    // `hmr.host`/`hmr.port` describe what the *browser* dials, not what we
    // bind. Pinning the host to the bind address breaks every other route (a
    // 0.0.0.0 bind told clients to open ws://0.0.0.0:8080); pinning a separate
    // port breaks reverse proxies like `tailscale serve`, which only forwards
    // the main one. Off localhost, share the server's port and let the client
    // infer the origin from window.location — that also keeps the socket
    // same-origin, so strict extension CSPs allow it under 'self'.
    hmr: devHost ? true : { host: 'localhost', port: 8080 },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      // Second entry for the Android background sync worker, which loads
      // headless.html in an offscreen WebView at the same origin as the app so
      // it can read the stored accounts. It shares the app's modules, so this
      // costs a small extra chunk, not a second copy. See src/headless.ts.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        headless: path.resolve(__dirname, 'headless.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Pin the zone so date handling is asserted against a fixed offset rather
    // than whatever the machine happens to be. Several suites (NLParser,
    // DayEventsPopup, recurrence) were written against a UTC+ zone and only
    // passed by accident of the author's machine; pinning makes that
    // assumption explicit and true on a UTC CI box.
    //
    // The suite runs twice, once either side of UTC, because a single pin can
    // only face one way and both directions have produced real bugs: west is
    // where the `toISOString()` habit breaks (#116, the recurrence UNTIL
    // description), east is where reading a floating date with UTC getters
    // breaks (the all-day UNTIL serializer). A test file cannot pick its own
    // zone — reassigning `process.env.TZ` inside a worker is a no-op, since the
    // zone is resolved before the test runs — so this has to be two projects
    // rather than a helper. Anything genuinely zone-dependent must derive its
    // expectation from the ambient zone, not hardcode one offset.
    projects: [
      { extends: true, test: { name: 'west', env: { TZ: 'America/New_York' } } },
      {
        extends: true,
        test: {
          name: 'east',
          env: { TZ: 'Europe/Copenhagen' },
          // The perf spec asserts wall-clock budgets, so it measures whatever
          // else the machine is doing — and the two projects run concurrently.
          // It has no zone dependence, so one run is the whole of its value.
          exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**', '**/*.perf.test.ts'],
        },
      },
    ],
    // e2e/ is for Playwright tests, not vitest — keep them out of `pnpm test`.
    // .claude/ may contain nested git worktrees with their own copy of this
    // repo; without excluding it, vitest resolves duplicate React/component
    // modules from those worktrees and tests fail with "Invalid hook call".
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'],
    // CSS imports are stubbed to empty by default, which also swallows `?raw`.
    // The contrast tests parse built-in.css as text to re-derive its ratios, so
    // that one file has to come through intact. Scoped deliberately: enabling
    // CSS wholesale would make CSS-module imports return real class names
    // instead of the proxy other tests rely on.
    css: { include: [/built-in\.css/] },
  },
})
