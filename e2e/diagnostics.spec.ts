/**
 * Diagnostics, in a real browser against a real cross-origin server.
 *
 * The unit tests for `runDiagnostics` stub `fetch`, which means they check the
 * engine against my model of CORS rather than against CORS. Everything the
 * feature exists to detect — a rejected preflight, a header the browser refuses
 * to expose — only happens inside a browser talking to another origin, so these
 * specs drive the actual UI against `e2e/fixtures/dav-server.mjs` on its own
 * port. Start it with `node e2e/fixtures/dav-server.mjs` (the specs skip if it
 * isn't up).
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

const DAV = `https://localhost:${process.env.DAV_PORT ?? 8099}`

// The stub serves a self-signed cert; Calino's CSP (`connect-src 'self' https:`)
// rules out testing this over plain http.
test.use({ ignoreHTTPSErrors: true })

/** The stub is a separate process; don't fail the suite when it isn't running. */
test.beforeAll(async ({ request }) => {
  const up = await request
    .fetch(`${DAV}/good/`, { method: 'OPTIONS', failOnStatusCode: false })
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!up, `No DAV stub on ${DAV} — run: node e2e/fixtures/dav-server.mjs`)
})

/**
 * Seed an account pointing at one of the stub's scenarios and open its
 * diagnostics from Settings. This is the entry point that works regardless of
 * whether the server is healthy — the Add Calendar route only offers
 * diagnostics after a failure, which the good-server cases never produce.
 */
async function diagnoseSeededAccount(page: Page, path: string): Promise<void> {
  await page.goto('/')
  await clearState(page)
  await seedAccount(page, {
    name: 'Stub',
    serverUrl: `${DAV}${path}`,
    username: 'alice',
    password: 'hunter2',
  })
  await page.goto('/settings?tab=caldav')

  await page.locator('[data-action="diagnose-account"]').first().click()
  await expect(page.locator('[data-component="diagnostics-panel"]')).toBeVisible()
  // The run streams; the summary banner only appears once it has finished.
  await expect(page.locator('[data-summary]')).toBeVisible({ timeout: 30_000 })
}

/** Fill the Add Calendar form without submitting, for the error-copy specs. */
async function fillAccountForm(page: Page, path: string): Promise<void> {
  await page.goto('/')
  await clearState(page)
  await page.goto('/')

  // The sidebar's "+" opens a small menu; its first item is the CalDAV one.
  await page.getByLabel('Add calendar').first().click()
  await page.getByRole('button', { name: 'Add CalDAV Account' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/server url/i).fill(`${DAV}${path}`)
  await dialog.getByLabel(/username/i).fill('alice')
  await dialog.getByLabel(/^password/i).fill('hunter2')
}

function check(page: Page, id: string) {
  return page.locator(`[data-check="${id}"]`)
}

test.describe('diagnostics against a real server', () => {
  test('a correctly configured server passes every check', async ({ page }) => {
    await diagnoseSeededAccount(page, '/good/')

    await expect(check(page, 'reachable')).toHaveAttribute('data-status', 'pass')
    await expect(check(page, 'preflight')).toHaveAttribute('data-status', 'pass')
    await expect(check(page, 'auth')).toHaveAttribute('data-status', 'pass')
    await expect(check(page, 'propfind-depth1')).toHaveAttribute('data-status', 'pass')
    await expect(page.locator('[data-summary]')).toHaveAttribute('data-summary', 'ok')
  })

  test('blames the preflight, not the password, when CORS is off', async ({ page }) => {
    // The case that motivated the whole feature: to the page this is an opaque
    // network error, indistinguishable from the server being down.
    await diagnoseSeededAccount(page, '/no-cors/')

    await expect(check(page, 'preflight')).toHaveAttribute('data-status', 'fail')
    // Reachability uses mode:'no-cors', which survives where the DAV request
    // dies — that contrast is the entire basis for blaming CORS over downtime.
    await expect(check(page, 'reachable')).toHaveAttribute('data-status', 'pass')

    await check(page, 'preflight').getByRole('button').click()
    await expect(check(page, 'preflight')).toContainText('Access-Control-Allow-Origin')

    // A verdict the browser wouldn't let us read must not claim we read it.
    await expect(check(page, 'preflight')).toContainText('inferred')
  })

  test('warns, but does not fail, when ETag is not exposed', async ({ page }) => {
    await diagnoseSeededAccount(page, '/no-etag/')

    await expect(check(page, 'expose-etag')).toHaveAttribute('data-status', 'warn')
    await expect(check(page, 'preflight')).toHaveAttribute('data-status', 'pass')
    // Sync still works, so the account must not be reported as broken.
    await expect(page.locator('[data-summary]')).toHaveAttribute('data-summary', 'degraded')
  })

  test('reports rejected credentials as an auth problem', async ({ page }) => {
    await diagnoseSeededAccount(page, '/401/')

    await expect(check(page, 'auth')).toHaveAttribute('data-status', 'fail')
    await expect(check(page, 'preflight')).toHaveAttribute('data-status', 'pass')
  })

  test('the write test creates and removes a resource', async ({ page }) => {
    await diagnoseSeededAccount(page, '/good/')

    await page.locator('[data-action="run-write-test"]').click()
    await expect(check(page, 'write-roundtrip')).toBeVisible({ timeout: 30_000 })
    await expect(check(page, 'write-roundtrip')).toHaveAttribute('data-status', 'pass')
  })

  test('copying the report leaves out the credentials', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await diagnoseSeededAccount(page, '/good/')

    await page.locator('[data-action="copy-report"]').click()
    const text = await page.evaluate(() => navigator.clipboard.readText())

    expect(text).toContain('localhost')
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('alice')
  })
})

test.describe('connection errors', () => {
  test('explains a failure instead of showing the raw exception', async ({ page }) => {
    await fillAccountForm(page, '/no-cors/')
    await page
      .getByRole('button', { name: /test connection|add calendar/i })
      .last()
      .click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(/couldn't reach the server/i)
    await expect(dialog).not.toContainText('Failed to fetch')
    await expect(dialog).not.toContainText('TypeError')
  })
})

test.describe('first-run setup page', () => {
  test('explains a failed test and offers diagnostics', async ({ page }) => {
    await page.goto('/setup')

    await page.locator('#setup-url').fill(`${DAV}/no-cors/`)
    await page.locator('#setup-username').fill('alice')
    await page.locator('#setup-password').fill('hunter2')
    await page.getByRole('button', { name: /test connection/i }).click()

    await expect(page.getByText(/couldn't reach the server/i)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('body')).not.toContainText('Failed to fetch')

    // The page had no diagnostics at all before; this is the new affordance.
    await page.locator('[data-action="show-diagnostics"]').click()
    await expect(page.locator('[data-component="diagnostics-panel"]')).toBeVisible()
    await expect(page.locator('[data-summary]')).toBeVisible({ timeout: 30_000 })
    await expect(check(page, 'preflight')).toHaveAttribute('data-status', 'fail')
  })
})
