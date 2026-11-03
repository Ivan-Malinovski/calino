import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * An event with attendees must name its ORGANIZER (RFC 5545 §3.8.4.3). Calino
 * never set one on the events it created, so a server that sends invitations
 * (RFC 6638 scheduling, or an iTIP email hook) had nobody to send them from
 * and sent nothing, or refused the event.
 *
 * The organizer is the account's own calendar user address: the first
 * `mailto:` entry of the principal's calendar-user-address-set, else a username
 * that is an email address, else none at all.
 *
 * Owns `user/organizer/` and `userb/organizer/` on the mock (see
 * vite-caldav-mock.ts) and runs serially: two tests share account B's.
 */

const ORGANIZER_A = '/dav/calendars/user/organizer/'
const ORGANIZER_B = '/dav/calendars/userb/organizer/'
const ATTENDEE = 'guest@example.com'

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

/** The one resource stored under `prefix`, unfolded, once it has arrived. */
async function storedIcs(page: Page, baseURL: string, prefix: string): Promise<string> {
  await expect
    .poll(async () => Object.keys((await dump(page, baseURL, prefix)) ?? {}).length, {
      timeout: 15_000,
    })
    .toBe(1)
  const ics = Object.values((await dump(page, baseURL, prefix)) ?? {}).join('\n')
  return ics.replace(/\r?\n[ \t]/g, '')
}

/**
 * Sync, and wait until the account has finished one: the first sync is when an
 * account learns its user's address. The sync button alone is not enough — a
 * click before the accounts have loaded reports success without syncing.
 */
async function syncOnce(page: Page, accountId: string): Promise<void> {
  const syncButton = page.locator('[data-component="sync-all-calendars"]')
  await expect(syncButton).toBeEnabled({ timeout: 15_000 })
  await syncButton.click()
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            (
              JSON.parse(localStorage.getItem('calino_caldav_accounts') ?? '[]') as Array<{
                id: string
                lastSyncAt: string | null
              }>
            ).find((account) => account.id === id)?.lastSyncAt ?? null,
          accountId
        ),
      { timeout: 15_000 }
    )
    .not.toBeNull()
}

/** Create an event with one attendee on `calendarLabel` from the month view. */
async function createInvitation(page: Page, title: string, calendarLabel: string): Promise<void> {
  await page.locator('[data-date]').first().click()
  const modal = page.locator('[data-component="modal-card"]')
  await expect(modal).toBeVisible()
  await modal.locator('[data-component="event-title-input"]').fill(title)
  // Explicit: discovery finds every mock collection, so the seeded default is
  // not necessarily the one a fresh event lands in.
  await modal
    .locator('[data-component="event-calendar-select"]')
    .selectOption({ label: calendarLabel })
  await modal.locator('[data-component="event-advanced-toggle"]').click()
  const attendeeInput = modal.getByLabel('Add attendee email')
  await attendeeInput.fill(ATTENDEE)
  await attendeeInput.press('Enter')
  await modal.locator('[data-component="modal-save"]').click()
  await expect(modal).toBeHidden({ timeout: 10_000 })
}

test.describe('organizer of an event with attendees', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, baseURL }) => {
    await clearState(page)
    for (const prefix of [ORGANIZER_A, ORGANIZER_B]) {
      await page.request.post(
        `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(prefix)}`
      )
    }
  })

  test('names the account user from calendar-user-address-set', async ({ page, baseURL }) => {
    // The username is not an address: only the principal can supply one.
    await seedAccount(page, {
      id: 'organizer-account-a',
      name: 'Organizer Mock',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [{ name: 'Organizer', path: 'calendars/user/organizer/', isDefault: true }],
    })
    await page.goto('/month')
    await syncOnce(page, 'organizer-account-a')

    await createInvitation(page, 'Planning meeting', 'Organizer')

    const ics = await storedIcs(page, baseURL!, ORGANIZER_A)
    expect(ics).toMatch(/^ORGANIZER;CN=Mock User:mailto:user@example\.com$/m)
    expect(ics).toContain(`mailto:${ATTENDEE}`)

    // The event now shows who organizes it.
    const card = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Planning meeting' })
      .first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()
    const modal = page.locator('[data-component="modal-card"]')
    await modal.locator('[data-component="event-advanced-toggle"]').click()
    const advanced = modal.locator('[data-component="event-advanced-options"]')
    await expect(advanced.getByText('Organizer', { exact: true })).toBeVisible()
    await expect(advanced.getByText('Mock User', { exact: true })).toBeVisible()
    await expect(advanced.getByText('user@example.com', { exact: true })).toBeVisible()
  })

  test('falls back to a username that is an email address', async ({ page, baseURL }) => {
    // Account B's principal lists only its own path, the way Radicale does.
    await seedAccount(page, {
      id: 'organizer-account-b-email',
      name: 'Organizer Mock B',
      serverUrl: `${baseURL}/mock-caldav-b/dav/`,
      username: 'pat@example.com',
      password: 'pass',
      calendars: [{ name: 'Organizer B', path: 'calendars/userb/organizer/', isDefault: true }],
    })
    await page.goto('/month')
    await syncOnce(page, 'organizer-account-b-email')

    await createInvitation(page, 'Fallback meeting', 'Organizer B')

    const ics = await storedIcs(page, baseURL!, ORGANIZER_B)
    expect(ics).toMatch(/^ORGANIZER:mailto:pat@example\.com$/m)
  })

  test('leaves the organizer unset when the account has no address', async ({ page, baseURL }) => {
    await seedAccount(page, {
      id: 'organizer-account-b-plain',
      name: 'Organizer Mock B',
      serverUrl: `${baseURL}/mock-caldav-b/dav/`,
      username: 'userb',
      password: 'pass',
      calendars: [{ name: 'Organizer B', path: 'calendars/userb/organizer/', isDefault: true }],
    })
    await page.goto('/month')
    await syncOnce(page, 'organizer-account-b-plain')

    await createInvitation(page, 'Addressless meeting', 'Organizer B')

    const ics = await storedIcs(page, baseURL!, ORGANIZER_B)
    expect(ics).toContain(`mailto:${ATTENDEE}`)
    expect(ics).not.toContain('ORGANIZER')
  })
})
