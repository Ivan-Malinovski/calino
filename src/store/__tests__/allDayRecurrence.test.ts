import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarStore } from '../calendarStore'

// Regression tests for all-day recurring expansion: occurrences must land on the
// correct calendar day and keep whole-day duration even across DST boundaries.
describe('all-day recurrence expansion', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => {
      if (!c.isDefault) store.deleteCalendar(c.id)
    })
    useCalendarStore.setState({ selectedCategoryIds: [] })
  })

  const defaultCalId = () => useCalendarStore.getState().calendars.find((c) => c.isDefault)!.id

  it('keeps a daily all-day event on its own day across a spring-forward DST boundary', () => {
    const store = useCalendarStore.getState()
    // US spring-forward 2026 is 2026-03-08. Cover a window straddling it.
    store.addEvent({
      id: 'anniv',
      calendarId: defaultCalId(),
      title: 'Daily marker',
      start: '2026-03-06T00:00:00',
      end: '2026-03-06T00:00:00',
      isAllDay: true,
      rruleString: 'FREQ=DAILY',
    })

    const events = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-11')

    // One occurrence per day, each starting at floating midnight of its own day.
    const startDays = events.map((e) => e.start.split('T')[0]).sort()
    expect(startDays).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ])
    // Every occurrence is floating midnight, not shifted by an hour.
    for (const e of events) {
      expect(e.start.endsWith('T00:00:00')).toBe(true)
    }
  })

  it('memoizes identical range queries and invalidates after a mutation', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'plain',
      calendarId: defaultCalId(),
      title: 'Plain',
      start: '2026-03-06T10:00:00',
      end: '2026-03-06T11:00:00',
      isAllDay: false,
    })

    const first = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')
    const second = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')
    // Same inputs → same cached array reference.
    expect(second).toBe(first)

    // Mutating events must invalidate the cache.
    useCalendarStore.getState().addEvent({
      id: 'plain2',
      calendarId: defaultCalId(),
      title: 'Plain 2',
      start: '2026-03-06T12:00:00',
      end: '2026-03-06T13:00:00',
      isAllDay: false,
    })
    const third = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')
    expect(third).not.toBe(first)
    expect(third.length).toBe(first.length + 1)
  })

  it('invalidates the cache when calendar visibility is toggled (R4.1)', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'visible',
      calendarId: defaultCalId(),
      title: 'Visible',
      start: '2026-03-06T10:00:00',
      end: '2026-03-06T11:00:00',
      isAllDay: false,
    })
    // Add a second calendar with an event that is initially hidden.
    store.addCalendar({
      id: 'cal-extra',
      name: 'Extra',
      color: '#00f',
      isVisible: true,
      isDefault: false,
      showTasksInViews: false,
    })
    store.addEvent({
      id: 'invisible',
      calendarId: 'cal-extra',
      title: 'Invisible',
      start: '2026-03-06T12:00:00',
      end: '2026-03-06T13:00:00',
      isAllDay: false,
    })

    const first = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')
    expect(first.find((e) => e.title === 'Invisible')).toBeDefined()

    // Toggling visibility of the second calendar must invalidate the cache
    // (regression guard for the version counter — without the bump on
    // toggleCalendarVisibility the cached array would still include the
    // now-hidden event).
    store.toggleCalendarVisibility('cal-extra')
    const second = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')
    expect(second).not.toBe(first)
    expect(second.find((e) => e.title === 'Invisible')).toBeUndefined()
  })

  it('invalidates the cache when the category filter changes (R4.1)', () => {
    const store = useCalendarStore.getState()
    store.addCategory({ id: 'cat-1', name: 'Work', color: '#f00' })
    store.addEvent({
      id: 'work',
      calendarId: defaultCalId(),
      title: 'Standup',
      start: '2026-03-06T10:00:00',
      end: '2026-03-06T11:00:00',
      isAllDay: false,
      categories: ['Work'],
    })

    const unfiltered = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')
    expect(unfiltered).toHaveLength(1)

    // Apply the filter — cached result must NOT bleed through.
    store.toggleCategoryFilter('cat-1')
    const filtered = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')
    expect(filtered).not.toBe(unfiltered)
    expect(filtered).toHaveLength(1) // matches the only Work event
  })

  it('rangeExpansionVersion store property bumps on mutations (R4.1 review fix)', () => {
    // CRITICAL R4.1 review fix: bumpRangeExpansionVersion was originally
    // only updating the module-level counter, leaving the store property
    // `state.rangeExpansionVersion` at 0 forever. Component subscriptions
    // and useMemo deps that read the store property were dead code.
    // Verify the property is now kept in sync.
    const store = useCalendarStore.getState()
    const initialVersion = store.rangeExpansionVersion
    expect(typeof initialVersion).toBe('number')

    store.addEvent({
      id: 'version-test',
      calendarId: defaultCalId(),
      title: 'Version test',
      start: '2026-03-06T10:00:00',
      end: '2026-03-06T11:00:00',
      isAllDay: false,
    })
    const afterAdd = useCalendarStore.getState().rangeExpansionVersion
    expect(afterAdd).toBeGreaterThan(initialVersion)

    store.updateEvent('version-test', { title: 'Renamed' })
    const afterUpdate = useCalendarStore.getState().rangeExpansionVersion
    expect(afterUpdate).toBeGreaterThan(afterAdd)

    store.deleteEvent('version-test')
    const afterDelete = useCalendarStore.getState().rangeExpansionVersion
    expect(afterDelete).toBeGreaterThan(afterUpdate)
  })

  it('preserves a multi-day all-day span in each occurrence', () => {
    const store = useCalendarStore.getState()
    // 3-day all-day event: end is exclusive midnight 3 days later.
    store.addEvent({
      id: 'trip',
      calendarId: defaultCalId(),
      title: 'Long weekend',
      start: '2026-03-06T00:00:00',
      end: '2026-03-09T00:00:00',
      isAllDay: true,
      rruleString: 'FREQ=WEEKLY',
    })

    const events = useCalendarStore.getState().getEventsForDateRange('2026-03-06', '2026-03-06')

    expect(events.length).toBe(1)
    expect(events[0].start).toBe('2026-03-06T00:00:00')
    expect(events[0].end).toBe('2026-03-09T00:00:00')
  })
})
