import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const EVENT_DESCRIPTION = [
  'Agenda at https://example.com/agenda before we start.',
  '',
  'Bring:',
  '',
  '- laptop',
  '- **badge**',
  '',
  '[do not run](javascript:alert(1))',
].join('\n')

const TASK_DESCRIPTION = [
  'Call https://example.com/venue first.',
  '',
  '- ask about **parking**',
  '- confirm the time',
].join('\n')

/** One event and one task today, each with a Markdown description. */
async function seedDescriptions(page: Page): Promise<void> {
  await clearState(page)
  await page.addInitScript(
    ({ eventDescription, taskDescription }) => {
      if (sessionStorage.getItem('__calino_test_markdown_descriptions')) return
      sessionStorage.setItem('__calino_test_markdown_descriptions', '1')
      const at = (hour: number): string => {
        const date = new Date()
        date.setHours(hour, 0, 0, 0)
        return date.toISOString()
      }
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Offline calendar',
                color: '#4285F4',
                isVisible: true,
                isDefault: true,
                showTasksInViews: true,
              },
            ],
            events: [
              {
                id: 'planning-sync',
                calendarId: 'default',
                title: 'Planning sync',
                type: 'event',
                start: at(10),
                end: at(11),
                isAllDay: false,
                description: eventDescription,
              },
              {
                id: 'book-venue',
                calendarId: 'default',
                title: 'Book venue',
                type: 'task',
                start: at(12),
                end: at(12),
                isAllDay: false,
                completed: false,
                description: taskDescription,
              },
            ],
          },
          version: 1,
        })
      )
    },
    { eventDescription: EVENT_DESCRIPTION, taskDescription: TASK_DESCRIPTION }
  )
  // Links open in a new tab; keep that tab off the network.
  await page.context().route('https://example.com/**', (route) => route.fulfill({ body: 'ok' }))
}

async function openEventPreview(page: Page) {
  await page.goto('/month')
  await page
    .getByRole('button', { name: /Planning sync/ })
    .first()
    .click()
  const preview = page.locator('[data-component="event-preview"]')
  await expect(preview).toBeVisible()
  return preview
}

test.describe('Markdown in event descriptions and task notes', () => {
  test.beforeEach(async ({ page }) => {
    await seedDescriptions(page)
  })

  test('an address in an event description opens as a link without starting an edit', async ({
    page,
  }) => {
    const preview = await openEventPreview(page)

    const link = preview.getByRole('link', { name: 'https://example.com/agenda' })
    await expect(link).toHaveAttribute('href', 'https://example.com/agenda')

    const opened = page.waitForEvent('popup')
    await link.click()
    expect((await opened).url()).toBe('https://example.com/agenda')
    await expect(preview.getByRole('textbox')).toHaveCount(0)
  })

  test('an event description shows paragraphs and lists, and drops unsafe links', async ({
    page,
  }) => {
    const preview = await openEventPreview(page)

    await expect(preview.getByRole('listitem')).toHaveText(['laptop', 'badge'])
    await expect(preview.getByText('Bring:', { exact: true })).toBeVisible()
    await expect(preview).not.toContainText('**')
    await expect(preview.getByText('do not run')).toHaveAttribute('href', '')
  })

  test('clicking the description text edits the Markdown source', async ({ page }) => {
    const preview = await openEventPreview(page)

    await preview.getByText('Bring:', { exact: true }).click()

    await expect(preview.getByRole('textbox')).toHaveValue(EVENT_DESCRIPTION)
  })

  test('a task note stays on one line and its link does not open the task', async ({ page }) => {
    await page.goto('/tasks')
    const row = page.locator('main [data-component="task-row"]').filter({ hasText: 'Book venue' })
    const note = row.locator('[data-component="task-note"]')
    await expect(note).toContainText('ask about parking')

    const lineHeight = await note.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).lineHeight)
    )
    expect((await note.boundingBox())?.height).toBeLessThan(lineHeight * 1.5)

    const opened = page.waitForEvent('popup')
    await note.getByRole('link', { name: 'https://example.com/venue' }).click()
    expect((await opened).url()).toBe('https://example.com/venue')
    await expect(page.locator('[data-component="event-preview"]')).toHaveCount(0)
  })

  test('the sidebar task tooltip shows the note without Markdown syntax', async ({ page }) => {
    await page.goto('/month')

    await page.locator('[data-component="mini-task-row"]').filter({ hasText: 'Book venue' }).hover()

    const tooltip = page.locator('[data-component="task-tooltip"]')
    await expect(tooltip.getByRole('listitem')).toHaveText([
      'ask about parking',
      'confirm the time',
    ])
    await expect(tooltip).not.toContainText('**')
  })
})
