/**
 * Task cards carry a light wash of their calendar colour, like events do but
 * weaker, instead of rendering as plain grey. The wash is measured as the
 * distance of the painted background from the canvas colour: a task must be
 * tinted (not canvas) and less tinted than an event of the same colour.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// Fixed "now": midday on a Wednesday.
const NOW = new Date('2026-09-23T12:00:00')
const DAY = '2026-09-23'
const COLOR = '#0F9D58'

async function seed(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, day, color }) => {
      try {
        if (sessionStorage.getItem('__calino_test_task_tint')) return
        sessionStorage.setItem('__calino_test_task_tint', '1')
        const raw = localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        const base = { calendarId: 'default', isAllDay: false, completed: false }
        parsed.state = {
          ...(parsed.state ?? {}),
          events: [
            {
              ...base,
              id: 'tint-event',
              uid: 'tint-event',
              title: 'Tinted event',
              type: 'event',
              start: `${day}T09:00:00`,
              end: `${day}T10:00:00`,
            },
            {
              ...base,
              id: 'tint-task',
              uid: 'tint-task',
              title: 'Tinted task',
              type: 'task',
              start: `${day}T14:00:00`,
              end: `${day}T14:00:00`,
              dueDate: `${day}T14:00:00`,
              taskStatus: 'NEEDS-ACTION',
            },
          ],
          calendars: [
            {
              id: 'default',
              name: 'Personal',
              color,
              isVisible: true,
              isDefault: true,
              showTasksInViews: true,
            },
          ],
        }
        localStorage.setItem(key, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { key: STORAGE_KEYS.calendar, day: DAY, color: COLOR }
  )
}

/** Painted background of the card titled `title`, and of the bare canvas, as sRGB 0–255. */
async function backgrounds(
  page: Page,
  title: string
): Promise<{ card: number[]; canvas: number[] }> {
  const card = page.locator('[data-component="event-card"]').filter({ hasText: title }).first()
  return card.evaluate((el) => {
    const rgb = (value: string): number[] => {
      const numbers = (value.match(/-?[\d.]+/g) ?? []).map(Number)
      // color-mix() resolves to `color(srgb r g b)` with 0–1 channels.
      const channels = numbers.slice(0, 3)
      return value.startsWith('color(') ? channels.map((n) => n * 255) : channels
    }
    const probe = document.createElement('div')
    probe.style.background = 'var(--canvas)'
    document.body.appendChild(probe)
    const canvas = rgb(getComputedStyle(probe).backgroundColor)
    probe.remove()
    return { card: rgb(getComputedStyle(el).backgroundColor), canvas }
  })
}

const distance = (a: number[], b: number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test.describe('Task cards carry a light tint of their calendar colour', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.clock.install({ time: NOW })
    await seed(page)
  })

  test('a task is tinted, but less than an event of the same colour', async ({ page }) => {
    await page.goto('/week')
    const cards = page.locator('[data-component="event-card"]')
    await expect(cards.filter({ hasText: 'Tinted event' }).first()).toBeVisible()
    await expect(cards.filter({ hasText: 'Tinted task' }).first()).toBeVisible()

    const event = await backgrounds(page, 'Tinted event')
    const task = await backgrounds(page, 'Tinted task')
    const eventTint = distance(event.card, event.canvas)
    const taskTint = distance(task.card, task.canvas)

    expect(taskTint).toBeGreaterThan(1)
    expect(taskTint).toBeLessThan(eventTint)
  })
})
