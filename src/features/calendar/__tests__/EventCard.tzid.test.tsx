import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { isSameDay } from 'date-fns'
import type { Active, Over } from '@dnd-kit/core'
import { EventCard } from '../components/EventCard'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { toEventInstant } from '@/lib/datetime'
import {
  computeDropPreview,
  snapMinuteOfDay,
  timedDragStartMinutes,
  MINUTE_SNAP_INTERVAL,
} from '../lib/dragSnap'
import type { CalendarEvent } from '@/types'

vi.mock('@/features/caldav/hooks/useCalDAV')

const mockUseCalDAV = vi.mocked(useCalDAV)

// The bug this suite pins: drag metadata and multi-day detection read TZID
// event times with naive parseISO, which treats the event-zone wall clock as a
// device-local time. The fixtures below store naive wall clocks in
// Europe/Copenhagen; the device frame is whatever zone the running project
// pins (west: America/New_York, east: Europe/Copenhagen — see vite.config.ts).
// Expectations are derived from the device frame via toEventInstant, per the
// repo rule that zone-dependent tests derive from the ambient zone instead of
// hardcoding one offset.
const TZID = 'Europe/Copenhagen'
const HOUR_HEIGHT = 60

function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function seedStore(): void {
  const store = useCalendarStore.getState()
  store.events.forEach((e) => store.deleteEvent(e.id))
  store.calendars.forEach((c) => store.deleteCalendar(c.id))
  store.addCalendar({
    id: 'default',
    name: 'Default Calendar',
    color: '#4285F4',
    isVisible: true,
    isDefault: true,
    showTasksInViews: true,
  })
}

describe('timedDragStartMinutes (drag metadata device frame)', () => {
  it('resolves a TZID start to the device-frame minute of day', () => {
    // 10:00 in Copenhagen. The device-frame instant is what the drop preview
    // snaps from — the naive parseISO wall clock would be wrong by the zone
    // offset whenever zone and device diverge.
    const start = '2026-02-10T10:00:00'
    const deviceInstant = toEventInstant(start, TZID)
    expect(timedDragStartMinutes(start, TZID)).toBe(
      deviceInstant.getHours() * 60 + deviceInstant.getMinutes()
    )
  })

  it('reproduces the exact bug value on a New York device (10:00 Copenhagen → 04:00)', () => {
    // Only asserted in the west project (America/New_York), where the naive
    // parseISO read was 600 instead of 240. In the east project (Copenhagen)
    // both frames agree, so the general assertion above already covers it.
    if (deviceZone() !== 'America/New_York') return
    expect(timedDragStartMinutes('2026-02-10T10:00:00', TZID)).toBe(4 * 60)
  })

  it('treats a floating (no timezone) start as device-local, unchanged', () => {
    // Locally-created events carry no timezone; their wall clock is the device
    // time and must keep behaving as before.
    expect(timedDragStartMinutes('2026-02-10T09:30:00')).toBe(9 * 60 + 30)
  })
})

describe('computeDropPreview with a TZID event (device-frame startMinutes)', () => {
  const over = (id: string) => ({ id }) as unknown as Over
  const timedActive = (start: string) => {
    const instant = toEventInstant(start, TZID)
    const startMinutes = instant.getHours() * 60 + instant.getMinutes()
    return { data: { current: { startMinutes } } } as unknown as Active
  }

  it('lands the preview on the device-frame minute, snapped to a quarter hour', () => {
    // 10:07 in Copenhagen. The buggy parseISO read gave 10:07 → 10:00 (600) on
    // a New York device; the device-frame instant is 04:07 → 04:00 (240).
    // Expected value is derived from toEventInstant so both projects pass.
    const start = '2026-02-10T10:07:00'
    const startMinutes =
      toEventInstant(start, TZID).getHours() * 60 + toEventInstant(start, TZID).getMinutes()
    const preview = computeDropPreview(
      timedActive(start),
      over('2026-02-10-10:00'),
      0,
      HOUR_HEIGHT,
      60
    )
    expect(preview).toEqual({
      dateKey: '2026-02-10',
      minuteOfDay: snapMinuteOfDay(startMinutes, 0, HOUR_HEIGHT),
      durationMinutes: 60,
    })
    expect(preview!.minuteOfDay % MINUTE_SNAP_INTERVAL).toBe(0)
    if (deviceZone() === 'America/New_York') {
      // The documented bug scenario: preview lands at 04:00 (240), not 10:00.
      expect(preview!.minuteOfDay).toBe(4 * 60)
    }
  })

  it('keeps the device-frame time through a vertical drag delta', () => {
    const startMinutes =
      toEventInstant('2026-02-10T10:00:00', TZID).getHours() * 60 +
      toEventInstant('2026-02-10T10:00:00', TZID).getMinutes()
    const active = { data: { current: { startMinutes } } } as unknown as Active
    const preview = computeDropPreview(active, over('2026-02-10-10:00'), 50, HOUR_HEIGHT, 60)
    expect(preview?.minuteOfDay).toBe(snapMinuteOfDay(startMinutes, 50, HOUR_HEIGHT))
  })
})

describe('EventCard isMultiDay with TZID events', () => {
  const crossMidnight: CalendarEvent = {
    id: 'tzid-cross-midnight',
    calendarId: 'default',
    title: 'Cross Midnight',
    start: '2026-02-10T23:30:00',
    end: '2026-02-11T01:00:00',
    timezone: TZID,
    isAllDay: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCalDAV.mockReturnValue({
      accounts: [],
      calendars: [],
      syncState: { status: 'idle', lastSyncAt: null, error: null, pendingChanges: 0 },
      addAccount: vi.fn(),
      removeAccount: vi.fn(),
      syncAccount: vi.fn(),
      syncAll: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    } as unknown as ReturnType<typeof useCalDAV>)
    seedStore()
  })

  const card = (container: HTMLElement): Element | null =>
    container.querySelector('[data-component="event-card"]')

  it('flags multi-day only when the device-frame dates differ (cross-midnight TZID)', () => {
    // 23:30 → 01:00 in Copenhagen. Viewed in New York that is 17:30 → 19:00 on
    // a single device day — the bug: parseISO saw two dates and styled it
    // multi-day. Viewed in Copenhagen it genuinely spans two days. The
    // expectation is derived from the device frame so each project asserts its
    // own truth (and the west project fails on the old parseISO code).
    const expected = !isSameDay(
      toEventInstant(crossMidnight.start, crossMidnight.timezone),
      toEventInstant(crossMidnight.end, crossMidnight.timezone)
    )
    const { container } = render(<EventCard event={crossMidnight} />)
    if (expected) {
      expect(card(container)).toHaveAttribute('data-multi-day')
    } else {
      expect(card(container)).not.toHaveAttribute('data-multi-day')
    }
  })

  it('never flags a same-day TZID event as multi-day', () => {
    const sameDay: CalendarEvent = {
      ...crossMidnight,
      start: '2026-02-10T10:00:00',
      end: '2026-02-10T11:00:00',
    }
    const { container } = render(<EventCard event={sameDay} />)
    expect(card(container)).not.toHaveAttribute('data-multi-day')
  })

  it('still flags a genuinely multi-day TZID event in every zone', () => {
    const multiDay: CalendarEvent = {
      ...crossMidnight,
      start: '2026-02-10T10:00:00',
      end: '2026-02-12T11:00:00',
    }
    const { container } = render(<EventCard event={multiDay} />)
    expect(card(container)).toHaveAttribute('data-multi-day')
  })

  it('keeps all-day multi-day detection on the calendar date (parseISO)', () => {
    const allDay: CalendarEvent = {
      ...crossMidnight,
      id: 'allday-span',
      title: 'All Day Span',
      start: '2026-02-10T00:00:00',
      end: '2026-02-12T00:00:00',
      isAllDay: true,
      timezone: undefined,
    }
    const { container } = render(<EventCard event={allDay} />)
    expect(card(container)).toHaveAttribute('data-multi-day')
  })
})
