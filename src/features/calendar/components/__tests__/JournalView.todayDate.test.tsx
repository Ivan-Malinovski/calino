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
 * The zone is pinned to Europe/Copenhagen by `test.env` in vite.config.ts (a
 * test file can't set it for itself), which is *east* of UTC — so this is the
 * mirror of the reporter's instant: 2026-08-12 00:30 local is still
 * 2026-08-11 in UTC. Same defect, opposite direction.
 * `e2e/journal-timezone.spec.ts` covers the reporter's own America/New_York
 * case, against a real stored DTSTART.
 */
const LOCAL_MIDNIGHT_ISH = new Date('2026-08-11T22:30:00Z')
const LOCAL_DAY = '2026-08-12'

describe('JournalView compose date (#116)', () => {
  beforeEach(() => {
    // Guards the config-level TZ pin: without it the expectation below would
    // be zone-dependent and a UTC-defaulting regression could pass silently.
    expect(LOCAL_MIDNIGHT_ISH.getTimezoneOffset()).toBe(-120)
    expect(LOCAL_MIDNIGHT_ISH.toISOString().split('T')[0]).not.toBe(LOCAL_DAY)

    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(LOCAL_MIDNIGHT_ISH)

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
