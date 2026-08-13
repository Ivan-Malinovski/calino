import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * An all-day recurring series must end on the day the user picked, in the
 * user's own zone — and RFC 5545 §3.3.10 requires UNTIL to match DTSTART's
 * value type, so a `VALUE=DATE` DTSTART needs a `VALUE=DATE` UNTIL.
 *
 * It got neither. EventModal built the event's stored `rruleString` from a
 * recurrence rule with no `isAllDay`, and writeRRule (icalTypeMapping) prefers
 * that stored string over rebuilding from the rule — so the timed branch won
 * and the server was sent `UNTIL=20270101T045959Z` for a series the user ended
 * on 2026-12-31. West of UTC that instant is the *next* day, so the series ran
 * a day long on every other client too.
 *
 * Unit tests can't catch this: it lives in which string wins on the way out.
 * This spec pins the bytes, with the browser pinned to America/New_York so the
 * UTC instant and the local day fall on different sides of midnight.
 */

const END_ON = '2026-12-31'

// Owned outright by this spec (see vite-caldav-mock.ts): it asserts the exact
// contents of a single stored resource, so it cannot share with a parallel spec.
const R_UNTIL = '/dav/calendars/user/r-until/'

test.use({ timezoneId: 'America/New_York' })

/** Snapshot the mock's stored resources, retrying transient resets. */
async function dump(
  page: Page,
  baseURL: string,
  prefix: string
): Promise<Record<string, string> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await page.request.get(
        `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(prefix)}`
      )
      return (await response.json()) as Record<string, string>
    } catch {
      if (attempt === 2) return null
      await page.waitForTimeout(250)
    }
  }
  return null
}

test.describe('All-day recurrence UNTIL across the UTC boundary', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'r-until-account',
      name: 'Recurrence Until Mock',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [
        {
          id: 'r-until',
          name: 'Recurrence Until',
          path: 'calendars/user/r-until/',
          isDefault: true,
        },
      ],
    })
    await page.request.post(
      `${baseURL}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(R_UNTIL)}`
    )
  })

  test('stores UNTIL as the picked date, not a UTC instant a day later', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/month')

    const cell = page.getByRole('button', { name: /^\w+day, / }).first()
    await expect(cell).toBeVisible()
    await cell.click()

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal.locator('[data-component="event-title-input"]').fill('All-day series')
    // Explicit: discovery finds every mock collection, so the seeded default
    // is not necessarily the one a fresh event lands in.
    await modal
      .locator('[data-component="event-calendar-select"]')
      .selectOption({ label: 'Recurrence Until' })
    await modal.getByText('All day', { exact: true }).click()
    await modal.getByText('Recurring', { exact: true }).click()
    await modal.locator('#recurrence-select').selectOption('daily')
    await modal.locator('#end-condition-select').selectOption('on')
    await modal.getByLabel('End date').fill(END_ON)
    await modal.locator('[data-component="modal-save"]').click()
    await expect(modal).toBeHidden({ timeout: 10_000 })

    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, R_UNTIL)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(1)

    const ics = Object.values((await dump(page, baseURL!, R_UNTIL)) ?? {}).join('\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:')
    expect(ics).toMatch(/UNTIL=20261231(?!T)/)
    expect(ics).not.toContain('UNTIL=20270101T045959Z')

    // The description the user reads has to agree with the stored rule.
    const card = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'All-day series' })
      .first()
    await expect(card).toBeVisible()
    await card.click()
    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
    await expect(preview.locator('[data-tooltip]').first()).toHaveAttribute(
      'data-tooltip',
      /until December 31, 2026/
    )
  })
})
