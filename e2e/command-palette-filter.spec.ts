import { test, expect } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

test.describe('command palette event filters', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.addInitScript(
      ({ calendarKey }) => {
        const calendars = [
          {
            id: 'default',
            name: 'Work',
            color: '#4285F4',
            isVisible: true,
            isDefault: true,
            showTasksInViews: true,
          },
          {
            id: 'personal',
            name: 'Personal',
            color: '#E8710A',
            isVisible: true,
            isDefault: false,
            showTasksInViews: true,
          },
        ]
        const events = [
          {
            id: 'title-match',
            calendarId: 'default',
            title: 'Roadmap sync',
            description: 'Review milestones',
            location: 'Copenhagen office',
            start: '2026-08-10T09:00:00.000Z',
            end: '2026-08-10T10:00:00.000Z',
            isAllDay: false,
            type: 'event',
          },
          {
            id: 'description-match',
            calendarId: 'personal',
            title: 'Design review',
            description: 'Roadmap planning notes',
            location: 'Berlin studio',
            start: '2026-08-15T13:00:00.000Z',
            end: '2026-08-15T14:00:00.000Z',
            isAllDay: false,
            type: 'event',
          },
          {
            id: 'excluded-match',
            calendarId: 'personal',
            title: 'Roadmap private',
            description: 'Roadmap discussion',
            location: 'Berlin studio',
            start: '2026-08-12T13:00:00.000Z',
            end: '2026-08-12T14:00:00.000Z',
            isAllDay: false,
            type: 'event',
          },
          {
            id: 'weekly-match',
            calendarId: 'default',
            title: 'Weekly roadmap',
            description: 'Recurring planning',
            location: 'Copenhagen office',
            start: '2026-08-03T10:00:00.000Z',
            end: '2026-08-03T11:00:00.000Z',
            isAllDay: false,
            type: 'event',
            recurrence: { frequency: 'weekly', interval: 1 },
          },
          {
            id: 'task-match',
            calendarId: 'default',
            title: 'Roadmap task',
            description: 'Prepare the launch checklist',
            location: 'Copenhagen office',
            start: '2026-08-19T09:00:00.000Z',
            end: '2026-08-19T10:00:00.000Z',
            dueDate: '2026-08-20',
            isAllDay: false,
            type: 'task',
          },
          {
            id: 'journal-match',
            calendarId: 'personal',
            title: 'Roadmap journal',
            description: 'A note about the release',
            location: '',
            start: '2026-08-18',
            end: '2026-08-19',
            isAllDay: true,
            type: 'journal',
          },
        ]
        const raw = localStorage.getItem(calendarKey)
        const stored = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        stored.state = { ...(stored.state ?? {}), calendars, events }
        localStorage.setItem(calendarKey, JSON.stringify(stored))
      },
      { calendarKey: STORAGE_KEYS.calendar }
    )
  })

  async function openPalette(page: import('@playwright/test').Page) {
    await page.goto('/month')
    const searchButton = page.getByRole('button', { name: 'Search or commands' })
    await expect(searchButton).toBeVisible()
    await searchButton.click()
    const palette = page.locator('[data-component="command-palette"]')
    await expect(palette).toBeVisible()
    return palette
  }

  test('filters titles/descriptions, excludes keywords, shows metadata, and finds recurring rows', async ({
    page,
  }) => {
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Roadmap')
    await palette.getByRole('button', { name: 'Filter events' }).click()
    const filterToggle = palette.getByRole('button', { name: 'Hide filters' })
    await expect(filterToggle).toHaveAttribute(
      'data-open',
      'true'
    )
    const inputBox = await palette.getByRole('combobox').boundingBox()
    const toggleBox = await filterToggle.boundingBox()
    expect(inputBox).not.toBeNull()
    expect(toggleBox).not.toBeNull()
    expect(toggleBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width)

    await expect(
      palette.locator('[data-component="command-palette-chip"] > span').first()
    ).toHaveText('Roadmap')
    await expect(palette.getByRole('option', { name: /Roadmap sync/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /Design review/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /Roadmap task/ })).toContainText('20 Aug 2026')
    await expect(palette.getByText('Work', { exact: true }).first()).toBeVisible()
    await expect(palette.getByText('Personal', { exact: true }).first()).toBeVisible()
    await expect(palette.locator('mark').first()).toBeVisible()

    const exclude = palette.getByLabel('Exclude keywords')
    await exclude.fill('private')
    await exclude.press('Enter')
    await expect(palette.getByRole('option', { name: /Roadmap private/ })).toHaveCount(0)

    await palette.getByLabel('Location').fill('Berlin')
    await expect(palette.getByRole('option', { name: /Design review/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /Roadmap sync/ })).toHaveCount(0)

    await palette.getByLabel('Location').fill('')
    await palette.getByLabel('From').fill('2026-08-17')
    await palette.getByLabel('To').fill('2026-08-17')
    await expect(palette.getByRole('option', { name: /Weekly roadmap/ })).toBeVisible()

    await palette.getByRole('button', { name: 'Hide filters' }).click()
    await expect(palette.locator('[data-component="command-palette-filters"]')).toHaveCount(0)
    await expect(palette.getByRole('button', { name: 'Filter events' })).toHaveAttribute(
      'data-open',
      'false'
    )
    await expect(palette.getByRole('option', { name: /Weekly roadmap/ })).toBeVisible()
  })
})
