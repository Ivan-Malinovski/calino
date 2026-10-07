import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount, seedStoreCalendars } from './fixtures/localstorage'

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function seedEvents(page: Page): Promise<void> {
  const day = todayLocal()
  const make = (id: string, title: string, calendarId: string) => ({
    id,
    uid: `${id}@calino.test`,
    title,
    type: 'event',
    start: `${day}T10:00:00`,
    end: `${day}T11:00:00`,
    isAllDay: false,
    calendarId,
  })
  await page.addInitScript(
    ({ events }) => {
      try {
        if (sessionStorage.getItem('__calino_test_per_calendar_events')) return
        sessionStorage.setItem('__calino_test_per_calendar_events', '1')
        const raw = localStorage.getItem('calino-storage')
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), events }
        localStorage.setItem('calino-storage', JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      events: [make('work-1', 'Work Standup', 'work'), make('home-1', 'Home Dinner', 'home')],
    }
  )
}

async function readDownload(download: import('@playwright/test').Download): Promise<string> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

test.describe('Data settings: per-calendar export and delete', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedStoreCalendars(page, [
      { id: 'work', name: 'Work' },
      { id: 'home', name: 'Home' },
    ])
    await seedEvents(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Data', exact: true }).click()
  })

  test('exports only the chosen calendar', async ({ page }) => {
    await page.locator('[data-action="export-calendar-select"]').selectOption({ label: 'Work' })

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-action="export-ics"]').click(),
    ])
    expect(download.suggestedFilename()).toBe('Work.ics')
    const ics = await readDownload(download)
    expect(ics).toContain('SUMMARY:Work Standup')
    expect(ics).not.toContain('SUMMARY:Home Dinner')
  })

  test('exports every calendar by default', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-action="export-ics"]').click(),
    ])
    const ics = await readDownload(download)
    expect(ics).toContain('SUMMARY:Work Standup')
    expect(ics).toContain('SUMMARY:Home Dinner')
  })

  test('deletes events only from the chosen calendar', async ({ page }) => {
    await page
      .locator('[data-action="delete-events-calendar-select"]')
      .selectOption({ label: 'Work' })

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Work')
      void dialog.accept()
    })
    await page.locator('[data-action="delete-all-events"]').click()

    await page.goto('/week')
    await expect(
      page.locator('[data-component="event-card"]', { hasText: 'Home Dinner' }).first()
    ).toBeVisible()
    await expect(
      page.locator('[data-component="event-card"]', { hasText: 'Work Standup' })
    ).toHaveCount(0)
  })
})

test.describe('Data settings: delete all events from a calendar', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedStoreCalendars(page, [
      { id: 'work', name: 'Work' },
      { id: 'home', name: 'Home' },
    ])
    await seedEvents(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Data', exact: true }).click()
  })

  test('needs a calendar, and the calendar name typed, before it deletes', async ({ page }) => {
    const purge = page.locator('[data-action="purge-calendar"]')
    await expect(purge).toBeDisabled()

    await page.locator('[data-action="purge-calendar-select"]').selectOption({ label: 'Work' })
    await expect(purge).toBeEnabled()
    await purge.click()

    const dialog = page.locator('[data-component="purge-calendar-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('1 event')

    const confirm = dialog.locator('[data-component="purge-calendar-confirm"]')
    await expect(confirm).toBeDisabled()
    await dialog.locator('[data-component="purge-calendar-confirm-input"]').fill('Hom')
    await expect(confirm).toBeDisabled()
    await dialog.locator('[data-component="purge-calendar-confirm-input"]').fill('Work')
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(dialog).toHaveCount(0)

    await page.goto('/week')
    await expect(
      page.locator('[data-component="event-card"]', { hasText: 'Home Dinner' }).first()
    ).toBeVisible()
    await expect(
      page.locator('[data-component="event-card"]', { hasText: 'Work Standup' })
    ).toHaveCount(0)
  })

  test('cancelling leaves every event in place', async ({ page }) => {
    await page.locator('[data-action="purge-calendar-select"]').selectOption({ label: 'Work' })
    await page.locator('[data-action="purge-calendar"]').click()
    const dialog = page.locator('[data-component="purge-calendar-dialog"]')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)

    await page.goto('/week')
    await expect(
      page.locator('[data-component="event-card"]', { hasText: 'Work Standup' }).first()
    ).toBeVisible()
  })
})

const CALENDAR_PATH = '/dav/calendars/user/del-sync/'

test.describe('Data settings: delete all events from a CalDAV calendar', () => {
  test.describe.configure({ mode: 'serial' })

  test('removes the events from the server too', async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(CALENDAR_PATH)}`
    )
    const dump = async (): Promise<Record<string, string>> =>
      (
        await page.request.get(
          `${baseURL!}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(CALENDAR_PATH)}`
        )
      ).json()

    await clearState(page)
    await seedAccount(page, {
      id: 'del-sync-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    const dayCell = page.locator('[data-date]').first()
    await expect(dayCell).toBeVisible({ timeout: 10_000 })
    await dayCell.click()
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal.locator('[data-component="event-title-input"]').fill('Purge me')
    await modal
      .locator('[data-component="event-calendar-select"]')
      .selectOption({ label: 'Del Sync' })
    await modal.locator('[data-component="modal-save"]').click()
    await expect.poll(async () => Object.keys(await dump()).length).toBe(1)

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await page.locator('[data-action="purge-calendar-select"]').selectOption({ label: 'Del Sync' })
    await page.locator('[data-action="purge-calendar"]').click()
    const dialog = page.locator('[data-component="purge-calendar-dialog"]')
    await expect(dialog).toContainText('from both Calino and the server')
    await dialog.locator('[data-component="purge-calendar-confirm-input"]').fill('Del Sync')
    await dialog.locator('[data-component="purge-calendar-confirm"]').click()

    await expect.poll(async () => Object.keys(await dump()).length).toBe(0)
    await expect(dialog).toHaveCount(0)
  })
})
