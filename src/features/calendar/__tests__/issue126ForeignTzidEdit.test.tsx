import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { parseICALEvent } from '@/features/caldav/adapter/iCalendarAdapter'
import { toEventInstant } from '@/lib/datetime'

/**
 * Issue #126 — editing an item that arrived from another client.
 *
 * The write-side fix stamps the device zone on a timed item and stores its
 * wall clock, but only when the item does not already carry a zone. An item
 * synced with a *foreign* TZID must keep the old instant write: the modal
 * seeds its form in the device zone, so writing those fields back as a wall
 * clock would silently re-read them in the foreign zone and move the event by
 * the offset between the two.
 *
 * The fixture is real ICS put through the CalDAV parser rather than a
 * hand-built object, so "as if it came from another client" is literally true.
 */

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      return (
        <div ref={ref} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
          {children as React.ReactNode}
        </div>
      )
    }),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMotionValue: (initial: number) => {
    const value = initial
    return { get: () => value, set: () => {}, on: () => () => {} }
  },
  animate: () => ({ stop: () => {} }),
}))

const updateCalDAVEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({
    syncAll: vi.fn(),
    createEvent: vi.fn().mockResolvedValue(undefined),
    updateEvent: updateCalDAVEvent,
    deleteEvent: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/features/nlp', () => ({
  parseNaturalLanguage: vi.fn().mockReturnValue({
    title: '',
    confidence: 0,
    startDate: new Date(),
    endDate: null,
    location: null,
    isAllDay: false,
    isTask: false,
  }),
}))

// A weekly 09:00 Los Angeles series, exactly as a foreign client publishes it.
const FOREIGN_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Some Other Client//EN
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZNAME:PDT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZNAME:PST
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:foreign-standup
DTSTART;TZID=America/Los_Angeles:20260803T090000
DTEND;TZID=America/Los_Angeles:20260803T093000
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
SUMMARY:LA standup
END:VEVENT
END:VCALENDAR`

const DEFAULT_CALENDAR = {
  id: 'default',
  name: 'Cal',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
}

describe('issue 126 — editing a foreign-TZID event does not move it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const [parsed] = parseICALEvent(FOREIGN_ICS, 'default')
    // Sanity: the parser really did give us a foreign zone to defend.
    expect(parsed.timezone).toBe('America/Los_Angeles')

    useCalendarStore.setState({
      events: [{ ...parsed, id: 'foreign-standup' }],
      calendars: [DEFAULT_CALENDAR],
      categories: [],
      isModalOpen: true,
      selectedEventId: 'foreign-standup',
      selectedDate: null,
      selectedEndDate: null,
      selectedEventType: 'event',
    })
    useSettingsStore.setState({ timeFormat: '24h', dateFormat: 'MM/dd/yyyy' })
  })

  it('keeps the instant, the zone and the weekdays when only the title changes', async () => {
    const before = useCalendarStore.getState().events[0]
    const beforeInstant = toEventInstant(before.start, before.timezone).toISOString()

    const { EventModal } = await import('@/features/calendar/components/EventModal')
    render(<EventModal />)

    const titleInput = screen.getByPlaceholderText('Event title') as HTMLInputElement
    expect(titleInput.value).toBe('LA standup')

    await act(async () => {
      fireEvent.change(titleInput, { target: { value: 'LA standup (renamed)' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })
    // Editing a series asks for a scope first.
    await act(async () => {
      fireEvent.click(screen.getByText('All events'))
    })

    const after = useCalendarStore.getState().events.find((e) => e.id === 'foreign-standup')!
    expect(after.title).toBe('LA standup (renamed)')

    // The zone survives: the item is not re-stamped with the device zone.
    expect(after.timezone).toBe('America/Los_Angeles')
    // And the event did not move, even though the form showed — and wrote
    // back — device-local times.
    expect(toEventInstant(after.start, after.timezone).toISOString()).toBe(beforeInstant)

    // The series still runs on Los Angeles weekdays at 09:00 Los Angeles. This
    // is the round trip that used to drift: the save leaves `start` as an
    // instant while the TZID stays, and the expansion has to resolve it
    // through the event's own zone rather than stripping the Z.
    const laTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const week = useCalendarStore
      .getState()
      .getEventsForDateRange('2026-08-03', '2026-08-09')
      .filter((e) => e.id.startsWith('foreign-standup'))
    expect(week.map((e) => laTime.format(new Date(e.start)))).toEqual([
      'Mon 09:00',
      'Tue 09:00',
      'Wed 09:00',
      'Thu 09:00',
      'Fri 09:00',
    ])
  })

  // The split path is the one that inserts rather than updates, and an insert
  // used to skip the TZID wall-clock normalization that `updateEvent` does.
  // The new master must land in the event zone's frame, not the device's.
  it('splits a foreign-TZID series without moving the new master', async () => {
    // Reopen on the Wednesday occurrence rather than the master.
    useCalendarStore.setState({ selectedEventId: 'foreign-standup-2026-08-05T16:00:00.000Z' })

    const { EventModal } = await import('@/features/calendar/components/EventModal')
    render(<EventModal />)

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Event title'), {
        target: { value: 'LA standup (v2)' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('This and following events'))
    })

    const newMaster = useCalendarStore.getState().events.find((e) => e.title === 'LA standup (v2)')!
    expect(newMaster).toBeDefined()
    expect(newMaster.timezone).toBe('America/Los_Angeles')
    // Stored in the event zone's frame: a naive wall clock, not a Z instant.
    expect(newMaster.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(newMaster.start).toBe('2026-08-05T09:00:00')

    const laTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const rest = useCalendarStore
      .getState()
      .getEventsForDateRange('2026-08-05', '2026-08-09')
      .filter((e) => e.id.startsWith(newMaster.id))
    expect(rest.map((e) => laTime.format(new Date(e.start)))).toEqual([
      'Wed 09:00',
      'Thu 09:00',
      'Fri 09:00',
    ])
  })
})
