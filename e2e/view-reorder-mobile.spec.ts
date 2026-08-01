import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const GRID = '[data-component="nav-expanded-grid"]'

// The nav pill is the mobile switcher, so these run on a touch-capable
// phone-sized context rather than the suite's default desktop one.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

async function openGrid(page: Page): Promise<void> {
  await page.goto('/agenda')
  await page.getByRole('button', { name: 'Show all views' }).click()
  await expect(page.locator(GRID)).toBeVisible()
  await waitForStableGrid(page)
}

/** Journal and Contacts are off by default; the device this was reported
 *  from has all eight views, which is two full rows. */
async function seedAllViewsEnabled(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'calino-settings'
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
    parsed.state = { ...(parsed.state ?? {}), journalEnabled: true, contactsEnabled: true }
    parsed.version = 2
    window.localStorage.setItem(key, JSON.stringify(parsed))
  })
}

async function tileLabels(page: Page): Promise<string[]> {
  return page.locator(`${GRID} button[data-tile-index]`).allInnerTexts()
}

/**
 * Centre of a tile, once it is genuinely the topmost element there.
 *
 * The pill animates its height open, and a full-screen tap-catcher sits
 * just beneath it — so for the first few frames a tile's box is reported at
 * coordinates the catcher still owns. Poll until the tile actually wins the
 * hit test, otherwise the synthesised pointerdown lands on the catcher.
 */
/** Resolve once the grid's box stops changing between frames — the pill
 *  animates open, and coordinates read mid-animation go stale. */
async function waitForStableGrid(page: Page): Promise<void> {
  await page.waitForFunction(
    (selector: string) => {
      const el = document.querySelector(selector)
      if (!el) return false
      const w = window as unknown as { __lastBox?: string; __stableCount?: number }
      const box = JSON.stringify(el.getBoundingClientRect())
      w.__stableCount = box === w.__lastBox ? (w.__stableCount ?? 0) + 1 : 0
      w.__lastBox = box
      return (w.__stableCount ?? 0) >= 3
    },
    GRID,
    { timeout: 5000, polling: 'raf' }
  )
}

async function hittableTileCentre(page: Page, index: number): Promise<{ x: number; y: number }> {
  let point = { x: 0, y: 0 }
  await expect
    .poll(
      async () => {
        const box = await page.locator(`${GRID} button[data-tile-index="${index}"]`).boundingBox()
        if (!box) return null
        point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        return page.evaluate(
          ({ x, y }: { x: number; y: number }) =>
            document.elementFromPoint(x, y)?.closest('[data-tile-index]')?.getAttribute('data-tile-index') ??
            null,
          point
        )
      },
      { timeout: 5000 }
    )
    .toBe(String(index))
  return point
}

test.describe('View switcher — mobile grid reordering', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('long-pressing a tile enters reorder mode', async ({ page }) => {
    await openGrid(page)

    const centre = await hittableTileCentre(page, 0)
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    // Longer than LONG_PRESS_MS (350ms).
    await page.waitForTimeout(600)

    await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()

    await page.mouse.up()
  })

  test('long-press then drag moves a tile', async ({ page }) => {
    await openGrid(page)

    const before = await tileLabels(page)
    expect(before.length).toBeGreaterThan(2)

    const from = await hittableTileCentre(page, 0)
    const to = await hittableTileCentre(page, 1)

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()
    // Move in steps — a single jump can be coalesced into one event.
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()

    const expected = [...before]
    expected.splice(1, 0, expected.splice(0, 1)[0])
    await expect.poll(() => tileLabels(page)).toEqual(expected)
  })

  test('a tile dropped on the second row lands in the cell under the finger', async ({ page }) => {
    // Entering reorder mode inserts a bar above the grid, shifting every
    // tile down. Cell geometry captured before that render is stale by the
    // bar's height, which lands vertical drops a row off — so a drag from
    // row 1 into row 2 is the case that catches it.
    await openGrid(page)

    const before = await tileLabels(page)
    expect(before.length).toBeGreaterThan(4)

    const from = await hittableTileCentre(page, 0)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    // Wait for reorder mode itself rather than assuming a duration: under
    // load a fixed sleep can expire before the long-press has armed, and the
    // gesture then degrades into a plain tap that navigates away.
    await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()

    // Re-measure the destination *after* reorder mode has shifted the grid
    // and that shift has settled, so the drop lands on the cell rather than
    // on the tap-catcher behind a still-moving pill.
    await waitForStableGrid(page)
    const to = await hittableTileCentre(page, 4)
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()

    // The sheet must survive the drop: framer's dismiss gesture starts before
    // reorder mode arms, and a downward drag used to close the pill on release.
    await expect(page.locator(GRID)).toBeVisible()

    const expected = [...before]
    expected.splice(4, 0, expected.splice(0, 1)[0])
    await expect.poll(() => tileLabels(page)).toEqual(expected)
  })

  test('every tile picks itself up, not a neighbour', async ({ page }) => {
    // Reported from a device: long-pressing a tile lifted the one to its
    // left, for every tile except the last. That is a slot-geometry offset,
    // so it has to be checked per index rather than on one sample.
    await seedAllViewsEnabled(page)
    await openGrid(page)

    const count = (await tileLabels(page)).length
    expect(count).toBe(8)

    for (let index = 0; index < count; index++) {
      const centre = await hittableTileCentre(page, index)
      await page.mouse.move(centre.x, centre.y)
      await page.mouse.down()
      await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()

      // Nudge, so the held tile is established via a real move.
      await page.mouse.move(centre.x + 2, centre.y, { steps: 2 })

      const held = await page
        .locator(`${GRID} button[data-held="true"]`)
        .getAttribute('data-tile-index')
      expect(held, `long-pressing tile ${index} should lift tile ${index}`).toBe(String(index))

      await page.mouse.up()
    }
  })

  test('a small nudge after picking a tile up does not reorder anything', async ({ page }) => {
    // The sharpest test of slot geometry. Entering reorder mode springs the
    // pill to a new height, so cell positions captured at rest go stale
    // while it animates; a couple of pixels of movement then hit-tests
    // against the wrong cell and swaps tiles immediately — which reads as
    // "the wrong tile got picked up".
    await seedAllViewsEnabled(page)
    await openGrid(page)

    const before = await tileLabels(page)

    // Bottom-left: the reported worst case, furthest from the grid's origin
    // in the direction the sheet grows.
    const centre = await hittableTileCentre(page, 4)
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()

    // Move immediately, while the sheet is still springing — no settle wait.
    await page.mouse.move(centre.x + 3, centre.y + 1, { steps: 3 })
    await page.mouse.move(centre.x + 2, centre.y, { steps: 2 })

    expect(await tileLabels(page)).toEqual(before)

    await page.mouse.up()
    await expect(page.locator(GRID)).toBeVisible()
    expect(await tileLabels(page)).toEqual(before)
  })

  test('dragging across several cells lands the dragged tile at the end', async ({ page }) => {
    // A drag commits a reorder per cell crossed. Each of those has to build
    // on the previous one; when they were all computed from drag-start state
    // instead, only the final step survived and the dragged tile never
    // moved. Single-cell drags cannot catch that — this needs three hops.
    await seedAllViewsEnabled(page)
    await openGrid(page)

    const before = await tileLabels(page)
    expect(before.length).toBe(8)
    const dragged = before[4]

    const from = await hittableTileCentre(page, 4)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()

    // Step across the whole bottom row, cell by cell.
    for (const index of [5, 6, 7]) {
      const cell = await hittableTileCentre(page, index)
      await page.mouse.move(cell.x, cell.y, { steps: 6 })
    }
    await page.mouse.up()
    await expect(page.locator(GRID)).toBeVisible()

    const expected = [...before]
    expected.splice(7, 0, expected.splice(4, 1)[0])
    await expect.poll(() => tileLabels(page)).toEqual(expected)
    // The tile that was dragged is the one that ended up last.
    expect((await tileLabels(page))[7]).toBe(dragged)
  })

  test('the lifted tile stays with the finger across swaps', async ({ page }) => {
    // Everything here is mid-drag state: the dragged view changes slot on
    // every swap, and the "lifted" marker has to follow it. If it stays
    // pinned to the slot the drag began in, the offset lands on whichever
    // tile moved into that slot and the held one appears to snap home.
    await seedAllViewsEnabled(page)
    await openGrid(page)

    const before = await tileLabels(page)
    const dragged = before[4]

    const from = await hittableTileCentre(page, 4)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()

    for (const index of [5, 6, 7]) {
      const cell = await hittableTileCentre(page, index)
      await page.mouse.move(cell.x, cell.y, { steps: 6 })

      // Exactly one tile is lifted, and it is the one being dragged.
      const held = page.locator(`${GRID} button[data-held="true"]`)
      await expect(held).toHaveCount(1)
      await expect(held).toHaveText(dragged)
      // ...and it is the tile now sitting under the finger.
      expect(await held.getAttribute('data-tile-index')).toBe(String(index))
    }

    await page.mouse.up()
  })

  test('long-pressing a tile does not select its label text', async ({ page }) => {
    await openGrid(page)

    const centre = await hittableTileCentre(page, 0)
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await expect(page.locator(`${GRID}[data-reorder-mode="true"]`)).toBeVisible()
    await page.mouse.move(centre.x + 30, centre.y, { steps: 6 })

    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selected).toBe('')

    await page.mouse.up()
  })
})
