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

  test('edits a recurring event at its original CalDAV href without duplicating it', async ({
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

    const date = new Date()
    const day = date.toISOString().slice(0, 10).replaceAll('-', '')
    const calendarUrl = `${baseURL}/mock-caldav/dav/calendars/user/personal/`
    const originalHref = `${calendarUrl}server-generated-name.ics`
    await page.request.put(originalHref, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:recurring-remote-uid\r\nDTSTART:${day}T120000Z\r\nDTEND:${day}T130000Z\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Remote recurring event\r\nSEQUENCE:0\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    const seededReport = await page.request.fetch(calendarUrl, {
      method: 'REPORT',
      data: '<calendar-query xmlns="urn:ietf:params:xml:ns:caldav"/>',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
    })
    expect(await seededReport.text()).toContain('Remote recurring event')

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const stored = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
            return (stored.state?.events ?? []).map((event: { title: string }) => event.title)
          }),
        { timeout: 10_000 }
      )
      .toContain('Remote recurring event')
    const eventCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Remote recurring event' })
      .first()
    await expect(eventCard).toBeVisible({ timeout: 10_000 })
    await eventCard.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()
    await page
      .locator('[data-component="event-title-input"]')
      .fill('Remote recurring event updated')
    await page.locator('[data-component="modal-save"]').click()

    const recurrenceDialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/i })
    await recurrenceDialog.getByRole('button', { name: /All events/i }).click()
    await expect(page.getByText('Remote recurring event updated').first()).toBeVisible()

    const report = await page.request.fetch(calendarUrl, {
      method: 'REPORT',
      data: '<calendar-query xmlns="urn:ietf:params:xml:ns:caldav"/>',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
    })
    const body = await report.text()
    expect(body).toContain('server-generated-name.ics')
    expect(body).toContain('SUMMARY:Remote recurring event updated')
    expect(body.match(/UID:recurring-remote-uid/g)).toHaveLength(1)
  })

  test('shows a recurring occurrence moved by another CalDAV client', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'moved-occurrence-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    const original = new Date()
    original.setUTCHours(9, 0, 0, 0)
    const moved = new Date(original)
    moved.setUTCDate(moved.getUTCDate() + 1)
    moved.setUTCHours(11, 0, 0, 0)
    const formatIcal = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace('.000', '')
    const calendarUrl = `${baseURL}/mock-caldav/dav/calendars/user/personal/`
    await page.request.put(`${calendarUrl}external-moved-series.ics`, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:external-moved-series\r\nDTSTART:${formatIcal(original)}\r\nDTEND:${formatIcal(new Date(original.getTime() + 3600000))}\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:External weekly meeting\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:external-moved-series\r\nRECURRENCE-ID:${formatIcal(original)}\r\nDTSTART:${formatIcal(moved)}\r\nDTEND:${formatIcal(new Date(moved.getTime() + 3600000))}\r\nSUMMARY:Moved by external client\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()

    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'Moved by external client' })
    ).toBeVisible({ timeout: 10_000 })
  })

  test('does not apply a midnight EXDATE to a timed occurrence', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'timed-exdate-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    const first = new Date()
    first.setUTCHours(15, 20, 0, 0)
    const second = new Date(first)
    second.setUTCDate(second.getUTCDate() + 1)
    const midnightExdate = new Date(second)
    midnightExdate.setUTCHours(0, 0, 0, 0)
    const formatIcal = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace('.000', '')
    const calendarUrl = `${baseURL}/mock-caldav/dav/calendars/user/personal/`
    await page.request.put(`${calendarUrl}timed-midnight-exdate.ics`, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:timed-midnight-exdate\r\nDTSTART:${formatIcal(first)}\r\nDTEND:${formatIcal(new Date(first.getTime() + 3000000))}\r\nRRULE:FREQ=DAILY;COUNT=2\r\nEXDATE:${formatIcal(midnightExdate)}\r\nSUMMARY:Timed EXDATE regression\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/agenda')
    await page.locator('[data-component="sync-all-calendars"]').click()

    await expect(
      page.locator('main').getByText('Timed EXDATE regression', { exact: true })
    ).toHaveCount(2, {
      timeout: 10_000,
    })
  })

  test('persists a single-occurrence edit in the master CalDAV resource', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'atomic-override-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    const occurrence = new Date()
    occurrence.setUTCHours(15, 20, 0, 0)
    const formatIcal = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace('.000', '')
    const calendarUrl = `${baseURL}/mock-caldav/dav/calendars/user/personal/`
    await page.request.put(`${calendarUrl}atomic-series.ics`, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:atomic-series\r\nDTSTART:${formatIcal(occurrence)}\r\nDTEND:${formatIcal(new Date(occurrence.getTime() + 3000000))}\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Atomic recurring master\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    const card = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Atomic recurring master' })
      .first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()
    await page.locator('[data-component="event-title-input"]').fill('Atomic recurring override')
    await page.locator('[data-component="modal-save"]').click()
    const dialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/i })
    await dialog.getByRole('button', { name: /This event only/i }).click()
    await expect(
      page
        .locator('[data-component="event-card"]')
        .filter({ hasText: 'Atomic recurring override' })
        .first()
    ).toBeVisible({ timeout: 10_000 })

    const report = await page.request.fetch(calendarUrl, {
      method: 'REPORT',
      data: '<calendar-query xmlns="urn:ietf:params:xml:ns:caldav"/>',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
    })
    const body = await report.text()
    expect(body.match(/UID:atomic-series/g)).toHaveLength(2)
    expect(body).toContain('RECURRENCE-ID:')
    expect(body).toContain('SUMMARY:Atomic recurring override')

    await page.reload()
    await page.locator('[data-component="sync-all-calendars"]').click()
    await expect(
      page
        .locator('[data-component="event-card"]')
        .filter({ hasText: 'Atomic recurring override' })
        .first()
    ).toBeVisible({ timeout: 10_000 })

    const importedOverride = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Atomic recurring override' })
      .first()
    await importedOverride.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: 'Delete' })
      .click()
    const deleteDialog = page.getByRole('dialog').filter({ hasText: /Delete recurring event/i })
    await deleteDialog.getByRole('button', { name: /This event only/i }).click()
    await expect(importedOverride).toBeHidden()

    const reportAfterDelete = await page.request.fetch(calendarUrl, {
      method: 'REPORT',
      data: '<calendar-query xmlns="urn:ietf:params:xml:ns:caldav"/>',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
    })
    const bodyAfterDelete = await reportAfterDelete.text()
    expect(bodyAfterDelete.match(/UID:atomic-series/g)).toHaveLength(1)
    expect(bodyAfterDelete).not.toContain('SUMMARY:Atomic recurring override')
    expect(bodyAfterDelete).toContain('EXDATE:')
  })
})
