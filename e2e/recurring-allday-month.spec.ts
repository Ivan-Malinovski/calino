/**
 * E2E spec for the recurring all-day click regression in /month.
 *
 * Background: when the user clicks a recurring all-day event in the month
 * view, the click silently does nothing. The card *looks* clickable (cursor:
 * pointer, `data-no-drag`), the EventCard click handler fires, but no preview
 * popup ever appears.
 *
 * Root cause: the recurrence expansion in `calendarStore.ts` builds the
 * generated instance id as `${masterId}-${date}` for all-day events, while
 * timed events get `${masterId}-${full ISO timestamp}`. The
 * `extractOriginalEventId` helper in `src/lib/events.ts` only matched the
 * timestamp form, so `findEventById` returned `undefined` for all-day
 * instances and `PreviewPopupWrapper` bailed out silently. The fix in
 * `extractOriginalEventId` adds a date-only fallback (anchored at `$`, so it
 * can't misinterpret a master id that happens to end in a date because
 * `findEventById` only returns the master if the extracted prefix is a known
 * event id).
 *
 * User-visible flow this spec covers:
 *
 *   1. Seed a daily recurring all-day event on today.
 *   2. Visit /month.
 *   3. Click the all-day recurring card.
 *   4. The preview popup opens (this is the regression assertion).
 *   5. "Open event" → modal opens with the event's data populated.
 *   6. The modal knows the event is recurring, so the RecurrenceDialog
 *      path is reachable on save.
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

interface RecurringAllDaySeed {
  id: string
  title: string
  startDate: string
  endDate: string
}

function todayUtc(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
}

async function seedRecurringAllDayEvent(
  page: import('@playwright/test').Page,
  seed: RecurringAllDaySeed
): Promise<void> {
  const flagKey = `__calino_test_event_${seed.id}`
  const event = {
    id: seed.id,
    title: seed.title,
    type: 'event',
    start: `${seed.startDate}T00:00:00.000Z`,
    end: `${seed.endDate}T00:00:00.000Z`,
    isAllDay: true,
    calendarId: 'default',
    recurrence: { frequency: 'daily', interval: 1 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await page.addInitScript(
    ({ flagKey, calendarKey, event }: { flagKey: string; calendarKey: string; event: unknown }) => {
      try {
        if (sessionStorage.getItem(flagKey)) return
        sessionStorage.setItem(flagKey, '1')
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
    { flagKey, calendarKey: 'calino-storage', event }
  )
}

test.describe('Recurring all-day event — click in /month', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedRecurringAllDayEvent(page, {
      id: 'daily-allday-standup',
      title: 'Daily all-day standup',
      startDate: todayUtc(),
      endDate: todayUtc(),
    })
  })

  test('clicking a recurring all-day card opens the preview popup (regression)', async ({ page }) => {
    await page.goto('/month')
    const card = page.locator('[data-component="event-card"]').filter({ hasText: 'Daily all-day standup' }).first()
    await expect(card).toBeVisible()

    // Sanity: the card is marked as a recurring (non-draggable) card so the
    // user gets the pointer cursor + tooltip. If this ever flips back to a
    // draggable card, the test below would still pass for a different reason
    // and we'd lose the regression signal — keep them paired.
    await expect(card).toHaveAttribute('data-no-drag', '')
    expect(await card.evaluate((el) => (el as HTMLElement).style.cursor)).toBe('pointer')

    // The actual regression assertion: click → preview popup. Before the fix
    // the popup never opened because `findEventById` couldn't resolve the
    // all-day instance id back to the master.
    await card.click()
    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
  })

  test('preview "Open event" → modal shows the master event (regression)', async ({ page }) => {
    await page.goto('/month')
    const card = page.locator('[data-component="event-card"]').filter({ hasText: 'Daily all-day standup' }).first()
    await expect(card).toBeVisible()

    await card.click()
    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
    await preview.getByRole('button', { name: /Open event/ }).click()

    // Modal opens with the event data. The title is preserved (proves we
    // routed to the master, not a no-op), and the Recurring toggle is on
    // (proves the modal knows the event is recurring → the RecurrenceDialog
    // will be offered on save).
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await expect(modal.locator('[data-component="event-title-input"]')).toHaveValue('Daily all-day standup')
    await expect(modal.getByText('Recurring', { exact: true })).toBeVisible()
  })
})
