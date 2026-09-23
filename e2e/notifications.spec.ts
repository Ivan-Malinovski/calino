import { expect, test } from '@playwright/test'

test.describe('desktop notification assets', () => {
  test('serves the icon used by browser reminders', async ({ page }) => {
    const response = await page.goto('/apple-touch-icon.png')

    expect(response?.ok()).toBe(true)
    expect(response?.headers()['content-type']).toContain('image/png')
  })
})

test('a reminder for tomorrow says tomorrow in the notification', async ({ page }) => {
  const { clearState, STORAGE_KEYS } = await import('./fixtures/localstorage')
  await clearState(page)
  const now = new Date('2026-09-23T12:00:00')
  await page.clock.install({ time: now })
  await page.addInitScript(({ calendarKey }) => {
    const eventStart = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000)
    const event = {
      id: 'tomorrow-reminder', calendarId: 'default', title: 'Tomorrow appointment',
      start: eventStart.toISOString(), end: eventEnd.toISOString(), isAllDay: false,
      type: 'event', reminders: [{ id: 'day-before', minutesBefore: 1440, method: 'popup' }],
    }
    const raw = localStorage.getItem(calendarKey)
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
    parsed.state = { ...parsed.state, events: [...(parsed.state?.events ?? []), event] }
    localStorage.setItem(calendarKey, JSON.stringify(parsed))
    ;(window as unknown as { reminderBodies: string[] }).reminderBodies = []
    class MockNotification {
      static permission = 'granted'
      onclick: (() => void) | null = null
      constructor(_title: string, options: { body: string }) {
        ;(window as unknown as { reminderBodies: string[] }).reminderBodies.push(options.body)
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification, configurable: true })
  }, { calendarKey: STORAGE_KEYS.calendar })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { reminderBodies: string[] }).reminderBodies
  )).toContainEqual(expect.stringContaining('tomorrow'))
})
