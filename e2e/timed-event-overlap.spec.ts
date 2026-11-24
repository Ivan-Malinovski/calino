import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

async function seedEvents(page: Page, oscillation = false, timeFormat = '12h') {
  await clearState(page)
  await page.addInitScript(
    ({ key, settingsKey, oscillation, timeFormat }) => {
      if (sessionStorage.getItem('__calino_timed_overlap')) return
      sessionStorage.setItem('__calino_timed_overlap', '1')
      const d = new Date()
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const items = oscillation
        ? [
            {
              id: 'planning',
              title: 'Planning meeting',
              from: '16:20',
              to: '17:20',
              location: 'Meeting room',
            },
            { id: 'concurrent-1', title: 'Concurrent 1', from: '17:00', to: '19:00' },
            { id: 'concurrent-2', title: 'Concurrent 2', from: '17:00', to: '19:00' },
          ]
        : [
            {
              id: 'workshop',
              title: 'Planning workshop',
              from: '16:00',
              to: '17:30',
              categories: ['important', 'maybe'],
              location: 'Meeting room',
            },
            { id: 'call', title: 'Client call', from: '17:00', to: '18:00' },
            { id: 'simultaneous-a', title: 'Concurrent first', from: '10:00', to: '12:00' },
            { id: 'simultaneous-b', title: 'Concurrent second', from: '10:00', to: '11:00' },
            { id: 'close-a', title: 'Close start first', from: '13:00', to: '15:00' },
            { id: 'close-b', title: 'Close start second', from: '13:15', to: '14:00' },
          ]
      if (oscillation) {
        const settings = JSON.parse(localStorage.getItem(settingsKey)!)
        settings.state.timeFormat = timeFormat
        localStorage.setItem(settingsKey, JSON.stringify(settings))
      }
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Calendar',
                color: '#607fa3',
                isVisible: true,
                isDefault: true,
              },
            ],
            events: items.map(({ from, to, ...event }) => ({
              ...event,
              type: 'event',
              calendarId: 'default',
              start: `${day}T${from}:00`,
              end: `${day}T${to}:00`,
              isAllDay: false,
            })),
          },
        })
      )
    },
    { key: STORAGE_KEYS.calendar, settingsKey: STORAGE_KEYS.settings, oscillation, timeFormat }
  )
}

const card = (page: Page, title: string) =>
  page.locator('[data-component="event-card"]').filter({ hasText: title }).first()

for (const view of ['week', 'day']) {
  test(`${view}: staggered events overlap empty bodies while information remains visible`, async ({
    page,
  }) => {
    await seedEvents(page)
    await page.goto(`/${view}`)
    const first = card(page, 'Planning workshop')
    const second = card(page, 'Client call')
    await first.scrollIntoViewIfNeeded()
    await expect
      .poll(async () => {
        const a = await first.boundingBox(),
          b = await second.boundingBox()
        return a && b ? a.x + a.width - b.x : 0
      })
      .toBeGreaterThan(30)
    const a = (await first.boundingBox())!,
      b = (await second.boundingBox())!
    expect(b.width).toBeGreaterThan(a.width * 0.7)
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBeLessThan(a.y + a.height)
    // The second card must start below the entire earlier header, not just its title.
    const info = await first.locator('[data-component="event-card-content"]').boundingBox()
    expect(b.y).toBeGreaterThan(info!.y + info!.height)
    for (const target of [
      first.locator('[data-component="category-styled-title"]'),
      first.getByText('Meeting room'),
      second.getByText('Client call', { exact: true }),
    ]) {
      await expect(target).toBeVisible()
      expect(
        await target.evaluate((element) => {
          const r = element.getBoundingClientRect()
          const hit = document.elementFromPoint(r.x + Math.min(r.width / 2, 15), r.y + r.height / 2)
          return hit !== null && element.contains(hit)
        })
      ).toBe(true)
    }
    // Card interactions still target the correct event in either header.
    await second.getByText('Client call', { exact: true }).click()
    await expect(page.locator('[data-component="event-preview"]')).toBeVisible()
  })

  test(`${view}: simultaneous and closely spaced information stays side by side`, async ({
    page,
  }) => {
    await seedEvents(page)
    await page.goto(`/${view}`)
    for (const [leftTitle, rightTitle] of [
      ['Concurrent first', 'Concurrent second'],
      ['Close start first', 'Close start second'],
    ]) {
      const left = card(page, leftTitle),
        right = card(page, rightTitle)
      await left.scrollIntoViewIfNeeded()
      await expect(left).toBeVisible()
      const a = (await left.boundingBox())!,
        b = (await right.boundingBox())!
      expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1)
    }
  })
}

test('week: overlap adjusts when larger lettering needs more vertical space', async ({ page }) => {
  await seedEvents(page)
  await page.goto('/week')
  const first = card(page, 'Planning workshop'),
    second = card(page, 'Client call')
  await first.scrollIntoViewIfNeeded()
  await expect
    .poll(async () => {
      const a = await first.boundingBox(),
        b = await second.boundingBox()
      return a!.x + a!.width - b!.x
    })
    .toBeGreaterThan(30)
  // Simulate enlarged text from a theme or accessibility setting without remounting cards.
  await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '2'))
  await expect
    .poll(async () => {
      const a = await first.boundingBox(),
        b = await second.boundingBox()
      return a!.x + a!.width - b!.x
    })
    .toBeLessThanOrEqual(1)
  await page.evaluate(() => document.documentElement.style.removeProperty('--font-scale'))
  await expect
    .poll(async () => {
      const a = await first.boundingBox(),
        b = await second.boundingBox()
      return a!.x + a!.width - b!.x
    })
    .toBeGreaterThan(30)
})

for (const timeFormat of ['12h', '24h']) {
  test(`week: overlapping cards settle across responsive time widths (${timeFormat})`, async ({
    page,
  }) => {
    await seedEvents(page, true, timeFormat)
    await page.setViewportSize({ width: 1320, height: 1000 })
    await page.goto('/week')
    const planning = card(page, 'Planning meeting')
    // Do not wait for stable geometry before observing a potentially oscillating card.
    await planning.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await expect(card(page, 'Concurrent 1')).toBeVisible()
    await expect(card(page, 'Concurrent 2')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    for (const width of [1180, 1240, 1320, 1400]) {
      await page.setViewportSize({ width, height: 1000 })
      // Allow resize/entry animations to finish before measuring an idle grid.
      await page.waitForTimeout(350)
      const changes = await page.evaluate(async () => {
        const cards = [
          ...document.querySelectorAll<HTMLElement>('[data-component="event-card"]'),
        ].filter((element) => /Planning meeting|Concurrent [12]/.test(element.textContent ?? ''))
        const positions = () =>
          cards.map((element) => {
            const rect = element.getBoundingClientRect()
            return [rect.x, rect.width].map((value) => Math.round(value * 100) / 100)
          })
        let previous = JSON.stringify(positions())
        let changes = 0
        const start = performance.now()
        await new Promise<void>((resolve) => {
          const sample = () => {
            const current = JSON.stringify(positions())
            if (current !== previous) changes++
            previous = current
            if (performance.now() - start >= 1000) resolve()
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        return changes
      })
      expect(changes, `${timeFormat} at ${width}px must stop resizing`).toBe(0)
      await expect(planning.getByText('Meeting room')).toBeVisible()
    }
  })
}
