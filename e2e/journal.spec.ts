import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount, seedJournal, STORAGE_KEYS } from './fixtures/localstorage'

/**
 * Journal view regressions:
 *  - #85 entries show the year, so 'All' mode is readable across years
 *  - #88 hiding a calendar hides its entries, like events and tasks
 *  - #89 a new entry can be filed into a chosen calendar, and an existing
 *    entry can be moved between calendars
 */
// The journal opens in 'month' mode, scoped to the current month, so the
// seeded entries have to live in it or the list starts empty.
const today = new Date()
const day = (n: number): string =>
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`
const expectedMonthYear = today
  .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  .toUpperCase()

// Collections owned by the journal-move test alone: event-move owns
// move-source/ and work/, and the other specs share personal/.
const J_WORK = '/dav/calendars/user/j-work/'
const J_PERSONAL = '/dav/calendars/user/j-personal/'

/**
 * Snapshot the mock's stored resources under a collection prefix. Returns
 * null on a transient connection reset (the shared dev server can drop a
 * request under parallel load) so expect.poll retries instead of dying.
 */
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

/** The sidebar's calendar list starts collapsed, so reveal it before toggling. */
async function hideCalendar(page: Page, calendarId: string): Promise<void> {
  const section = page.locator('[data-component="calendar-section-toggle"]')
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page
    .locator(`[data-component="calendar-visibility-toggle"][data-calendar-id="${calendarId}"]`)
    .uncheck()
}

/** Click the header sync button and wait for the round-trip to settle. */
async function syncAll(page: Page): Promise<void> {
  await page.locator('[data-component="sync-all-calendars"]').click()
  await expect(
    page.getByText(/All calendars synced\.|Calendars are already syncing\.|Sync failed/).first()
  ).toBeVisible({ timeout: 15_000 })
}

test.describe('Journal view', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedJournal(page, {
      calendars: [
        { id: 'work', name: 'Work' },
        { id: 'personal', name: 'Personal' },
      ],
      entries: [
        {
          id: 'work-entry',
          title: 'Shipped the thing',
          body: 'Deploy went out clean.',
          date: day(15),
          calendarId: 'work',
        },
        {
          id: 'personal-entry',
          title: 'Long walk',
          body: 'Down by the river.',
          date: day(16),
          calendarId: 'personal',
        },
      ],
    })
  })

  test('entry dates include the month and year', async ({ page }) => {
    await page.goto('/journal')
    await page.locator('[data-component="journal-mode-all"]').click()

    const entry = page.locator(`article[data-date="${day(15)}"]`)
    await expect(entry).toContainText('15')
    await expect(entry).toContainText(expectedMonthYear)
  })

  test('hiding a calendar hides its journal entries', async ({ page }) => {
    await page.goto('/journal')

    await expect(page.getByText('Shipped the thing')).toBeVisible()
    await expect(page.getByText('Long walk')).toBeVisible()

    await hideCalendar(page, 'personal')

    await expect(page.getByText('Long walk')).toBeHidden()
    await expect(page.getByText('Shipped the thing')).toBeVisible()
  })

  test('a new entry can be filed into a chosen calendar', async ({ page }) => {
    await page.goto('/journal')
    await page.locator('[data-component="journal-new-entry"]').click()

    const select = page.locator('[data-component="journal-calendar-select"]')
    await expect(select.locator('option')).toHaveText(['Work', 'Personal'])
    await select.selectOption('personal')

    await page.getByPlaceholder('Title (optional)').fill('Filed elsewhere')
    await page.getByPlaceholder('Write something…').fill('Should land in Personal.')
    await page.getByRole('button', { name: 'Save entry' }).click()

    await expect(page.getByText('Filed elsewhere')).toBeVisible()

    // Hiding the chosen calendar must take the new entry with it — proof it
    // was stored against 'personal' rather than the default calendar.
    await hideCalendar(page, 'personal')
    await expect(page.getByText('Filed elsewhere')).toBeHidden()
  })

  test('editing an entry can move it to another calendar', async ({ page, baseURL }) => {
    await clearState(page)
    // Account-linked calendars so create/move reach the mock server. The j-*
    // collections are baked into the mock (see vite-caldav-mock.ts) and owned
    // by this spec, like event-move owns move-source/.
    await seedAccount(page, {
      id: 'journal-move-account',
      name: 'Journal Mock',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [
        { id: 'j-work', name: 'Journal Work', path: 'calendars/user/j-work/', isDefault: true },
        { id: 'j-personal', name: 'Journal Personal', path: 'calendars/user/j-personal/' },
      ],
    })
    for (const prefix of [J_WORK, J_PERSONAL]) {
      await page.request.post(
        `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(prefix)}`
      )
    }
    // A VJOURNAL on the server, dated inside the current month so the journal
    // list (month mode) shows it. The app imports it on the first sync.
    await page.request.put(`${baseURL}/mock-caldav${J_WORK}j-move-entry.ics`, {
      data:
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n` +
        `BEGIN:VJOURNAL\r\nUID:j-move-uid\r\nDTSTART;VALUE=DATE:${day(15).replaceAll('-', '')}\r\n` +
        `SUMMARY:Relocatable entry\r\nDESCRIPTION:Should move to Journal Personal.\r\n` +
        `END:VJOURNAL\r\nEND:VCALENDAR\r\n`,
    })
    // Store calendars (so the picker sees both) + journalEnabled (the view is
    // hidden until it flips on). seedJournal can't be reused: it overwrites
    // the calendars, dropping the account link.
    await page.addInitScript(
      ({ calendarKey, settingsKey }: { calendarKey: string; settingsKey: string }) => {
        try {
          if (sessionStorage.getItem('__calino_test_journal_move')) return
          sessionStorage.setItem('__calino_test_journal_move', '1')
          const raw = localStorage.getItem(calendarKey)
          const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
          parsed.state = {
            ...(parsed.state ?? {}),
            calendars: [
              {
                id: 'j-work',
                name: 'Journal Work',
                color: '#4285F4',
                isVisible: true,
                isDefault: true,
                showTasksInViews: true,
                supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
              },
              {
                id: 'j-personal',
                name: 'Journal Personal',
                color: '#E8710A',
                isVisible: true,
                showTasksInViews: true,
                supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
              },
            ],
          }
          localStorage.setItem(calendarKey, JSON.stringify(parsed))
          const settingsRaw = localStorage.getItem(settingsKey)
          const settings = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
          settings.state = { ...(settings.state ?? {}), journalEnabled: true }
          localStorage.setItem(settingsKey, JSON.stringify(settings))
        } catch {
          /* noop */
        }
      },
      { calendarKey: STORAGE_KEYS.calendar, settingsKey: STORAGE_KEYS.settings }
    )

    await page.goto('/journal')
    await syncAll(page)
    await expect(page.getByText('Relocatable entry').first()).toBeVisible()
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(1)

    // Edit it: the calendar picker now appears on existing entries too (#89).
    await page.getByText('Relocatable entry').first().dblclick()
    const select = page.locator('[data-component="journal-calendar-select"]')
    await expect(select).toBeVisible()
    await select.selectOption('j-personal')
    await page.getByRole('button', { name: 'Save changes' }).click()

    // The VJOURNAL moved on the server: j-personal has it, j-work is empty.
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, J_PERSONAL)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(1)
    const personalIcs = Object.values((await dump(page, baseURL!, J_PERSONAL)) ?? {}).join('\n')
    expect(personalIcs).toContain('Relocatable entry')
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)

    // And the UI tracks it: hiding the source calendar keeps the entry,
    // hiding the target takes it away.
    await hideCalendar(page, 'j-work')
    await expect(page.getByText('Relocatable entry').first()).toBeVisible()
    await hideCalendar(page, 'j-personal')
    await expect(page.getByText('Relocatable entry').first()).toBeHidden()
  })
})
