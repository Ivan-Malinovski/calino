import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test('/tasks leaves a compact bottom breathing room on desktop', async ({ page }) => {
  await clearState(page)
  await page.goto('/tasks')
  await page.locator('[data-component="todo-task-list"]').waitFor()
  const geometry = await page.evaluate(() => {
    const list = document.querySelector('[data-component="todo-task-list"]')
    if (!(list instanceof HTMLElement)) return null
    return {
      viewportHeight: window.innerHeight,
      listBottom: list.getBoundingClientRect().bottom,
    }
  })

  if (!geometry) throw new Error('task list did not render')
  expect(geometry.viewportHeight - geometry.listBottom).toBeCloseTo(24, 0)
})
