import { test, expect, type Page } from '@playwright/test'
import { clearState, seedJournal } from './fixtures/localstorage'

/**
 * Journal view regressions:
 *  - #85 entries show the year, so 'All' mode is readable across years
 *  - #88 hiding a calendar hides its entries, like events and tasks
 *  - #89 a new entry can be filed into a chosen calendar
 */
// The journal opens in 'month' mode, scoped to the current month, so the
// seeded entries have to live in it or the list starts empty.
const today = new Date()
const day = (n: number): string =>
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`
const expectedMonthYear = today
  .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  .toUpperCase()

/** The sidebar's calendar list starts collapsed, so reveal it before toggling. */
async function hidePersonalCalendar(page: Page): Promise<void> {
  const section = page.locator('[data-component="calendar-section-toggle"]')
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page
    .locator('[data-component="calendar-visibility-toggle"][data-calendar-id="personal"]')
    .uncheck()
}

test.describe('Journal view', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedJournal(page, {
      calendars: [
        { id: 'work', name: 'Work' },
        { id: 'personal', name: 'Personal' },
      ],
      entries: [
        {
          id: 'work-entry',
          title: 'Shipped the thing',
          body: 'Deploy went out clean.',
          date: day(15),
          calendarId: 'work',
        },
        {
          id: 'personal-entry',
          title: 'Long walk',
          body: 'Down by the river.',
          date: day(16),
          calendarId: 'personal',
        },
      ],
    })
  })

  test('entry dates include the month and year', async ({ page }) => {
    await page.goto('/journal')
    await page.locator('[data-component="journal-mode-all"]').click()

    const entry = page.locator(`article[data-date="${day(15)}"]`)
    await expect(entry).toContainText('15')
    await expect(entry).toContainText(expectedMonthYear)
  })

  test('hiding a calendar hides its journal entries', async ({ page }) => {
    await page.goto('/journal')

    await expect(page.getByText('Shipped the thing')).toBeVisible()
    await expect(page.getByText('Long walk')).toBeVisible()

    await hidePersonalCalendar(page)

    await expect(page.getByText('Long walk')).toBeHidden()
    await expect(page.getByText('Shipped the thing')).toBeVisible()
  })

  test('a new entry can be filed into a chosen calendar', async ({ page }) => {
    await page.goto('/journal')
    await page.locator('[data-component="journal-new-entry"]').click()

    const select = page.locator('[data-component="journal-calendar-select"]')
    await expect(select.locator('option')).toHaveText(['Work', 'Personal'])
    await select.selectOption('personal')

    await page.getByPlaceholder('Title (optional)').fill('Filed elsewhere')
    await page.getByPlaceholder('Write something…').fill('Should land in Personal.')
    await page.getByRole('button', { name: 'Save entry' }).click()

    await expect(page.getByText('Filed elsewhere')).toBeVisible()

    // Hiding the chosen calendar must take the new entry with it — proof it
    // was stored against 'personal' rather than the default calendar.
    await hidePersonalCalendar(page)
    await expect(page.getByText('Filed elsewhere')).toBeHidden()
  })
})
