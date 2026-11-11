import { test, expect, type Page } from '@playwright/test'
import { clearState, seedStoreCalendars, STORAGE_KEYS } from './fixtures/localstorage'

/**
 * "Show only this calendar": isolating one calendar from the sidebar hides the
 * rest, and "Show all" puts back the selection from before isolating — not
 * simply every calendar.
 */

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const CALENDARS = [
  { id: 'work', name: 'Work', color: '#4285F4' },
  { id: 'home', name: 'Home', color: '#0F9D58' },
  { id: 'family', name: 'Family', color: '#E8710A' },
]

async function seedEvents(page: Page): Promise<void> {
  const day = todayLocal()
  const events = [
    ['work-1', 'Work Standup', 'work', '09'],
    ['home-1', 'Home Dinner', 'home', '12'],
    ['family-1', 'Family Call', 'family', '15'],
  ].map(([id, title, calendarId, hour]) => ({
    id,
    uid: `${id}@calino.test`,
    title,
    type: 'event',
    start: `${day}T${hour}:00:00`,
    end: `${day}T${hour}:45:00`,
    isAllDay: false,
    calendarId,
  }))
  await page.addInitScript(
    ({ key, events }) => {
      try {
        if (sessionStorage.getItem('__calino_test_isolate_events')) return
        sessionStorage.setItem('__calino_test_isolate_events', '1')
        const raw = localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), events }
        localStorage.setItem(key, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { key: STORAGE_KEYS.calendar, events }
  )
}

const toggle = (page: Page, calendarId: string) =>
  page.locator(`[data-component="calendar-visibility-toggle"][data-calendar-id="${calendarId}"]`)

const row = (page: Page, calendarId: string) =>
  page.locator('label').filter({ has: toggle(page, calendarId) })

const card = (page: Page, title: string) =>
  page.locator('[data-component="event-card"]', { hasText: title })

async function expectVisibility(page: Page, expected: Record<string, boolean>): Promise<void> {
  for (const [calendarId, checked] of Object.entries(expected)) {
    if (checked) await expect(toggle(page, calendarId)).toBeChecked()
    else await expect(toggle(page, calendarId)).not.toBeChecked()
  }
}

test.describe('Sidebar: show only one calendar', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedStoreCalendars(page, CALENDARS)
    await seedEvents(page)
    await page.goto('/week')
    await page.locator('[data-component="calendar-section-toggle"]').click()
    await expect(card(page, 'Family Call').first()).toBeVisible()

    // Start from a mixed selection so restoring it differs from "show every calendar".
    await toggle(page, 'family').uncheck()
    await expectVisibility(page, { work: true, home: true, family: false })
    await expect(card(page, 'Family Call')).toHaveCount(0)
  })

  test('isolates from the context menu and restores the previous selection', async ({ page }) => {
    const showAll = page.locator('[data-component="show-all-calendars"]')
    await expect(showAll).toHaveCount(0)

    await row(page, 'work').click({ button: 'right' })
    await page.locator('[data-component="calendar-isolate"]').click()

    await expectVisibility(page, { work: true, home: false, family: false })
    await expect(card(page, 'Work Standup').first()).toBeVisible()
    await expect(card(page, 'Home Dinner')).toHaveCount(0)
    await expect(page.locator('[data-component="calendar-section-toggle"]')).toContainText('1/3')

    // The isolated state survives a reload, along with the way back.
    await page.reload()
    const section = page.locator('[data-component="calendar-section-toggle"]')
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
    await expectVisibility(page, { work: true, home: false, family: false })
    await expect(showAll).toBeVisible()
    await expect(showAll).toHaveAccessibleName('Show all calendars')

    await showAll.click()

    await expectVisibility(page, { work: true, home: true, family: false })
    await expect(card(page, 'Home Dinner').first()).toBeVisible()
    await expect(card(page, 'Family Call')).toHaveCount(0)
    await expect(showAll).toHaveCount(0)
  })

  test('Alt-click isolates, and the context menu then offers the way back', async ({ page }) => {
    await toggle(page, 'home').click({ modifiers: ['Alt'] })

    await expectVisibility(page, { work: false, home: true, family: false })
    await expect(card(page, 'Home Dinner').first()).toBeVisible()
    await expect(card(page, 'Work Standup')).toHaveCount(0)

    // Isolating another calendar switches the solo target but keeps the
    // original selection to return to.
    await toggle(page, 'family').click({ modifiers: ['Alt'] })
    await expectVisibility(page, { work: false, home: false, family: true })

    await row(page, 'work').click({ button: 'right' })
    await expect(page.locator('[data-component="calendar-isolate"]')).toHaveCount(0)
    await page.locator('[data-component="calendar-show-all"]').click()

    await expectVisibility(page, { work: true, home: true, family: false })
    await expect(page.locator('[data-component="show-all-calendars"]')).toHaveCount(0)
  })

  test('a plain click still toggles just that calendar', async ({ page }) => {
    await toggle(page, 'home').click()

    await expectVisibility(page, { work: true, home: false, family: false })
    await expect(page.locator('[data-component="show-all-calendars"]')).toHaveCount(0)
  })
})
