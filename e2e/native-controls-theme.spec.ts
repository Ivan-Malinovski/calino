import { test, expect } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

test.describe('native controls follow the active theme', () => {
  test('adjustable corner radius does not round month cells', async ({ page }) => {
    await clearState(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Appearance' }).click()
    await page.locator('[data-component="theme-mode-option"][data-value="light"]').click()
    await page
      .locator('[data-component="theme-preview-card"][data-theme-id="Adjustable"]')
      .first()
      .click()
    await page.goto('/month')

    await expect(page.locator('[data-component="calendar-grid"] [data-date]').first()).toHaveCSS(
      'border-radius',
      '0px'
    )
  })

  test('keeps Adjustable themes at the end of each theme row and shows event previews', async ({
    page,
  }) => {
    await clearState(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Appearance' }).click()

    for (const mode of ['light', 'dark']) {
      const grid = page.locator(`[data-component="theme-preview-grid"][data-theme-mode="${mode}"]`)
      await expect(grid.locator('[data-component="theme-preview-card"]').last()).toHaveText(
        /Adjustable/
      )
    }

    await page.locator('[data-component="theme-mode-option"][data-value="light"]').click()
    await page
      .locator('[data-component="theme-preview-grid"][data-theme-mode="light"]')
      .locator('[data-component="theme-preview-card"][data-theme-id="Adjustable"]')
      .click()
    await expect(page.locator('[data-component="adjustable-event-preview"]')).toBeVisible()
    await expect(page.locator('[data-component="adjustable-event-preview"]')).toContainText(
      'Design review'
    )
    await expect(
      page.locator('[data-component="adjustable-theme-controls"] [data-status="ok"]')
    ).toContainText('Contrast looks good')
  })

  test('Adjustable theme edits the active profile and persists after reload', async ({ page }) => {
    await clearState(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Appearance' }).click()
    await page.locator('[data-component="theme-mode-option"][data-value="light"]').click()

    const adjustableCard = page
      .locator('[data-component="theme-preview-card"][data-theme-id="Adjustable"]')
      .first()
    await expect(adjustableCard).toBeVisible()
    await adjustableCard.click()

    const controls = page.locator('[data-component="adjustable-theme-controls"]')
    await expect(controls).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'adjustable')
    await controls.getByRole('slider', { name: 'Corner radius' }).fill('18')
    await controls.getByLabel('Theme font').selectOption('mono')
    await expect(page.locator('html')).toHaveCSS('--adjustable-radius', '18px')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'adjustable')
    await page.getByRole('button', { name: 'Appearance' }).click()
    await expect(controls.getByRole('slider', { name: 'Corner radius' })).toHaveValue('18')
    await expect(controls.getByLabel('Theme font')).toHaveValue('mono')
    await expect(page.locator('html')).toHaveCSS('--adjustable-radius', '18px')
  })

  test('Catppuccin is selectable, persists, and styles dark controls', async ({ page }) => {
    await clearState(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Appearance' }).click()

    await page.locator('[data-component="theme-mode-option"][data-value="dark"]').click()
    const mochaCard = page.locator(
      '[data-component="theme-preview-card"][data-theme-id="Catppuccin"]'
    )
    await expect(mochaCard).toBeVisible()
    await mochaCard.click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'catppuccin-mocha')
    await expect(mochaCard).toHaveAttribute('data-active', 'true')
    await expect(page.locator('html')).toHaveCSS('--color-bg-primary', '#1e1e2e')
    await expect(page.locator('html')).toHaveCSS('--color-text-primary', '#cdd6f4')
    await expect(page.locator('html')).toHaveCSS('--event-rail-mix', '100%')
    await expect(page.locator('html')).toHaveCSS('--event-marker-mix', '100%')
    await page.getByRole('button', { name: 'Use Mauve accent' }).click()
    await expect(page.locator('html')).toHaveCSS('--color-accent', '#cba6f7')
    await page.goto('/month')
    await expect(
      page.locator('[data-component="calendar-grid"] [data-today] button').first()
    ).toHaveCSS('color', 'rgb(30, 30, 46)')

    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()
    await page.getByPlaceholder('What needs doing?').fill('Mocha controls')
    await page.getByPlaceholder('What needs doing?').press('Enter')
    await expect(page.locator('#priority-select')).toBeVisible()

    for (const selector of [
      '#priority-select',
      '[data-component="event-calendar-select"]',
      '#due-date',
    ]) {
      await expect(page.locator(selector)).toHaveCSS('color-scheme', 'dark')
    }

    const calendarOption = page.locator('[data-component="event-calendar-select"] option').first()
    await expect(calendarOption).toHaveCSS('background-color', 'rgb(49, 50, 68)')
    await expect(calendarOption).toHaveCSS('color', 'rgb(205, 214, 244)')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'catppuccin-mocha')
    await expect(page.locator('html')).toHaveCSS('--color-accent', '#cba6f7')
    await expect(page.locator('html')).toHaveCSS('--color-bg-primary', '#1e1e2e')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(30, 30, 46)')
  })

  test('Catppuccin paints the document before React loads', async ({ page }) => {
    await page.addInitScript(
      ({ settingsKey }: { settingsKey: string }) => {
        localStorage.setItem(
          settingsKey,
          JSON.stringify({
            state: { themeMode: 'dark', darkTheme: 'catppuccin-mocha' },
            version: 1,
          })
        )
      },
      { settingsKey: STORAGE_KEYS.settings }
    )
    await page.route('**/src/main.tsx', (route) => route.fulfill({ body: '' }))

    await page.goto('/month')

    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(30, 30, 46)')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(30, 30, 46)')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#89b4fa')
  })

  test('task selects and date inputs use the dark browser color scheme', async ({ page }) => {
    await clearState(page)
    await page.addInitScript(
      ({ settingsKey }: { settingsKey: string }) => {
        const raw = localStorage.getItem(settingsKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
        parsed.state = { ...(parsed.state ?? {}), themeMode: 'dark' }
        localStorage.setItem(settingsKey, JSON.stringify(parsed))
      },
      { settingsKey: STORAGE_KEYS.settings }
    )

    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()
    await page.getByPlaceholder('What needs doing?').fill('Dark controls')
    await page.getByPlaceholder('What needs doing?').press('Enter')

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    for (const selector of [
      '#priority-select',
      '[data-component="event-calendar-select"]',
      '#due-date',
    ]) {
      await expect(page.locator(selector)).toHaveCSS('color-scheme', 'dark')
    }

    const calendarOption = page.locator('[data-component="event-calendar-select"] option').first()
    await expect(calendarOption).toHaveCSS('background-color', 'rgb(42, 40, 38)')
    await expect(calendarOption).toHaveCSS('color', 'rgb(240, 236, 230)')

    await page.evaluate(async () => {
      const { showToast } = await import('/src/lib/toast.ts')
      showToast('Dark theme toast')
    })
    await expect(page.getByText('Dark theme toast')).toBeVisible()
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark')
  })
})
