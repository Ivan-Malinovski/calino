import { test, expect, type Page } from '@playwright/test'
import ICAL from 'ical.js'
import { clearState, seedAccount } from './fixtures/localstorage'

// Inspect the resource the server actually saved, rather than only the local
// optimistic task. Run serially: discovery shares the mock Personal collection.
test.describe('CalDAV task due alarms', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ timezoneId: 'America/New_York' })

  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL}/mock-caldav/__test__/reset?prefix=${encodeURIComponent('/dav/calendars/user/personal/')}`
    )
    await clearState(page)
    await seedAccount(page, {
      id: 'alarm-account',
      name: 'Mock CalDAV',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })
    await page.addInitScript(() => {
      if (sessionStorage.getItem('alarm-settings')) return
      sessionStorage.setItem('alarm-settings', '1')
      const settings = JSON.parse(localStorage.getItem('calino-settings')!)
      Object.assign(settings.state, {
        homeTimezone: 'Europe/Copenhagen',
        dateFormat: 'yyyy-MM-dd',
        timeFormat: '24h',
      })
      localStorage.setItem('calino-settings', JSON.stringify(settings))
    })
  })

  async function openTasks(page: Page) {
    await page.goto('/tasks')
    await page.locator('[data-component="sync-all-calendars"]').click()
    await expect(
      page.getByText(/All calendars synced\.|Calendars are already syncing\./)
    ).toBeVisible()
  }

  async function create(page: Page, title: string, mode = 'datetime') {
    await page.locator('[data-component="add-task-button"]').click()
    const composer = page.getByPlaceholder('What needs doing?')
    await composer.fill(title)
    await composer.press('Enter')
    const modal = page.locator('[data-component="modal-card"]')
    await modal
      .locator('[data-component="event-calendar-select"]')
      .selectOption({ label: 'Personal' })
    await modal.locator(`[data-component="due-mode-${mode}"]`).click()
    if (mode !== 'none') {
      await modal.locator('#due-date').fill('2027-03-27')
      await modal.locator('#due-date').press('Tab')
    }
    if (mode === 'datetime') {
      await modal.locator('#due-time').fill('16:30')
      await modal.locator('#due-time').press('Tab')
    }
    return modal
  }

  async function save(page: Page): Promise<ICAL.Component> {
    const written = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes('/personal/') && r.ok()
    )
    await page.locator('[data-component="modal-save"]').click()
    const response = await written
    const saved = await page.request.get(response.url())
    expect(saved.ok()).toBeTruthy()
    return new ICAL.Component(ICAL.parse(await saved.text())).getFirstSubcomponent('vtodo')!
  }

  function triggers(todo: ICAL.Component) {
    return todo
      .getAllSubcomponents('valarm')
      .map((a) => a.getFirstProperty('trigger')!.toICALString())
  }

  test('creates one UTC alarm, reschedules across DST, and removes its own alarm on completion', async ({
    page,
  }) => {
    await openTasks(page)
    await create(page, 'Due alarm across DST')
    let todo = await save(page)
    expect(triggers(todo)).toEqual(['TRIGGER;VALUE=DATE-TIME:20270327T153000Z'])
    expect(todo.getFirstSubcomponent('valarm')!.getFirstPropertyValue('action')).toBe('DISPLAY')
    await page.reload()
    const row = page
      .locator('[data-component="task-row"]')
      .filter({ hasText: 'Due alarm across DST' })
    await row.click()
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal.locator('#due-time')).toHaveValue('16:30')
    await modal.locator('#due-date').fill('2027-03-28')
    await modal.locator('#due-date').press('Tab')
    todo = await save(page)
    // The wall time stays 16:30, but Copenhagen has advanced one hour.
    expect(triggers(todo)).toEqual(['TRIGGER;VALUE=DATE-TIME:20270328T143000Z'])
    await row.click()
    await modal.getByRole('checkbox', { name: 'Completed', exact: true }).check()
    todo = await save(page)
    expect(todo.getFirstPropertyValue('status')).toBe('COMPLETED')
    expect(triggers(todo)).toEqual([])
  })

  test('preserves imported alarms and their offsets when the task is rescheduled', async ({
    page,
    baseURL,
  }) => {
    const href = `${baseURL}/mock-caldav/dav/calendars/user/personal/imported-alarm.ics`
    await page.request.put(href, {
      data: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VTODO',
        'UID:imported-alarm',
        'SUMMARY:Imported alarm task',
        'DUE;TZID=Europe/Copenhagen:20270327T163000',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:One hour before',
        'TRIGGER;VALUE=DATE-TIME:20270327T143000Z',
        'END:VALARM',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Relative to due',
        'TRIGGER;RELATED=END:-PT30M',
        'END:VALARM',
        'END:VTODO',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    })
    await openTasks(page)
    await page
      .locator('[data-component="task-row"]')
      .filter({ hasText: 'Imported alarm task' })
      .click()
    await page.locator('#due-date').fill('2027-03-28')
    await page.locator('#due-date').press('Tab')
    const todo = await save(page)
    expect(triggers(todo)).toEqual([
      'TRIGGER;VALUE=DATE-TIME:20270328T133000Z',
      'TRIGGER;RELATED=END:-PT30M',
    ])
    expect(
      todo.getAllSubcomponents('valarm').map((a) => a.getFirstPropertyValue('description'))
    ).toEqual(['One hour before', 'Relative to due'])
  })

  for (const mode of ['date-only', 'none', 'recurring']) {
    test(`removes its own alarm when a timed task becomes ${mode}`, async ({ page }) => {
      await openTasks(page)
      const title = `Convert timed task to ${mode}`
      await create(page, title)
      expect(triggers(await save(page))).toHaveLength(1)
      await page.locator('[data-component="task-row"]').filter({ hasText: title }).click()
      const modal = page.locator('[data-component="modal-card"]')
      if (mode === 'recurring') {
        await modal.locator('[data-component="task-recurrence"]').getByRole('checkbox').check()
      } else {
        await modal.locator(`[data-component="due-mode-${mode}"]`).click()
      }
      expect(triggers(await save(page))).toEqual([])
    })
  }

  for (const mode of ['date-only', 'none', 'recurring', 'completed']) {
    test(`does not invent an absolute alarm for a ${mode} task`, async ({ page }) => {
      await openTasks(page)
      const modal = await create(
        page,
        `No fixed alarm ${mode}`,
        ['date-only', 'none'].includes(mode) ? mode : 'datetime'
      )
      if (mode === 'recurring')
        await modal.locator('[data-component="task-recurrence"]').getByRole('checkbox').check()
      if (mode === 'completed')
        await modal.getByRole('checkbox', { name: 'Completed', exact: true }).check()
      const todo = await save(page)
      expect(triggers(todo)).toEqual([])
      if (mode === 'date-only') expect(todo.toString()).toContain('DUE;VALUE=DATE:20270327')
      if (mode === 'none') expect(todo.hasProperty('due')).toBe(false)
      if (mode === 'recurring') expect(todo.hasProperty('rrule')).toBe(true)
      if (mode === 'completed') expect(todo.getFirstPropertyValue('status')).toBe('COMPLETED')
    })
  }
})
