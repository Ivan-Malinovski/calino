import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

const today = new Date()
const iso = (daysFromToday: number): string => {
  const date = new Date(today)
  date.setDate(date.getDate() + daysFromToday)
  date.setHours(12, 0, 0, 0)
  return date.toISOString()
}

async function seedLocationEvents(page: Page): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, events }) => {
      try {
        if (sessionStorage.getItem('__calino_test_location_picker')) return
        sessionStorage.setItem('__calino_test_location_picker', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = {
          ...(parsed.state ?? {}),
          calendars: [
            {
              id: 'default',
              name: 'Default Calendar',
              color: '#4285F4',
              isVisible: true,
              isDefault: true,
              showTasksInViews: true,
              supportedComponents: ['VEVENT', 'VTODO'],
            },
          ],
          events,
        }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      calendarKey: STORAGE_KEYS.calendar,
      events: [
        {
          id: 'recent-room',
          calendarId: 'default',
          title: 'Recent room',
          start: iso(-2),
          end: iso(-2),
          isAllDay: false,
          location: 'Recent room',
        },
        {
          id: 'duplicate-room',
          calendarId: 'default',
          title: 'Duplicate room',
          start: iso(-1),
          end: iso(-1),
          isAllDay: false,
          location: '  recent   ROOM ',
        },
        {
          id: 'old-room',
          calendarId: 'default',
          title: 'Old room',
          start: iso(-45),
          end: iso(-45),
          isAllDay: false,
          location: 'Old archive room',
        },
        {
          id: 'future-room',
          calendarId: 'default',
          title: 'Future room',
          start: iso(45),
          end: iso(45),
          isAllDay: false,
          location: 'Future archive room',
        },
      ],
    }
  )
}

test.describe('event location picker', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedLocationEvents(page)
  })

  test('shortlists recent locations, searches history, and works while editing', async ({
    page,
  }) => {
    await page.goto('/month')

    await page.keyboard.press('c')
    const modal = page.getByRole('dialog')
    const location = modal.locator('input[role="combobox"]')
    await expect(location).toBeVisible()
    const inputHeightBeforeOpen = (await location.boundingBox())?.height
    await location.focus()

    const options = page.locator('[data-component="location-picker-option"]')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toHaveText('recent ROOM')
    expect((await location.boundingBox())?.height).toBe(inputHeightBeforeOpen)
    const optionsBox = await page
      .locator('[data-component="location-picker-options"]')
      .boundingBox()
    const footerBox = await modal.locator('[data-component="modal-footer"]').boundingBox()
    expect(optionsBox?.y).toBeGreaterThanOrEqual(0)
    expect((optionsBox?.y ?? 0) + (optionsBox?.height ?? 0)).toBeLessThanOrEqual(footerBox?.y ?? 0)

    await location.fill('archive')
    await expect(options).toHaveCount(2)
    await expect(options).toContainText(['Future archive room', 'Old archive room'])

    await options.filter({ hasText: 'Old archive room' }).click()
    await expect(location).toHaveValue('Old archive room')

    await modal.getByRole('button', { name: 'Cancel' }).click()

    const recentCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Recent room' })
      .first()
    await expect(recentCard).toBeVisible()
    await recentCard.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()

    const editModal = page.getByRole('dialog')
    const editLocation = editModal.locator('input[role="combobox"]')
    await expect(editLocation).toHaveValue('Recent room')
    await editLocation.focus()
    await expect(page.locator('[data-component="location-picker-option"]')).toHaveCount(1)
  })
})
