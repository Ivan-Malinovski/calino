import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

test.describe('calendar discovery sync', () => {
  test('reload discovers remote calendars and the header action syncs all accounts', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'mock-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    await page.goto('/month')

    const syncAll = page.locator('[data-component="sync-all-calendars"]')
    await expect(syncAll).toBeEnabled({ timeout: 10_000 })
    await syncAll.click()
    await expect(page.getByText(/All calendars synced\.|Calendars are already syncing\./)).toBeVisible({ timeout: 10_000 })

    // Discovery does not rely only on the previously persisted calendar list.
    await page.locator('[data-component="calendar-section-toggle"]').click()
    await expect(page.getByText('Personal', { exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test('sync refreshes the name and color of an existing calendar', async ({ page, baseURL }) => {
    await clearState(page)
    const accountId = await seedAccount(page, {
      id: 'mock-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })
    const calendarUrl = `${baseURL}/mock-caldav/dav/calendars/user/personal/`

    await page.addInitScript(
      ({ accountId, calendarUrl }) => {
        const staleCalendar = {
          id: calendarUrl,
          accountId,
          url: calendarUrl,
          name: 'Outdated calendar',
          color: '#FF0000',
          ctag: null,
          syncToken: null,
          isVisible: true,
          isDefault: true,
          showTasksInViews: true,
        }
        localStorage.setItem('calino_caldav_calendars', JSON.stringify([staleCalendar]))
        localStorage.setItem('calino-storage', JSON.stringify({ state: { calendars: [staleCalendar] }, version: 1 }))
      },
      { accountId, calendarUrl }
    )

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    await expect(page.getByText(/All calendars synced\.|Calendars are already syncing\./)).toBeVisible()

    await page.locator('[data-component="calendar-section-toggle"]').click()
    const calendar = page.getByText('Personal', { exact: true }).locator('..')
    await expect(calendar).toBeVisible()
    await expect(calendar.locator('button').first()).toHaveCSS('background-color', 'rgb(59, 130, 246)')
  })

  test('imports Planify PRIORITY:0 as no priority', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'mock-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })
    await page.request.put(`${baseURL}/mock-caldav/dav/calendars/user/personal/planify-none.ics`, {
      data: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:planify-none
SUMMARY:Planify task without priority
PRIORITY:0
END:VTODO
END:VCALENDAR`,
    })

    await page.goto('/tasks')
    await page.locator('[data-component="sync-all-calendars"]').click()
    const task = page.locator('main').getByText('Planify task without priority')
    await expect(task).toBeVisible({ timeout: 10_000 })
    await task.click()

    await expect(page.locator('#priority-select')).toHaveValue('')
  })
})
