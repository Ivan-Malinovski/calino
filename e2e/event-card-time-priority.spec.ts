import { test, expect } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// A card's time line must show the whole time; a long location is what gets cut.
test.describe('event card — time outranks location', () => {
  test('a long location ellipsizes before the time does', async ({ page }) => {
    await clearState(page)
    await page.addInitScript(
      ({ keys }) => {
        try {
          if (sessionStorage.getItem('__calino_test_time_priority')) return
          sessionStorage.setItem('__calino_test_time_priority', '1')
          const settingsRaw = localStorage.getItem(keys.settings)
          const settings = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
          settings.state = { ...settings.state, monthViewEventLimit: 0 }
          localStorage.setItem(keys.settings, JSON.stringify(settings))
          const now = new Date().toISOString()
          const raw = localStorage.getItem(keys.calendar)
          const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
          parsed.state = {
            ...(parsed.state ?? {}),
            events: [
              {
                id: 'tp-1',
                title: 'Q1 Retrospective',
                type: 'event',
                start: '2026-10-28T12:00:00.000Z',
                end: '2026-10-28T13:30:00.000Z',
                allDay: false,
                location: 'Conference Room Alpha, Building 4',
                calendarId: 'default',
                createdAt: now,
                updatedAt: now,
              },
            ],
          }
          localStorage.setItem(keys.calendar, JSON.stringify(parsed))
        } catch {
          /* noop */
        }
      },
      { keys: STORAGE_KEYS }
    )
    await page.clock.setFixedTime('2026-10-26T12:00:00')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/month')

    const card = page.getByText('Q1 Retrospective').first()
    await expect(card).toBeVisible()

    const time = page.getByText(/^\d{1,2}:\d{2}.* - .*\d{1,2}:\d{2}/).first()
    const location = page.getByText(/Conference Room/).first()
    await expect(time).toBeVisible()

    // Compare the laid-out text against its box with sub-pixel precision: scrollWidth rounds, and the
    // time used to lose a fraction of a pixel, which was enough to show an ellipsis.
    const clipped = (locator: typeof time) =>
      locator.evaluate((el) => {
        const box = el.closest('[class*="location"]') ?? el
        const range = document.createRange()
        range.selectNodeContents(box)
        return range.getBoundingClientRect().width > box.getBoundingClientRect().width + 0.01
      })

    expect(await clipped(time)).toBe(false)
    expect(await clipped(location)).toBe(true)
  })
})
