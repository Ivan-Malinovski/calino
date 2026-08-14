import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const ATTENDEE = 'colleague@example.com'

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

interface EventSeed {
  id: string
  title: string
  start: string
  end: string
  attendees?: { email: string }[]
}

async function seedEvents(page: Page, events: EventSeed[]): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, events }: { calendarKey: string; events: EventSeed[] }) => {
      try {
        if (sessionStorage.getItem('__calino_test_attendees')) return
        sessionStorage.setItem('__calino_test_attendees', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = {
          ...(parsed.state ?? {}),
          events: [
            ...(parsed.state?.events ?? []),
            ...events.map((e) => ({ ...e, type: 'event', isAllDay: false, calendarId: 'default' })),
          ],
        }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { calendarKey: 'calino-storage', events }
  )
}

test.describe('attendees and scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('exposes a valid mailto: href for the attendees', async ({ page }) => {
    const day = todayLocal()
    await seedEvents(page, [
      {
        id: 'invite-event',
        title: 'Design Review',
        start: `${day}T10:00:00`,
        end: `${day}T11:00:00`,
        attendees: [{ email: ATTENDEE }],
      },
    ])

    await page.goto('/week')
    await page.locator('[data-component="event-card"]', { hasText: 'Design Review' }).first().click()

    const button = page
      .locator('[data-component="event-preview"] [data-component="email-attendees-btn"]')
      .first()
    await expect(button).toBeVisible()

    // Assert the attribute — never click it. Navigating a mailto: hands
    // control to the OS mail client and hangs CI.
    const uri = await button.getAttribute('data-mailto')
    expect(uri).toBeTruthy()
    expect(uri!).toContain(encodeURIComponent(ATTENDEE))
    expect(decodeURIComponent(uri!)).toContain('Invitation: Design Review')
  })

  test('flags a conflicting attendee in the event modal', async ({ page }) => {
    const day = todayLocal()
    await seedEvents(page, [
      {
        id: 'existing-clash',
        title: 'Standup',
        start: `${day}T10:00:00`,
        end: `${day}T11:00:00`,
        attendees: [{ email: ATTENDEE }],
      },
      {
        id: 'being-scheduled',
        title: 'New Sync',
        start: `${day}T10:30:00`,
        end: `${day}T11:30:00`,
      },
    ])

    await page.goto('/week')
    await page.locator('[data-component="event-card"]', { hasText: 'New Sync' }).first().click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()

    const attendeeInput = page.getByLabel('Add attendee email')
    await expect(attendeeInput).toBeVisible()
    await attendeeInput.fill(ATTENDEE)
    await attendeeInput.press('Enter')

    await expect(page.locator('[data-component="attendee-availability"]').first()).toHaveAttribute(
      'data-availability',
      'busy'
    )
    await expect(page.locator('[data-component="attendee-conflicts"]')).toContainText(
      'scheduling conflict'
    )
  })

  test('reports unknown for an attendee with no local evidence', async ({ page }) => {
    const day = todayLocal()
    await seedEvents(page, [
      {
        id: 'lonely',
        title: 'Solo Block',
        start: `${day}T14:00:00`,
        end: `${day}T15:00:00`,
      },
    ])

    await page.goto('/week')
    await page.locator('[data-component="event-card"]', { hasText: 'Solo Block' }).first().click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()

    const attendeeInput = page.getByLabel('Add attendee email')
    await attendeeInput.fill('stranger@elsewhere.test')
    await attendeeInput.press('Enter')

    await expect(page.locator('[data-component="attendee-availability"]').first()).toHaveAttribute(
      'data-availability',
      'unknown'
    )
    await expect(page.locator('[data-component="attendee-conflicts"]')).toHaveCount(0)
  })
})
