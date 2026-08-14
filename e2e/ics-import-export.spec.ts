import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const EVENT_ID = 'ics-export-event'
const EVENT_TITLE = 'ICS Export Event'
const EVENT_UID = 'ics-export-event@calino.test'

const START_HOUR = Math.min(new Date().getHours(), 20)

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function seedEvent(page: Page): Promise<void> {
  const day = todayLocal()
  const hh = String(START_HOUR).padStart(2, '0')
  const endHh = String(START_HOUR + 1).padStart(2, '0')
  await page.addInitScript(
    ({ calendarKey, event }) => {
      try {
        if (sessionStorage.getItem('__calino_test_ics_export')) return
        sessionStorage.setItem('__calino_test_ics_export', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        const events = parsed.state?.events ?? []
        events.push(event)
        parsed.state = { ...(parsed.state ?? {}), events }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      calendarKey: 'calino-storage',
      event: {
        id: EVENT_ID,
        uid: EVENT_UID,
        title: EVENT_TITLE,
        type: 'event',
        start: `${day}T${hh}:00:00`,
        end: `${day}T${endHh}:00:00`,
        isAllDay: false,
        calendarId: 'default',
      },
    }
  )
}

const card = (page: Page) =>
  page.locator('[data-component="event-card"]', { hasText: EVENT_TITLE }).first()

test.describe('ICS export', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedEvent(page)
  })

  test('downloads a single event as .ics from the event modal menu', async ({ page }) => {
    await page.goto('/week')
    await card(page).click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()

    const footer = page.locator('[data-component="modal-footer"]')
    await expect(footer).toBeVisible()
    await footer.locator('[data-component="event-actions-menu-btn"]').click()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      footer.locator('[data-component="export-event-ics"]').click(),
    ])

    expect(download.suggestedFilename()).toBe(`${EVENT_TITLE}.ics`)

    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const ics = Buffer.concat(chunks).toString('utf8')

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain(`UID:${EVENT_UID}`)
    expect(ics).toContain(`SUMMARY:${EVENT_TITLE}`)
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
  })

  test('downloads a whole calendar from the sidebar context menu', async ({ page }) => {
    await page.goto('/week')

    // The Calendars section starts collapsed on a fresh profile.
    const section = page.getByRole('button', { name: /^Calendars/ }).first()
    if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()

    // The row is a <label> wrapping the visibility checkbox — it carries no
    // data-component of its own.
    const calendarRow = page
      .locator('label:has([data-component="calendar-visibility-toggle"])')
      .first()
    await calendarRow.click({ button: 'right' })

    const exportItem = page.locator('[data-component="export-calendar-ics"]')
    await expect(exportItem).toBeVisible()

    const [download] = await Promise.all([page.waitForEvent('download'), exportItem.click()])

    expect(download.suggestedFilename()).toMatch(/\.ics$/)

    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const ics = Buffer.concat(chunks).toString('utf8')

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain(`SUMMARY:${EVENT_TITLE}`)
  })
})

const IMPORT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calino Test//EN
BEGIN:VEVENT
UID:dropped-event@calino.test
DTSTART:${todayLocal().replace(/-/g, '')}T${String(START_HOUR).padStart(2, '0')}3000
DTEND:${todayLocal().replace(/-/g, '')}T${String(START_HOUR).padStart(2, '0')}4500
SUMMARY:Dropped Event
END:VEVENT
END:VCALENDAR`

/**
 * Playwright can't drop an OS file onto the page, so the File and DataTransfer
 * are built inside the page and handed to a synthetic `drop`.
 */
async function dropIcsFile(page: Page, contents: string, fileName: string): Promise<void> {
  await page.evaluate(
    ({ contents, fileName }) => {
      const file = new File([contents], fileName, { type: 'text/calendar' })
      const dt = new DataTransfer()
      dt.items.add(file)
      window.dispatchEvent(
        Object.assign(new Event('dragenter', { bubbles: true, cancelable: true }), {
          dataTransfer: dt,
        })
      )
      window.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: dt })
      )
    },
    { contents, fileName }
  )
}

test.describe('ICS drag-and-drop import', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('drops a file, reviews it, and imports into the chosen calendar', async ({ page }) => {
    await page.goto('/week')
    await dropIcsFile(page, IMPORT_ICS, 'dropped.ics')

    const modal = page.locator('[data-component="ics-import-modal"]')
    await expect(modal).toBeVisible()
    await expect(modal.getByText('Dropped Event')).toBeVisible()

    await modal.locator('[data-testid="ics-import-confirm"]').click()

    await expect(
      page.locator('[data-component="event-card"]', { hasText: 'Dropped Event' }).first()
    ).toBeVisible()
  })

  test('ignores a dropped non-calendar file', async ({ page }) => {
    await page.goto('/week')
    await page.evaluate(() => {
      const file = new File(['just text'], 'notes.txt', { type: 'text/plain' })
      const dt = new DataTransfer()
      dt.items.add(file)
      window.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: dt })
      )
    })

    await expect(page.locator('[data-component="ics-import-modal"]')).toHaveCount(0)
  })
})

test.describe('ICS drop zone does not break internal drags', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedEvent(page)
  })

  test('dragging an event inside the grid still moves it', async ({ page }) => {
    await page.goto('/week')

    const target = card(page)
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    expect(box).not.toBeNull()

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 60, { steps: 10 })

    // The file overlay must never appear for an in-app drag.
    await expect(page.locator('[data-component="ics-drop-overlay"]')).toHaveCount(0)

    await page.mouse.up()
    await expect(page.locator('[data-component="ics-import-modal"]')).toHaveCount(0)
  })
})
