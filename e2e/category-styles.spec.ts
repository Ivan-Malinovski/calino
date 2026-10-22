import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

async function seedStyledEvents(page: Page) {
  await clearState(page)
  await page.addInitScript(
    ({ key }) => {
      if (sessionStorage.getItem('__calino_category_styles')) return
      sessionStorage.setItem('__calino_category_styles', '1')
      const date = new Date()
      const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Calendar',
                color: '#648574',
                isVisible: true,
                isDefault: true,
              },
            ],
            categories: [{ id: 'important-id', name: 'important', color: '#ac7332' }],
            events: [
              {
                id: 'styled-important',
                title: 'Client presentation',
                categories: ['important-id'],
              },
              { id: 'styled-maybe', title: 'Studio visit', categories: ['Unconfirmed'] },
              { id: 'styled-both', title: 'Review with Alex?', categories: ['important', 'maybe'] },
            ].map((event, i) => ({
              ...event,
              calendarId: 'default',
              start: `${today}T${9 + i}:00:00`.replace('T9:', 'T09:'),
              end: `${today}T${10 + i}:00:00`,
              isAllDay: false,
              type: 'event',
            })),
          },
        })
      )
    },
    { key: STORAGE_KEYS.calendar }
  )
}

const eventRow = (page: Page, title: string) =>
  page.locator('[data-component="agenda-event"]').filter({ hasText: title })
const stylePanel = (page: Page) => page.locator('[data-component="category-style-settings"]')

test.beforeEach(async ({ page }) => {
  await seedStyledEvents(page)
})

test('defaults combine sketch and texture across agenda, month and week without crossing time', async ({
  page,
}) => {
  await page.goto('/agenda')
  const important = eventRow(page, 'Client presentation')
  const tentative = eventRow(page, 'Studio visit')
  const both = eventRow(page, 'Review with Alex?')
  await expect(important.locator('[data-component="category-sketch"]')).toBeVisible()
  await expect(tentative).toHaveCSS('background-image', /repeating-linear-gradient/)
  await expect(both).toHaveCSS('background-image', /repeating-linear-gradient/)
  await expect(both.locator('[data-component="category-sketch"]')).toBeVisible()
  await expect(both.locator('[data-component="category-styled-title"]')).not.toHaveAttribute(
    'data-font',
    'hand'
  )
  const loop = await both.locator('[data-component="category-sketch"]').boundingBox()
  const row = await both.boundingBox()
  const time = await both.getByText('11:00', { exact: true }).boundingBox()
  expect(loop!.width).toBeLessThan(row!.width * 0.7)
  expect(loop!.x).toBeGreaterThanOrEqual(time!.x + time!.width)

  for (const view of ['month', 'week', 'day']) {
    await page.goto(`/${view}`)
    const card = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Review with Alex?' })
      .first()
    await expect(card).toHaveCSS('background-image', /repeating-linear-gradient/)
    await expect(card.locator('[data-component="category-sketch"]')).toBeVisible()
    // The lettering still truncates, but no ancestor inside the card masks the pen stroke.
    const pen = card.locator('[data-component="category-sketch"]')
    await expect(pen).toHaveCSS('overflow', 'visible')
    const lettering = await card
      .locator('[data-component="category-styled-title"] > span')
      .first()
      .boundingBox()
    const stroke = await pen.boundingBox()
    expect(stroke!.width).toBeGreaterThanOrEqual(lettering!.width + 23)
    expect(stroke!.height).toBeGreaterThanOrEqual(lettering!.height + 7)

    const clippingAncestors = await pen.evaluate((svg) => {
      const clipped: string[] = []
      let parent = svg.parentElement
      while (parent) {
        const style = getComputedStyle(parent)
        if (style.overflowY !== 'visible') clipped.push(parent.tagName)
        if (parent.dataset.component === 'event-card') break
        parent = parent.parentElement
      }
      return clipped
    })
    expect(clippingAncestors).toEqual([])
  }
})

test('Theme editor configures matching, lettering, accent, enabled state and persists after reload', async ({
  page,
}) => {
  await page.goto('/settings?tab=theme')
  const panel = stylePanel(page)
  await expect(panel.getByRole('heading', { name: 'Style by category' })).toBeVisible()
  await panel.getByRole('button', { name: /not confirmed, unconfirmed/ }).click()
  await panel.getByLabel('Style', { exact: true }).selectOption('tentative')
  await panel.getByLabel('Lettering').selectOption('hand')
  await panel.getByLabel('Accent', { exact: true }).fill('#606875')
  await panel.getByLabel('Match any category').fill('maybe, unconfirmed')
  await expect(
    panel.locator('[data-component="category-style-preview"] [data-font="hand"]')
  ).toBeVisible()
  await page.reload()
  await panel.getByRole('button', { name: /maybe, unconfirmed/ }).click()
  await expect(panel.getByLabel('Style', { exact: true })).toHaveValue('tentative')
  await expect(panel.getByLabel('Lettering')).toHaveValue('hand')
  await expect(panel.getByLabel('Accent', { exact: true })).toHaveValue('#606875')
  await page.goto('/agenda')
  const both = eventRow(page, 'Review with Alex?')
  await expect(both.locator('[data-font="hand"]')).toBeVisible()
  await expect(both.locator('[data-component="category-sketch"]')).toBeVisible()
  await expect(both).toHaveCSS('background-image', 'none')
  await page.goto('/settings?tab=theme')
  await panel.getByRole('button', { name: /maybe, unconfirmed/ }).click()
  await panel.getByLabel('Enabled', { exact: true }).uncheck()
  await page.goto('/agenda')
  await expect(both.locator('[data-font="hand"]')).toHaveCount(0)
  await expect(both.locator('[data-component="category-sketch"]')).toBeVisible()
})

test('users can add, reorder, remove all rules, keep them removed and restore defaults', async ({
  page,
}) => {
  await page.goto('/settings?tab=theme')
  const panel = stylePanel(page)
  await panel.getByRole('button', { name: '+ Quiet – dashed border', exact: true }).click()
  await panel.getByLabel('Match any category').fill('maybe')
  await expect(panel.locator('[data-component="category-style-preview"]')).toHaveCSS(
    'border-top-style',
    'dashed'
  )
  await panel.getByRole('button', { name: '↑ Earlier', exact: true }).click()
  await panel.getByRole('button', { name: '↑ Earlier', exact: true }).click()
  await expect(panel.getByRole('button', { name: '↑ Earlier', exact: true })).toBeDisabled()
  for (let i = 0; i < 3; i++)
    await panel.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(panel.getByText('No rules. Add a rule or restore the defaults.')).toBeVisible()
  await page.reload()
  await expect(panel.getByText('No rules. Add a rule or restore the defaults.')).toBeVisible()
  await page.goto('/agenda')
  await expect(page.locator('[data-component="category-sketch"]')).toHaveCount(0)
  await expect(eventRow(page, 'Review with Alex?')).toHaveCSS('background-image', 'none')
  await page.goto('/settings?tab=theme')
  await panel.getByRole('button', { name: 'Restore defaults', exact: true }).click()
  await page.goto('/agenda')
  await expect(
    eventRow(page, 'Review with Alex?').locator('[data-component="category-sketch"]')
  ).toBeVisible()
  await expect(eventRow(page, 'Review with Alex?')).toHaveCSS(
    'background-image',
    /repeating-linear-gradient/
  )
})

test('Theme rules fit mobile and follow dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings?tab=theme')
  const panel = stylePanel(page)
  await page.locator('[data-component="theme-mode-option"][data-value="dark"]').click()
  await panel.getByLabel('Style', { exact: true }).selectOption('important')
  await expect(panel.getByLabel('Match any category')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.goto('/agenda')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(
    eventRow(page, 'Review with Alex?').locator('[data-component="category-sketch"]')
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('all style options preview their treatment and handwriting stays optional', async ({
  page,
}) => {
  await page.goto('/settings?tab=theme')
  const panel = stylePanel(page)
  const preview = panel.locator('[data-component="category-style-preview"]')
  const style = panel.getByLabel('Style', { exact: true })
  await style.selectOption('focus')
  await expect(preview).toHaveCSS('border-top-style', 'dashed')
  await style.selectOption('travel')
  await expect(preview).toHaveCSS('background-image', /repeating-linear-gradient/)
  await style.selectOption('deadline')
  await expect(preview.locator('[data-marker] > span')).toHaveCSS(
    'text-decoration-line',
    'underline'
  )
  await style.selectOption('done')
  await expect(preview.locator('[data-finished] > span')).toHaveCSS(
    'text-decoration-line',
    'line-through'
  )
  await style.selectOption('tentative')
  await panel.getByLabel('Lettering').selectOption('hand')
  await expect(preview.locator('[data-font="hand"]')).toHaveCSS('font-family', /Calino Handwriting/)
  await style.selectOption('important')
  await expect(preview.locator('[data-component="category-sketch"]')).toBeVisible()
  await panel.getByLabel('Lettering').selectOption('standard')
  await expect(preview.locator('[data-font="hand"]')).toHaveCount(0)
  await expect(preview.locator('[data-component="category-sketch"]')).toBeVisible()
})
