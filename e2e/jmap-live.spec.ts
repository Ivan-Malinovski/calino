import { test, expect, type APIRequestContext } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

/**
 * Live JMAP round trip against a real server (Stalwart, see docs/JMAP_TESTING.md).
 * Skipped unless CALINO_TEST_JMAP_{URL,USER,PASS} are set; never hard-code them.
 */
const URL = process.env.CALINO_TEST_JMAP_URL
const USER = process.env.CALINO_TEST_JMAP_USER
const PASS = process.env.CALINO_TEST_JMAP_PASS
const LIVE = Boolean(URL && USER && PASS)

type JmapResponse = [string, { ids?: string[] }, string]

const USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:calendars']

async function jmap(request: APIRequestContext, calls: unknown[]): Promise<JmapResponse[]> {
  const auth = { Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}` }
  const session = await (await request.get(`${URL}/jmap/session`, { headers: auth })).json()
  const accountId = Object.keys(session.accounts)[0]
  const apiUrl = new globalThis.URL(session.apiUrl)
  const response = await request.post(`${URL}${apiUrl.pathname}`, {
    headers: auth,
    data: {
      using: USING,
      methodCalls: calls.map((call, index) => {
        const [method, args] = call as [string, Record<string, unknown>]
        return [method, { accountId, ...args }, `c${index}`]
      }),
    },
  })
  return (await response.json()).methodResponses
}

test.describe('JMAP live', () => {
  test.skip(!LIVE, 'CALINO_TEST_JMAP_{URL,USER,PASS} not set — skipping live-server test')
  test.use({ viewport: { width: 1280, height: 800 } })

  // Stalwart only answers CORS preflights on /.well-known/jmap; its /jmap/*
  // endpoints return a bare 204. A real deployment fronts it with a proxy that
  // adds the headers (or uses Calino's account proxy), so this test does the
  // same at the network layer. Server-sent events are not proxied: push is
  // optional and the regular sync path is what is under test.
  test.beforeEach(async ({ page }) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-Requested-With',
      'access-control-allow-methods': 'POST, GET, PATCH, PUT, DELETE, HEAD, OPTIONS',
    }
    await page.route(`${URL}/**`, async (route) => {
      const request = route.request()
      if (request.url().includes('/jmap/eventsource')) return route.abort()
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), ...cors } })
    })
  })

  test('connects with auto-detection, creates an event, and the server has it', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    const title = `Live JMAP ${Date.now()}`
    await clearState(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
    await page.locator('[data-action="add-account"]').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Display name').fill('Live JMAP')
    await dialog.getByLabel('Server URL').fill(URL!)
    await dialog.getByLabel('Username').fill(USER!)
    await dialog.getByLabel('Password').fill(PASS!)
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(
      page
        .locator('[data-component="account-row"][data-account-name="Live JMAP"]')
        .locator('[data-component="account-protocol"]')
    ).toHaveText('JMAP')

    await page.goto('/month')
    // Wait until the sidebar counts the JMAP calendar next to the offline one.
    await expect(page.getByText('2/2')).toBeVisible()
    await page.keyboard.press('c')
    const modal = page.locator('[data-component="modal-card"]')
    const input = modal.locator('[data-component="event-title-input"]')
    await input.fill(title)
    // New events default to the local offline calendar; pick the JMAP one.
    const select = modal.locator('[data-component="event-calendar-select"]')
    // The calendar list hydrates a moment after the reload.
    const jmapOption = select.locator('option[value*="/.jmap/"]')
    await expect(jmapOption).toHaveCount(1)
    const jmapValue = await jmapOption.getAttribute('value')
    await select.selectOption(jmapValue!)
    await input.press('Enter')
    await expect(modal).not.toBeVisible()
    await expect(page.locator('[data-component="calendar-grid"]').getByText(title)).toBeVisible()

    // The write must really reach the server, not just the local store.
    await expect
      .poll(
        async () => {
          const [query] = await jmap(request, [
            ['CalendarEvent/query', { filter: { text: title } }],
          ])
          return query[1].ids?.length ?? 0
        },
        { timeout: 30_000 }
      )
      .toBe(1)

    // Clean up so reruns start clean.
    const [query] = await jmap(request, [['CalendarEvent/query', { filter: { text: title } }]])
    await jmap(request, [['CalendarEvent/set', { destroy: query[1].ids }]])
  })
})
