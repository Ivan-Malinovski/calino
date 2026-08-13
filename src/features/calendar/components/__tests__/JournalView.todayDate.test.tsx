import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router'
import { JournalView } from '../JournalView'
import { useCalendarStore } from '@/store/calendarStore'

vi.mock('@/hooks/useIsMobile')

/**
 * #116 — a journal entry's DTSTART is a *floating* date, so the compose form's
 * default has to be the user's local calendar day. Deriving it from
 * `toISOString()` (UTC) filed evening entries west of UTC under tomorrow.
 *
 * The suite runs either side of UTC (see vite.config.ts), so the instant is
 * built from the ambient zone rather than hardcoded: late evening west of UTC
 * (the reporter's own case — 2026-08-12 20:18 New York is already the 13th in
 * UTC) and just after midnight east of it, which is the same defect mirrored.
 * The guard below asserts the only property that matters — that the local day
 * and the UTC day genuinely differ, so a UTC-defaulting regression cannot pass.
 *
 * `e2e/journal-timezone.spec.ts` covers the same case end to end, against a
 * real stored DTSTART.
 */
// getTimezoneOffset is positive west of UTC, negative east.
const IS_WEST_OF_UTC = new Date('2026-08-12T12:00:00').getTimezoneOffset() > 0
const LOCAL_EVENING = IS_WEST_OF_UTC
  ? new Date(2026, 7, 12, 20, 18)
  : new Date(2026, 7, 12, 0, 30)
const LOCAL_DAY = '2026-08-12'

describe('JournalView compose date (#116)', () => {
  beforeEach(() => {
    // Guards the config-level TZ pin: without it the expectation below would
    // be zone-dependent and a UTC-defaulting regression could pass silently.
    expect(LOCAL_EVENING.toISOString().split('T')[0]).not.toBe(LOCAL_DAY)

    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(LOCAL_EVENING)

    const store = useCalendarStore.getState()
    store.setCurrentView('journal')
    store.events.forEach((e) => store.deleteEvent(e.id))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults a new entry to the local day, not the UTC day', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <BrowserRouter>
        <JournalView />
      </BrowserRouter>
    )

    await user.click(document.querySelector('[data-component="journal-new-entry"]')!)

    // The date renders as a button; clicking it swaps in the <input type="date">
    // holding the raw yyyy-MM-dd the entry will be saved with.
    await user.click(screen.getByTitle('Click to change date'))

    const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')
    expect(dateInput).not.toBeNull()
    expect(dateInput!.value).toBe(LOCAL_DAY)
  })
})
