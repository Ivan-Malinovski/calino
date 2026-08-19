import { describe, it, expect, beforeEach } from 'vitest'
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { useCalendarStore } from '../calendarStore'
import { makeRecurringTask } from '@/lib/__tests__/fixtures'
import { nextOpenOccurrence } from '@/lib/occurrenceExpansion'

/**
 * Issue #126 — "Recurring event days shifted".
 *
 * The reporter picks Mon–Fri for a weekly repeat and events render Sun–Thu
 * (selecting Tue–Sat renders Mon–Fri). Filed 2026-08-19, after the Aug 13–16
 * all-day anchor fixes (rruleAnchor / rruleWindow / normaliseAllDayUntil).
 *
 * The vitest suite runs twice — TZ=America/New_York (west) and
 * TZ=Europe/Copenhagen (east) — so assertions that depend on the device zone
 * derive their expectation from the ambient zone rather than hardcoding it.
 */

// --- Regression guards: the all-day anchor fixes hold ---

describe('issue 126 — all-day weekly Mon–Fri stays Mon–Fri', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
  })

  // 2026-08-03 is a Monday in every zone's calendar.
  const MONDAY = '2026-08-03'
  const shapes = [
    // Locally created all-day events (EventModal): floating midnight.
    { name: 'floating midnight', start: `${MONDAY}T00:00:00`, end: `${MONDAY}T00:00:00` },
    // CalDAV VEVENT all-day parse: bare date.
    { name: 'bare date', start: MONDAY, end: MONDAY },
    // VTODO fallback: UTC midnight.
    { name: 'UTC midnight', start: `${MONDAY}T00:00:00.000Z`, end: `${MONDAY}T00:00:00.000Z` },
  ]

  for (const shape of shapes) {
    it(`anchors correctly from ${shape.name}`, () => {
      useCalendarStore.getState().addEvent({
        id: `allday-${shape.name.replace(/\W+/g, '-')}`,
        calendarId: 'default',
        title: 'Workweek',
        start: shape.start,
        end: shape.end,
        isAllDay: true,
        recurrence: { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
        rruleString: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      })

      const store = useCalendarStore.getState()
      // The whole week Mon 2026-08-03 .. Sun 2026-08-09.
      const week = store.getEventsForDateRange('2026-08-03', '2026-08-09')
      const days = week
        .filter((e) => e.id.startsWith('allday-'))
        .map((e) => e.start.split('T')[0])
        .sort()

      // Monday–Friday, in both the west and east vitest projects.
      expect(days).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'])
    })
  }
})

// --- Local (no-TZID) timed events render on the picked weekdays ---

describe('issue 126 — local (no-TZID) timed recurring event lands on the picked weekdays', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
  })

  it('renders a Tuesday 23:00 weekly series on Tuesdays in the device zone', () => {
    // Locally created timed events are stored as Z instants with no TZID
    // (EventModal: new Date(localStart).toISOString()). The user picked
    // Tuesday 23:00 — in the west project that is 03:00Z/04:00Z the next day,
    // in the east project it is the same UTC day (21:00Z/22:00Z).
    const localStart = new Date('2026-08-04T23:00:00')
    useCalendarStore.getState().addEvent({
      id: 'late-local',
      calendarId: 'default',
      title: 'Local Late Tuesday',
      start: localStart.toISOString(),
      end: new Date(localStart.getTime() + 30 * 60000).toISOString(),
      isAllDay: false,
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2] },
      rruleString: 'FREQ=WEEKLY;BYDAY=TU',
    })

    const store = useCalendarStore.getState()
    const week = store.getEventsForDateRange('2026-08-03', '2026-08-09')
    const occs = week
      .filter((e) => e.id.startsWith('late-local-'))
      .map((e) => e.start)

    // The view buckets by format(toEventInstant(start), 'yyyy-MM-dd') — the
    // device-local day. Every occurrence must land on a Tuesday in the
    // ambient zone.
    expect(occs.length).toBeGreaterThan(0)
    for (const start of occs) {
      const deviceDay = format(new Date(start), 'yyyy-MM-dd')
      expect(new Date(deviceDay + 'T00:00:00').getDay()).toBe(2) // Tuesday
    }
  })

  it('renders a Mon–Fri 23:00 weekly series on Mon–Fri, not Sun–Thu', () => {
    // The exact reporter scenario (issue #126): Mon–Fri at a late hour. The
    // user's local Monday 23:00 is the next UTC day, so a UTC-anchored BYDAY
    // evaluation would file the series under Sun–Thu. It must render Mon–Fri
    // in the device zone.
    const localStart = new Date('2026-08-03T23:00:00') // a Monday
    useCalendarStore.getState().addEvent({
      id: 'workweek-late',
      calendarId: 'default',
      title: 'Workweek late',
      start: localStart.toISOString(),
      end: new Date(localStart.getTime() + 30 * 60000).toISOString(),
      isAllDay: false,
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
      rruleString: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    })

    const store = useCalendarStore.getState()
    const week = store.getEventsForDateRange('2026-08-03', '2026-08-09')
    const days = week
      .filter((e) => e.id.startsWith('workweek-late-'))
      .map((e) => format(new Date(e.start), 'yyyy-MM-dd'))
      .sort()

    expect(days).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'])
  })
})

// --- TZID timed events: view rendering is correct, but occDateStr is the UTC
// day. That matters for EXDATE/override matching and task due-day filing. ---

describe('issue 126 — TZID timed occurrence day-key is the wall-clock day', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
  })

  it('the view still files a late-evening TZID event under its local day', () => {
    // Weekly Tuesday 23:00 in New York (EDT, UTC-4 in August). Stored as a
    // naive wall clock + TZID (the CalDAV shape). The instant is the *next*
    // UTC day, but the grid buckets by the local calendar day (Tuesday).
    useCalendarStore.getState().addEvent({
      id: 'late-nyc',
      calendarId: 'default',
      title: 'Late Tuesday',
      start: '2026-08-04T23:00:00',
      end: '2026-08-04T23:30:00',
      isAllDay: false,
      timezone: 'America/New_York',
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2] },
      rruleString: 'FREQ=WEEKLY;BYDAY=TU',
    })

    const store = useCalendarStore.getState()
    const week = store.getEventsForDateRange('2026-08-03', '2026-08-09')
    const occs = week.filter((e) => e.id.startsWith('late-nyc-'))

    // One Tuesday 23:00 EDT falls in the local window (the next is Aug 11).
    expect(occs.length).toBe(1)
    for (const occ of occs) {
      // The start is the true instant: 03:00Z the next day (EDT = UTC-4).
      expect(occ.start).toMatch(/T03:00:00\.000Z$/)
      // The view's day-key — what the grid actually files it under — is the
      // local calendar day in the *event's* zone (toEventInstant + timezone).
      const viewDay = formatInTimeZone(new Date(occ.start), 'America/New_York', 'yyyy-MM-dd')
      expect(new Date(viewDay + 'T00:00:00').getDay()).toBe(2) // Tuesday
    }
  })

  it('EXDATE matching uses the wall-clock day, not the UTC day', () => {
    // A detached override suppresses the master slot for Aug 4. The override
    // stores RECURRENCE-ID as the naive wall clock '2026-08-04T23:00:00'. The
    // master's occurrence for that day has UTC day '2026-08-05' — if
    // suppression keyed on the UTC day, the override would not match and the
    // master slot would still render.
    useCalendarStore.getState().addEvent({
      id: 'late-nyc',
      calendarId: 'default',
      title: 'Late Tuesday',
      start: '2026-08-04T23:00:00',
      end: '2026-08-04T23:30:00',
      isAllDay: false,
      timezone: 'America/New_York',
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2] },
      rruleString: 'FREQ=WEEKLY;BYDAY=TU',
    })
    useCalendarStore.getState().addEvent({
      id: 'late-nyc-override',
      calendarId: 'default',
      title: 'Late Tuesday (moved)',
      start: '2026-08-05T10:00:00',
      end: '2026-08-05T10:30:00',
      isAllDay: false,
      timezone: 'America/New_York',
      recurrenceId: '2026-08-04T23:00:00',
      recurrenceMasterId: 'late-nyc',
    })

    const store = useCalendarStore.getState()
    const week = store.getEventsForDateRange('2026-08-03', '2026-08-09')
    const masterSlots = week.filter(
      (e) => e.id.startsWith('late-nyc-') && e.start.startsWith('2026-08-05')
    )
    // The master's Aug 4 occurrence must be suppressed by the override.
    expect(masterSlots.some((e) => e.recurrenceMasterId === undefined)).toBe(false)
    // And the override itself renders.
    expect(week.some((e) => e.id === 'late-nyc-override')).toBe(true)
  })
})

// --- nextOpenOccurrence path (tasks): occDateStr is the wall-clock day ---

describe('issue 126 — nextOpenOccurrence timed day-key matches the local day', () => {
  it('files a late-evening TZID task occurrence under its local day', () => {
    // A daily 23:00 New York task: wall clock 23:00 is 03:00Z the next day.
    // The occurrence's occDateStr must be the wall-clock day.
    const master = makeRecurringTask('FREQ=DAILY', {
      isAllDay: false,
      timezone: 'America/New_York',
      start: '2026-08-03T23:00:00',
      end: '2026-08-03T23:30:00',
      rruleString: 'FREQ=DAILY',
    })
    const shape = nextOpenOccurrence(master, new Map())!
    // EDT = UTC-4 in August.
    expect(shape.occStartStr).toBe('2026-08-04T03:00:00.000Z')
    // The day-key must be the wall-clock calendar day.
    expect(shape.occDateStr).toBe('2026-08-03')
  })
})
