import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'
import { jmapMockResponse } from './fixtures/vite-jmap-mock'

async function openAccountForm(page: import('@playwright/test').Page, path = '/mock-jmap') {
  await clearState(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
  await page.locator('[data-action="add-account"]').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Display name').fill('JMAP fixture')
  await dialog.getByLabel('Server URL').fill(`${new URL(page.url()).origin}${path}`)
  await dialog.getByLabel('Username').fill('fixture-user')
  await dialog.getByLabel('Password').fill('fixture-password')
  return dialog
}

test('auto-detects JMAP, shows its protocol, and preserves it after reload and edit', async ({
  page,
}) => {
  let releaseListing: () => void = () => {}
  const listingGate = new Promise<void>((resolve) => {
    releaseListing = resolve
  })
  let listings = 0
  await page.route('**/mock-jmap/api', async (route) => {
    const request = route.request()
    const body = request.postData() ?? ''
    if (body.includes('Calendar/get') && ++listings === 2) await listingGate
    await route.fulfill(jmapMockResponse(request.url(), request.method(), body))
  })
  const dialog = await openAccountForm(page)
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  try {
    await expect(dialog.locator('[data-component="account-protocol"]')).toHaveText('JMAP')
  } finally {
    releaseListing()
  }
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  const row = page.locator('[data-component="account-row"][data-account-name="JMAP fixture"]')
  await expect(row.locator('[data-component="account-protocol"]')).toHaveText('JMAP')
  await page.reload()
  await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
  await expect(row.locator('[data-component="account-protocol"]')).toHaveText('JMAP')
  await row.locator('[data-action="edit-account"]').click()
  const edit = page.getByRole('dialog')
  await edit.locator('[data-action="test-connection"]').click()
  await expect(edit.locator('[data-component="account-protocol"]')).toHaveText('JMAP')
  await edit.getByRole('button', { name: 'Save Changes' }).click()
  await expect(edit).toBeHidden({ timeout: 30_000 })
  await expect(row.locator('[data-component="account-protocol"]')).toHaveText('JMAP')
})

test('JMAP authentication errors highlight the password without attempting CalDAV', async ({
  page,
}) => {
  await page.route('**/mock-jmap/**', (route) =>
    route.fulfill({
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Basic realm="JMAP fixture"',
      },
      body: '{}',
    })
  )
  const davRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PROPFIND') davRequests.push(request.url())
  })
  const dialog = await openAccountForm(page, '/mock-jmap/jmap/session')
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('The server rejected these credentials.')
  await expect(dialog.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true')
  expect(davRequests).toEqual([])
})

test('Connection settings can force CalDAV and shows the stored protocol', async ({ page }) => {
  const dialog = await openAccountForm(page, '/mock-caldav/')
  await dialog.getByRole('button', { name: /Connection settings/ }).click()
  await dialog.locator('[data-action="force-caldav"]').check()
  const jmapRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/.well-known/jmap')) jmapRequests.push(request.url())
  })
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(
    page.locator('[data-component="account-row"] [data-component="account-protocol"]').first()
  ).toHaveText('CalDAV')
  expect(jmapRequests).toEqual([])
})

test('diagnostics for a JMAP account check JMAP, not DAV', async ({ page }) => {
  await page.route('**/mock-jmap/api', (route) => {
    const request = route.request()
    return route.fulfill(
      jmapMockResponse(request.url(), request.method(), request.postData() ?? '')
    )
  })
  const dialog = await openAccountForm(page)
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  const row = page.locator('[data-component="account-row"][data-account-name="JMAP fixture"]')
  await row.locator('[data-action="diagnose-account"]').click()
  const panel = page.locator('[data-component="diagnostics-panel"]')
  await expect(panel.locator('[data-summary]')).toBeVisible({ timeout: 30_000 })
  await expect(panel.locator('[data-check="jmap-session"]')).toHaveAttribute('data-status', 'pass')
  await expect(panel.locator('[data-check="jmap-api"]')).toHaveAttribute('data-status', 'pass')
  await expect(panel.locator('[data-check="jmap-calendars"]')).toHaveAttribute(
    'data-status',
    'pass'
  )
  await expect(panel.locator('[data-check="dav-class"]')).toHaveCount(0)
})

test('diagnosing a rejected password names the credentials and skips the rest quietly', async ({
  page,
}) => {
  await page.route('**/mock-jmap/**', (route) =>
    route.fulfill({
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Basic realm="JMAP fixture"',
      },
      body: '{}',
    })
  )
  const dialog = await openAccountForm(page, '/mock-jmap/jmap/session')
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await dialog.locator('[data-action="show-diagnostics"]').click()

  const panel = dialog.locator('[data-component="diagnostics-panel"]')
  await expect(panel.locator('[data-summary="broken"]')).toContainText(
    'rejected the username or password'
  )
  await expect(panel.locator('[data-check="auth"]')).toHaveAttribute('data-status', 'fail')
  const skipped = panel.locator('[data-check="jmap-session"]')
  await expect(skipped).toHaveAttribute('data-status', 'skipped')
  // "inferred" describes how a verdict was reached; a skipped check has none.
  await expect(skipped).not.toContainText('inferred')
})
