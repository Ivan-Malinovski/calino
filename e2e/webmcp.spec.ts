import { test, expect, type Page } from '@playwright/test'
import {
  clearState,
  seedRecurringEvent,
  seedJournal,
  seedStoreCalendars,
  STORAGE_KEYS,
} from './fixtures/localstorage'
import type { WebMCPTool } from '../src/features/webmcp/tools'

type TestWindow = Window & {
  webmcpFixture: {
    tools: Map<string, WebMCPTool>
    stale?: WebMCPTool
  }
}

const toolNames = ['list_calendars', 'open_event', 'prepare_event', 'search_events']

test.use({ launchOptions: { args: ['--enable-features=WebMCPTesting'] } })

// Test the producer contract on all browsers without depending on an origin
// trial. Registration is deliberately asynchronous to exercise React cleanup.
async function mockWebMCP(page: Page, failAt?: string, legacy = false): Promise<void> {
  await page.addInitScript(
    ({ failAt, legacy }) => {
      const fixture = {
        tools: new Map<string, WebMCPTool>(),
        stale: undefined as WebMCPTool | undefined,
      }
      ;(window as unknown as TestWindow).webmcpFixture = fixture
      if (legacy) {
        Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined })
        Object.defineProperty(navigator, 'modelContext', {
          configurable: true,
          value: {
            registerTool(tool: WebMCPTool) {
              if (fixture.tools.has(tool.name)) throw new Error('Duplicate registration')
              fixture.tools.set(tool.name, tool)
              if (tool.name === 'search_events') fixture.stale = tool
            },
            unregisterTool(name: string) {
              fixture.tools.delete(name)
            },
          },
        })
        return
      }
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: {
          async registerTool(tool: WebMCPTool, { signal }: { signal: AbortSignal }) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            if (signal.aborted) throw new Error('Aborted')
            if (tool.name === failAt) throw new Error('Registration denied')
            if (fixture.tools.has(tool.name)) throw new Error('Duplicate registration')
            fixture.tools.set(tool.name, tool)
            if (tool.name === 'search_events') fixture.stale = tool
            signal.addEventListener(
              'abort',
              () => {
                if (fixture.tools.get(tool.name) === tool) fixture.tools.delete(tool.name)
              },
              { once: true }
            )
          },
        },
      })
    },
    { failAt, legacy }
  )
}

async function names(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...(window as unknown as TestWindow).webmcpFixture.tools.keys()].sort()
  )
}

async function invoke(page: Page, name: string, input: unknown = {}): Promise<unknown> {
  return page.evaluate(
    ({ name, input }) => {
      const tool = (window as unknown as TestWindow).webmcpFixture.tools.get(name)
      if (!tool) throw new Error(`Tool ${name} is unavailable`)
      return tool.execute(input)
    },
    { name, input }
  )
}

async function enable(page: Page): Promise<void> {
  await page.goto('/settings?tab=data')
  await page.locator('[data-component="toggle"][data-setting="webmcp"]').click()
  await expect(page.getByLabel('Browser AI Access (WebMCP, experimental)')).toBeChecked()
  await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click()
  await expect.poll(() => names(page)).toEqual(toolNames)
}

test.describe('WebMCP browser AI access', () => {
  test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Copenhagen' })

  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.addInitScript((key) => {
      const saved = JSON.parse(localStorage.getItem(key)!)
      saved.state.language = 'en'
      localStorage.setItem(key, JSON.stringify(saved))
    }, STORAGE_KEYS.settings)
  })

  test('Browser AI Access is in Data above Danger Zone and settings search opens Data', async ({
    page,
  }) => {
    await mockWebMCP(page)
    await page.goto('/settings?tab=general')
    await expect(page.getByLabel('Browser AI Access (WebMCP, experimental)')).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Search settings' }).fill('Browser AI Access')
    const result = page.getByRole('option', { name: /Browser AI Access/ })
    await expect(result.getByText('Data', { exact: true })).toBeVisible()
    await result.click()
    const setting = page.locator('[data-component="setting-row"][data-setting="webmcp"]')
    await expect(page.locator('[data-component="data-settings"]')).toBeVisible()
    await setting.scrollIntoViewIfNeeded()
    await expect(page.getByLabel('Browser AI Access (WebMCP, experimental)')).not.toBeChecked()
    const settingBounds = await setting.boundingBox()
    const dangerBounds = await page.getByText('Danger Zone', { exact: true }).boundingBox()
    expect(settingBounds).not.toBeNull()
    expect(dangerBounds).not.toBeNull()
    expect(settingBounds!.y + settingBounds!.height).toBeLessThan(dangerBounds!.y)
    await expect(setting.locator('..').locator('xpath=following-sibling::*[1]')).toContainText(
      'Danger Zone'
    )
  })

  test('consent is off by default, persists, and revokes tools when leaving the calendar', async ({
    page,
  }) => {
    await mockWebMCP(page)
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    expect(await names(page)).toEqual([])
    await enable(page)
    await page.reload()
    await expect.poll(() => names(page)).toEqual(toolNames)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-component="settings-nav-item"][data-tab="data"]').click()
    await expect(page.getByLabel('Browser AI Access (WebMCP, experimental)')).toBeChecked()
    await expect.poll(() => names(page)).toEqual([])
    // Even a consumer retaining the old callback cannot read after cleanup.
    expect(
      await page.evaluate(() =>
        (window as unknown as TestWindow).webmcpFixture.stale!.execute({
          start: '2026-09-01',
          end: '2026-09-01',
        })
      )
    ).toEqual({ error: 'WebMCP access is disabled.' })
    await page.locator('[data-component="toggle"][data-setting="webmcp"]').click()
    await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click()
    await page.reload()
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    expect(await names(page)).toEqual([])
  })

  test('unsupported browsers preserve the normal calendar and show the availability message', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'modelContext', { configurable: true, value: undefined })
    )
    await page.addInitScript(() =>
      Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined })
    )
    await page.goto('/settings?tab=data')
    await expect(
      page.getByText('The WebMCP API is not available on this page.', { exact: false })
    ).toBeVisible()
    await page.locator('[data-component="toggle"][data-setting="webmcp"]').click()
    await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click()
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await page.keyboard.press('c')
    await expect(page.locator('[data-component="modal-card"]')).toBeVisible()
  })

  test('prepares a timed event without saving, protects the draft, and saves through the normal form', async ({
    page,
  }) => {
    await mockWebMCP(page)
    await enable(page)
    const draft = {
      title: 'Agent lunch',
      start: '2026-09-15T12:00',
      end: '2026-09-15T13:30',
      location: 'Cafe',
    }
    expect(await invoke(page, 'prepare_event', draft)).toEqual({
      status: 'awaiting_user_review',
      saved: false,
    })
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await expect(modal.locator('[data-component="event-title-input"]')).toHaveValue(draft.title)
    await expect(modal.locator('[data-component="event-start-date"]')).toHaveValue('2026-09-15')
    await expect(modal.locator('[data-component="event-start-time"]')).toHaveValue('12:00')
    await expect(modal.locator('[data-component="event-end-time"]')).toHaveValue('13:30')
    await expect(modal.locator('[data-component="event-location-input"]')).toHaveValue('Cafe')
    expect(
      await invoke(page, 'search_events', { start: '2026-09-15', end: '2026-09-15' })
    ).toMatchObject({ events: [] })
    expect(await invoke(page, 'prepare_event', { ...draft, title: 'Overwrite' })).toMatchObject({
      error: expect.stringContaining('Close the current form'),
    })
    await expect(modal.locator('[data-component="event-title-input"]')).toHaveValue(draft.title)
    await modal.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(modal).not.toBeVisible()
    expect(
      await invoke(page, 'search_events', { start: '2026-09-15', end: '2026-09-15' })
    ).toMatchObject({ events: [expect.objectContaining({ title: draft.title, location: 'Cafe' })] })
    await expect(
      page.locator('[data-component="calendar-grid"]').getByText(draft.title)
    ).toBeVisible()
  })

  test('prepares an inclusive all-day range and cancellation leaves no event', async ({ page }) => {
    await mockWebMCP(page)
    await enable(page)
    expect(
      await invoke(page, 'prepare_event', {
        title: 'Holiday',
        start: '2026-09-15',
        end: '2026-09-17',
        allDay: true,
      })
    ).toMatchObject({ saved: false })
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal.getByLabel('All day', { exact: true })).toBeChecked()
    await expect(modal.locator('[data-component="event-start-date"]')).toHaveValue('2026-09-15')
    await expect(modal.locator('[data-component="event-end-date"]')).toHaveValue('2026-09-17')
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    expect(
      await invoke(page, 'search_events', { start: '2026-09-15', end: '2026-09-17' })
    ).toMatchObject({ events: [] })
  })

  test('searches recurring occurrences and opens their editor without exposing journals or hidden events', async ({
    page,
  }) => {
    await mockWebMCP(page)
    await seedJournal(page, {
      calendars: [{ id: 'default', name: 'Personal' }],
      entries: [
        {
          id: 'private-journal',
          title: 'Private journal',
          body: 'Secret notes',
          date: '2026-09-15',
          calendarId: 'default',
        },
      ],
    })
    await seedRecurringEvent(page, {
      id: 'weekly-meeting',
      title: 'Weekly meeting',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      startTime: '10:00',
      endTime: '11:00',
      frequency: 'weekly',
      interval: 1,
    })
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('__webmcp_hidden')) return
      sessionStorage.setItem('__webmcp_hidden', '1')
      const saved = JSON.parse(localStorage.getItem(key)!)
      saved.state.calendars.push({
        id: 'hidden',
        name: 'Hidden',
        isVisible: false,
        color: '#4285F4',
      })
      saved.state.events.push({
        id: 'hidden-event',
        type: 'event',
        calendarId: 'hidden',
        title: 'Hidden secret',
        description: 'Never return this',
        start: '2026-09-15T10:00:00Z',
        end: '2026-09-15T11:00:00Z',
        isAllDay: false,
      })
      localStorage.setItem(key, JSON.stringify(saved))
    }, STORAGE_KEYS.calendar)
    await enable(page)
    const result = (await invoke(page, 'search_events', {
      start: '2026-09-01',
      end: '2026-09-30',
      query: 'meeting',
      limit: 2,
    })) as { events: Array<{ id: string }> }
    expect(result).toMatchObject({
      truncated: true,
      timezone: 'Europe/Copenhagen',
      events: [
        expect.objectContaining({ title: 'Weekly meeting' }),
        expect.objectContaining({ title: 'Weekly meeting' }),
      ],
    })
    const all = await invoke(page, 'search_events', { start: '2026-09-15', end: '2026-09-15' })
    expect(JSON.stringify(all)).not.toMatch(
      /Private journal|Secret notes|Hidden secret|Never return this|description|resourceHref|attachments/
    )
    expect(await invoke(page, 'open_event', { eventId: 'private-journal' })).toMatchObject({
      error: expect.any(String),
    })
    expect(await invoke(page, 'open_event', { eventId: 'hidden-event' })).toMatchObject({
      error: expect.any(String),
    })
    expect(await invoke(page, 'open_event', { eventId: 'missing' })).toMatchObject({
      error: expect.any(String),
    })
    expect(
      await invoke(page, 'open_event', { eventId: 'weekly-meeting-2026-09-03T10:00:00.000Z' })
    ).toMatchObject({ error: expect.any(String) })
    expect(await invoke(page, 'open_event', { eventId: result.events[1].id })).toMatchObject({
      status: 'opened',
    })
    await expect(
      page.locator('[data-component="modal-card"] [data-component="event-title-input"]')
    ).toHaveValue('Weekly meeting')
  })

  test('rejects invalid inputs, readonly calendars and calendars without event support', async ({
    page,
  }) => {
    await mockWebMCP(page)
    await seedStoreCalendars(page, [
      { id: 'readonly', name: 'Subscribed', readOnly: true },
      { id: 'default', name: 'Personal' },
    ])
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('__webmcp_tasks')) return
      sessionStorage.setItem('__webmcp_tasks', '1')
      const saved = JSON.parse(localStorage.getItem(key)!)
      saved.state.calendars.push({
        id: 'tasks',
        name: 'Tasks only',
        color: '#4285F4',
        isVisible: true,
        supportedComponents: ['VTODO'],
      })
      localStorage.setItem(key, JSON.stringify(saved))
    }, STORAGE_KEYS.calendar)
    await enable(page)
    expect(await invoke(page, 'list_calendars')).toMatchObject({
      calendars: [
        expect.objectContaining({ id: 'readonly', writable: false }),
        expect.objectContaining({ id: 'default', writable: true }),
        expect.objectContaining({ id: 'tasks', writable: false }),
      ],
    })
    const draft = { title: 'Invalid draft', start: '2026-09-15T12:00', end: '2026-09-15T13:00' }
    for (const invalid of [
      { ...draft, calendarId: 'readonly' },
      { ...draft, calendarId: 'tasks' },
      { ...draft, calendarId: 'unknown' },
      { ...draft, end: draft.start },
      { ...draft, start: '2026-02-30T12:00' },
      { ...draft, start: '2026-03-29T02:30', end: '2026-03-29T03:30' },
      { ...draft, start: '2026-09-15T12:00Z' },
      { ...draft, description: 'Not exposed' },
    ]) {
      expect(await invoke(page, 'prepare_event', invalid)).toMatchObject({
        error: expect.any(String),
      })
    }
    for (const invalid of [
      { start: '2026-09-15', end: '2026-09-14' },
      { start: '2026-09-01', end: '2026-10-02' },
      { start: '2026-02-30', end: '2026-03-01' },
      { start: '2026-09-01', end: '2026-09-02', limit: 51 },
    ]) {
      expect(await invoke(page, 'search_events', invalid)).toMatchObject({
        error: expect.any(String),
      })
    }
    await expect(page.locator('[data-component="modal-card"]')).not.toBeVisible()
    expect(await invoke(page, 'prepare_event', draft)).toMatchObject({ saved: false })
    await expect(
      page
        .locator('[data-component="modal-card"]')
        .getByRole('combobox', { name: 'Calendar', exact: true })
    ).toHaveValue('default')
  })

  test('partial registration failures remove tools without breaking the calendar', async ({
    page,
  }) => {
    await mockWebMCP(page, 'open_event')
    await page.goto('/settings?tab=data')
    await page.locator('[data-component="toggle"][data-setting="webmcp"]').click()
    await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click()
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await expect.poll(() => names(page)).toEqual([])
    await page.keyboard.press('c')
    await expect(page.locator('[data-component="modal-card"]')).toBeVisible()
    expect(await names(page)).toEqual([])
  })
})

test.describe('WebMCP compatibility', () => {
  test.use({ viewport: { width: 1280, height: 800 } })
  test('older browsers register and revoke tools through navigator.modelContext', async ({
    page,
  }) => {
    await clearState(page)
    await mockWebMCP(page, undefined, true)
    await enable(page)
    expect(await invoke(page, 'list_calendars')).toMatchObject({
      calendars: [expect.objectContaining({ id: 'default', writable: true })],
    })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-component="settings-nav-item"][data-tab="data"]').click()
    await expect.poll(() => names(page)).toEqual([])
    await page.locator('[data-component="toggle"][data-setting="webmcp"]').click()
    await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click()
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    expect(await names(page)).toEqual([])
  })
})

test.describe('WebMCP native Chromium API', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Native WebMCP is tested in Chromium.')
  test.use({
    viewport: { width: 1280, height: 800 },
    timezoneId: 'Europe/Copenhagen',
  })

  test('the real browser discovers, invokes and unregisters Calino tools', async ({
    page,
    browser,
  }) => {
    await clearState(page)
    await page.goto('/settings?tab=data')
    await page.locator('[data-component="toggle"][data-setting="webmcp"]').click()
    await page.getByRole('button', { name: 'Back to Calendar', exact: true }).click()
    type NativeContext = {
      getTools: () => Promise<
        Array<{ name: string; inputSchema: string | { required?: string[] } }>
      >
      executeTool: (tool: unknown, input: unknown) => Promise<unknown>
    }
    const discoveredNames = () =>
      page.evaluate(async () => {
        const context = (document as Document & { modelContext: NativeContext }).modelContext
        return (await context.getTools()).map(({ name }) => name).sort()
      })
    await expect.poll(discoveredNames).toEqual(toolNames)
    // Native registration validates the generated schemas. Defaults must
    // remain optional in the schema advertised to browser agents.
    expect(
      await page.evaluate(async () => {
        const context = (document as Document & { modelContext: NativeContext }).modelContext
        return (await context.getTools()).map(({ name, inputSchema }) => ({
          name,
          required:
            (typeof inputSchema === 'string' ? JSON.parse(inputSchema) : inputSchema).required ??
            [],
        }))
      })
    ).toEqual(
      expect.arrayContaining([
        { name: 'prepare_event', required: ['title', 'start', 'end'] },
        { name: 'search_events', required: ['start', 'end'] },
      ])
    )
    const legacyInput = Number(browser.version().split('.')[0]) < 155
    const result = await page.evaluate(
      async ({ legacyInput }) => {
        const context = (document as Document & { modelContext: NativeContext }).modelContext
        const tool = (await context.getTools()).find(({ name }) => name === 'prepare_event')!
        const input = {
          title: 'Native browser draft',
          start: '2026-09-15T12:00',
          end: '2026-09-15T13:00',
        }
        const result = await context.executeTool(tool, legacyInput ? JSON.stringify(input) : input)
        return typeof result === 'string' ? JSON.parse(result) : result
      },
      { legacyInput }
    )
    expect(result).toEqual({ status: 'awaiting_user_review', saved: false })
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal.locator('[data-component="event-title-input"]')).toHaveValue(
      'Native browser draft'
    )
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-component="settings-nav-item"][data-tab="data"]').click()
    await expect.poll(discoveredNames).toEqual([])
  })
})
