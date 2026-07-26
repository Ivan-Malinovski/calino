import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * CalDAV settings-sync regression suite.
 *
 * The bug being guarded against (R1.22): previously, `fetchSettingsEvent`
 * looked up the settings VEVENT by a per-browser-instance UID
 * (`calino-settings-<uuid>`). On a fresh device — or any device whose
 * localStorage had lost the cached instance ID — the CalDAV REPORT would
 * never find the settings event uploaded by the original device, and
 * `addAccount`'s auto-discovery branch would silently no-op while still
 * firing a misleading "Settings sync enabled" toast. The user would see
 * the toggle enabled but their settings would not be applied.
 *
 * These tests exercise the cross-device round-trip end-to-end through the
 * mock CalDAV server (see `e2e/fixtures/vite-caldav-mock.ts`):
 *   1. A remote settings VEVENT exists on the CalDAV server.
 *   2. A "fresh" Calino session on the same CalDAV account enables sync.
 *   3. The local firstDayOfWeek must change to whatever the server holds.
 *
 * The empty-server case (settings calendar exists but no VEVENT) is also
 * covered to pin the "calendar found" toast wording.
 */

const MOCK_SERVER = (baseURL: string): string => `${baseURL}/mock-caldav/dav/`

// Settings-calendar path inside the mock. Mirrors the constants in
// vite-caldav-mock.ts and SETTINGS_CAL_NAME in CalDAVClient.ts.
const MOCK_SETTINGS_CAL_PATH = '/mock-caldav/dav/calendars/user/calino-settings/'
const MOCK_SETTINGS_FILENAME = 'calino-settings.ics'

/**
 * Build a settings VEVENT in the exact wire format Calino produces
 * (so the mock round-trip is realistic). The UID is the literal
 * `calino-settings` per R1.22.
 */
function buildSettingsVCalendar(firstDayOfWeek: number): string {
  const payload = {
    version: 1,
    syncedAt: new Date().toISOString(),
    settings: { firstDayOfWeek },
  }
  const json = JSON.stringify(payload)
  // Match the base64 charset Calino uses: standard alphabet, padded.
  const base64 = Buffer.from(json, 'utf8').toString('base64')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calino//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:calino-settings',
    'DTSTAMP:20260601T120000Z',
    'DTSTART:19700101T000000Z',
    'DTEND:19700101T000001Z',
    'SUMMARY:Calino Settings',
    'TRANSP:TRANSPARENT',
    'CLASS:PRIVATE',
    'X-CALINO-VERSION:1',
    `ATTACH;ENCODING=BASE64;FMTTYPE=app/json:${base64}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

async function gotoSettings(page: Page): Promise<void> {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

async function enableSyncForAccount(page: Page, accountName: string): Promise<void> {
  // The Enable button is on the Sync section when sync is disabled.
  await page.locator('[data-action="enable-sync"]').click()
  const picker = page.locator('[data-modal="account-picker"]')
  await expect(picker).toBeVisible()
  await picker
    .locator(`[data-account-name="${accountName}"]`)
    .click()
  // The picker closes once enable() resolves.
  await expect(picker).toBeHidden({ timeout: 15_000 })
}

test.describe('CalDAV settings sync', () => {
  // The mock CalDAV server's event store is a singleton for the whole
  // dev-server process (see vite-caldav-mock.ts) — it isn't reset between
  // tests, and both tests below write to the same fixed settings-event
  // path (the UID is a literal `calino-settings` by design, R1.22). Run
  // serially so one test's reset + PUTs can't race another's.
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, baseURL }) => {
    // Scoped to this spec's own collection — an unscoped reset would clear
    // the `personal/` calendar that calendar-sync.spec.ts is using in a
    // parallel worker.
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent('/dav/calendars/user/calino-settings/')}`
    )
    await clearState(page)
  })

  // R1.22 regression — cross-device settings apply.
  //
  // Reproduces the original bug report:
  //   1. Device A enables sync and saves settings → VEVENT exists on server.
  //   2. Device B (or a fresh session) signs into the same account.
  //   3. Auto-discovery / `enable()` finds the existing VEVENT and applies
  //      its payload to the local store.
  //
  // The test pre-seeds the remote VEVENT (step 1's result) and runs the
  // enable flow (step 2-3) inside one session, then asserts the setting
  // was actually applied to the local store.
  test('cross-device: a fresh session pulls and applies settings saved by another device', async ({
    page,
    baseURL,
  }) => {
    // Arrange: account exists, server holds a settings VEVENT with
    // firstDayOfWeek = 0 (Sunday). On the local machine, the default is
    // Monday (1) per getEuropeDefaultFirstDay().
    const accountName = 'Mock Radicale'
    await seedAccount(page, {
      id: 'mock-account',
      name: accountName,
      serverUrl: MOCK_SERVER(baseURL!),
      username: 'user',
      password: 'pass',
    })

    await page.request.put(
      `${baseURL!}${MOCK_SETTINGS_CAL_PATH}${MOCK_SETTINGS_FILENAME}`,
      { data: buildSettingsVCalendar(0) }
    )

    // Sanity: the local default is NOT Sunday before enabling.
    await gotoSettings(page)
    await expect(
      page.locator('[data-setting="first-day-of-week"]')
    ).toHaveAttribute('data-value', '1')

    // Act: enable sync for the only account. `enable()` sees the existing
    // remote VEVENT, calls `pull()`, and merges the remote settings.
    // The Enable button lives on the General tab (not the Sync tab) — see
    // GeneralSettings.tsx. The Sync tab (`CalDAVSettings`) is for managing
    // accounts; the toggle that arms settings sync is on General.
    await enableSyncForAccount(page, accountName)

    // Assert: the merged setting was applied. We re-read the same row
    // after enabling — the data-value attribute reflects the live state.
    await expect(
      page.locator('[data-setting="first-day-of-week"]')
    ).toHaveAttribute('data-value', '0', { timeout: 10_000 })

    // And the radio itself is checked, not just the data-value.
    await expect(
      page.getByRole('radio', { name: 'Sunday' })
    ).toHaveAttribute('aria-checked', 'true')
  })

  // R1.22 regression — the auto-discovery toast must not lie.
  //
  // Previously the toast "Calino Settings found — sync enabled
  // automatically." fired whenever the calendar collection was
  // discovered, even when `fetchSettingsEvent` returned null. Users with
  // a brand-new (empty) settings calendar saw a positive "found" message
  // and assumed their existing settings had been applied — they hadn't.
  //
  // The fix gates the success message on whether we actually pulled and
  // applied a remote payload. The empty-server case must use the softer
  // "calendar found" wording instead.
  test('empty settings calendar: toast says "calendar found", not "settings found"', async ({
    page,
    baseURL,
  }) => {
    await seedAccount(page, {
      id: 'mock-account',
      name: 'Mock Radicale',
      serverUrl: MOCK_SERVER(baseURL!),
      username: 'user',
      password: 'pass',
    })

    // No PUT for the settings VEVENT — the calendar collection exists in
    // the mock, but it is empty.

    await gotoSettings(page)
    await enableSyncForAccount(page, 'Mock Radicale')

    // The softer wording is required; the strong "settings found" claim
    // would be a false positive.
    await expect(
      page.getByText('Calino Settings calendar found — sync enabled.')
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText('Calino Settings found — sync enabled automatically.')
    ).toHaveCount(0)
  })
})