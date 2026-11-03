import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

/** Local YYYY-MM-DD, matching how the app stores date-only values. */
function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

/**
 * Two events three days apart, so the agenda has empty days to collapse into a
 * free-range row.
 */
async function seedEventsWithGap(page: Page): Promise<void> {
  const first = new Date()
  first.setHours(9, 0, 0, 0)
  const second = new Date(first)
  second.setDate(second.getDate() + 3)

  await page.addInitScript(
    ({
      calendarKey,
      flagKey,
      firstDay,
      secondDay,
    }: {
      calendarKey: string
      flagKey: string
      firstDay: string
      secondDay: string
    }) => {
      try {
        if (sessionStorage.getItem(flagKey)) return
        sessionStorage.setItem(flagKey, '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = {
          ...(parsed.state ?? {}),
          events: [
            ...(parsed.state?.events ?? []),
            {
              id: 'language-gap-start',
              title: 'Gap start',
              type: 'event',
              start: `${firstDay}T09:00:00`,
              end: `${firstDay}T10:00:00`,
              isAllDay: false,
              calendarId: 'default',
            },
            {
              id: 'language-gap-end',
              title: 'Gap end',
              type: 'event',
              start: `${secondDay}T09:00:00`,
              end: `${secondDay}T10:00:00`,
              isAllDay: false,
              calendarId: 'default',
            },
          ],
        }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      calendarKey: STORAGE_KEYS.calendar,
      flagKey: '__calino_test_language_events',
      firstDay: isoDay(first),
      secondDay: isoDay(second),
    }
  )
}

test.describe('language settings', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('switches the interface language and keeps the choice after reload', async ({ page }) => {
    await page.goto('/settings')

    const language = page.locator('[data-setting="language"]')
    await expect(language).toBeVisible()

    const selector = language.locator('select')
    await expect(selector).toHaveValue('en')

    await selector.selectOption('da')
    await expect(selector).toHaveValue('da')
    await expect(language).toHaveAttribute('data-value', 'da')

    await page.goto('/month')
    await page.getByRole('button', { name: 'Tilføj kalender', exact: true }).first().click()
    await page.getByRole('button', { name: 'Tilføj CalDAV-konto', exact: true }).click()
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Tilføj CalDAV-konto', exact: true })
    ).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(page.getByRole('button', { name: 'Forrige', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Næste', exact: true })).toBeVisible()
    const desktopSwitcher = page.locator('[data-component="view-switcher"]')
    await expect(desktopSwitcher.getByRole('button', { name: 'Måned', exact: true })).toBeVisible()
    await expect(desktopSwitcher.getByRole('button', { name: 'Uge', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Indstillinger', exact: true }).first().hover()
    await expect(
      page.getByRole('button', { name: 'Alle indstillinger →', exact: true })
    ).toBeVisible()

    await page.goto('/settings')
    await expect(page.locator('[data-component="settings-page"]')).toBeVisible()
    await expect(page.locator('[data-setting="language"]').getByRole('combobox')).toHaveValue('da')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/month')
    const mobileSwitcher = page.locator('[data-component="nav-pill-switcher"]')
    await expect(mobileSwitcher.getByRole('button', { name: 'Måned', exact: true })).toBeVisible()
    await expect(mobileSwitcher.getByRole('button', { name: 'Uge', exact: true })).toBeVisible()
  })

  test('loads and persists each added interface language', async ({ page }) => {
    await page.goto('/settings')

    const language = page.locator('[data-setting="language"]')
    const selector = language.getByRole('combobox')
    const englishAriaLabel = await selector.getAttribute('aria-label')
    expect(englishAriaLabel).toBeTruthy()

    for (const code of ['es', 'fr', 'it', 'nl']) {
      await selector.selectOption(code)
      await expect(language).toHaveAttribute('data-value', code)
      await expect(page.locator('html')).toHaveAttribute('lang', code)
      await expect.poll(() => selector.getAttribute('aria-label')).not.toBe(englishAriaLabel)
    }

    await page.reload()
    await expect(page.locator('[data-setting="language"]')).toHaveAttribute('data-value', 'nl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl')
  })

  test('renders and keeps the Simplified Chinese catalog', async ({ page }) => {
    await page.goto('/settings')

    const language = page.locator('[data-setting="language"]')
    await language.getByRole('combobox').selectOption('zh')
    await expect(language).toHaveAttribute('data-value', 'zh')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh')

    await page.goto('/month')
    const desktopSwitcher = page.locator('[data-component="view-switcher"]')
    await expect(desktopSwitcher.getByRole('button', { name: '月', exact: true })).toBeVisible()
    await expect(desktopSwitcher.getByRole('button', { name: '周', exact: true })).toBeVisible()

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
    await expect(
      page.locator('[data-component="view-switcher"]').getByRole('button', { name: '月', exact: true })
    ).toBeVisible()
  })

  test('writes Chinese dates in Chinese word order', async ({ page }) => {
    await page.goto('/settings')
    await page.locator('[data-setting="language"]').getByRole('combobox').selectOption('zh')

    await page.goto('/month')
    const header = page.locator('header[data-view="month"]')
    // 2026年11月: the year leads and is spelled with its unit, the month is
    // numeric — not the English "November 2026" or a bare "十一月".
    await expect(header.locator('h1')).toHaveText(/^\d{1,2}月$/)
    await expect(header).toContainText(/\d{4}年/)

    // The week-number column header is translated rather than a literal "W#".
    const gridHeader = page.locator('[data-component="calendar-grid-header"]').first()
    await expect(gridHeader.getByText('周', { exact: true })).toBeVisible()
    await expect(gridHeader).not.toContainText('W#')
  })

  test('localizes the date ranges on the agenda and week views', async ({ page }) => {
    await seedEventsWithGap(page)
    await page.goto('/settings')
    await page.locator('[data-setting="language"]').getByRole('combobox').selectOption('zh')

    // "11月2日 – 8日": the month is named once at the start, so the range end
    // keeps its own day unit instead of the English "Nov 2 – 8".
    await page.goto('/week')
    const weekHeader = page.locator('header[data-view="week"] h1')
    await expect(weekHeader).toContainText(/月\d{1,2}日/)
    await expect(weekHeader).toContainText(/–\s*\d{1,2}日/)

    // The free-day label is translated rather than the hardcoded "1 day free".
    await page.goto('/agenda')
    const freeRange = page.locator('[data-component="agenda-free-range"]').first()
    await expect(freeRange).toContainText('空闲')
    await expect(freeRange).not.toContainText('day free')
  })
})
