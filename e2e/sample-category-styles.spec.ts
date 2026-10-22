import { test, expect } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

test('loading the sample calendar demonstrates category styles and their combination', async ({
  page,
}) => {
  await clearState(page)
  await page.addInitScript(
    ({ key }) => {
      if (sessionStorage.getItem('__calino_sample_styles_onboarding')) return
      sessionStorage.setItem('__calino_sample_styles_onboarding', '1')
      const settings = JSON.parse(localStorage.getItem(key)!)
      settings.state.hasCompletedOnboarding = false
      localStorage.setItem(key, JSON.stringify(settings))
    },
    { key: STORAGE_KEYS.settings }
  )

  await page.goto('/month')
  const onboarding = page.getByRole('dialog')
  await onboarding.locator('[data-component="demo-button"]').click()
  await expect(onboarding).toBeHidden()
  const card = (title: string) =>
    page.locator('[data-component="event-card"]').filter({ hasText: title }).first()
  await expect(card('Project Review').locator('[data-component="category-sketch"]')).toBeVisible()
  for (const title of [
    'Work Retreat',
    'Lunch with Mom',
    'Brunch with Friends',
    'Family Vacation',
  ]) {
    await expect(card(title)).toHaveCSS('background-image', /repeating-linear-gradient/)
  }
  const combined = card('Product Planning Workshop')
  await expect(combined).toHaveCSS('background-image', /repeating-linear-gradient/)
  await expect(combined.locator('[data-component="category-sketch"]')).toBeVisible()

  // Optional presets also have matching examples in the real sample calendar.
  await page.goto('/settings?tab=theme')
  const rules = page.locator('[data-component="category-style-settings"]')
  await rules.getByRole('button', { name: '+ Quiet – dashed border', exact: true }).click()
  await rules.getByRole('button', { name: '+ Marker – underline', exact: true }).click()
  await page.goto('/month')
  await expect(card('Code Review Session')).toHaveCSS('border-top-style', 'dashed')
  await expect(card('Monthly Report Deadline').locator('[data-marker]')).toBeVisible()
})
