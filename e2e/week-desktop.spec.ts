import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const HEADER_DAYS = '[class*="header"] [class*="headerDays"] [class*="dayHeader"]'
const BODY_DAYS = '[class*="body"] [data-component="week-grid"] [class*="dayColumn"]'

function localDate(offset = 0): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function seedAllDayEvent(page: Page): Promise<void> {
  await page.addInitScript(({ event }) => {
    const raw = localStorage.getItem('calino-storage')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
    parsed.state = {
      ...(parsed.state ?? {}),
      events: [...(parsed.state?.events ?? []), event],
    }
    localStorage.setItem('calino-storage', JSON.stringify(parsed))
  }, {
    event: {
      id: 'week-header-width',
      title: 'A very long all-day event title that must stay inside its day',
      type: 'event',
      start: `${localDate()}T00:00:00`,
      end: `${localDate()}T23:59:59`,
      isAllDay: true,
      calendarId: 'default',
    },
  })

  await page.addInitScript(({ event }) => {
    const raw = localStorage.getItem('calino-storage')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
    parsed.state = {
      ...(parsed.state ?? {}),
      events: [...(parsed.state?.events ?? []), event],
    }
    localStorage.setItem('calino-storage', JSON.stringify(parsed))
  }, {
    event: {
      id: 'week-header-today-alignment',
      title: 'Tomorrow all-day alignment',
      type: 'event',
      start: `${localDate(1)}T00:00:00`,
      end: `${localDate(1)}T23:59:59`,
      isAllDay: true,
      calendarId: 'default',
    },
  })
}

async function expectDayEdgesAligned(page: Page): Promise<void> {
  const edges = await page.evaluate(({ headerSelector, bodySelector }) => {
    const read = (selector: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right }
      })
    return { header: read(headerSelector), body: read(bodySelector) }
  }, { headerSelector: HEADER_DAYS, bodySelector: BODY_DAYS })

  expect(edges.header).toHaveLength(7)
  expect(edges.body).toHaveLength(7)
  edges.header.forEach((header, index) => {
    expect(header.left).toBeCloseTo(edges.body[index].left, 0)
    expect(header.right).toBeCloseTo(edges.body[index].right, 0)
  })
}

test.describe('Week view — desktop day alignment', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('day headers line up with timeline columns when an all-day title is long', async ({ page }) => {
    await seedAllDayEvent(page)
    await page.goto('/week')
    await expect(page.locator(HEADER_DAYS).first()).toBeVisible()
    await expectDayEdgesAligned(page)
  })

  test('today’s circle does not push its all-day items below neighboring days', async ({ page }) => {
    await seedAllDayEvent(page)
    await page.goto('/week')

    const todayCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'A very long all-day event' })
      .first()
    const tomorrowCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Tomorrow all-day alignment' })
      .first()
    await expect(todayCard).toBeVisible()
    await expect(tomorrowCard).toBeVisible()

    const todayBox = await todayCard.boundingBox()
    const tomorrowBox = await tomorrowCard.boundingBox()
    if (!todayBox || !tomorrowBox) throw new Error('could not measure all-day event cards')
    expect(todayBox.y).toBeCloseTo(tomorrowBox.y, 0)
  })
})
