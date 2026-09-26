/**
 * An event's end is exclusive (RFC 5545), so a timed event that ends exactly
 * at midnight belongs only to the day it starts on. See #187.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

function monthDay(day: number): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function seedEvent(page: Page, id: string, title: string, start: string, end: string) {
  const event = { id, title, type: 'event', start, end, isAllDay: false, calendarId: 'default' }
  await page.addInitScript(
    ({ flagKey, calendarKey, event }) => {
      if (sessionStorage.getItem(flagKey)) return
      sessionStorage.setItem(flagKey, '1')
      const raw = localStorage.getItem(calendarKey)
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
      parsed.state = { ...(parsed.state ?? {}), events: [...(parsed.state?.events ?? []), event] }
      localStorage.setItem(calendarKey, JSON.stringify(parsed))
    },
    { flagKey: `__calino_test_event_${id}`, calendarKey: STORAGE_KEYS.calendar, event }
  )
}

test('month view shows an event ending at midnight only on its start day', async ({ page }) => {
  await clearState(page)
  await seedEvent(
    page,
    'midnight-end',
    'Ends at midnight',
    `${monthDay(10)}T15:00:00`,
    `${monthDay(11)}T00:00:00`
  )
  await seedEvent(
    page,
    'past-midnight',
    'Ends past midnight',
    `${monthDay(20)}T15:00:00`,
    `${monthDay(21)}T00:30:00`
  )
  await page.goto('/month')

  const cell = (day: number) => page.locator(`[data-date="${monthDay(day)}"]`)
  await expect(cell(10).getByText('Ends at midnight')).toBeVisible()
  await expect(cell(11).getByText('Ends at midnight')).toHaveCount(0)

  // Control: an event that really runs into the next day still spans it.
  await expect(cell(20).getByText('Ends past midnight')).toBeVisible()
  await expect(cell(21).locator('[data-component="event-card"]')).toHaveCount(1)
})
