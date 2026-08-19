import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarStore, getTasksForDay } from '../calendarStore'
import { makeRecurringTask } from '@/lib/__tests__/fixtures'

describe('issue 126 — TZID task due-day filing', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
  })

  it('files a 23:00 New York daily task under its wall-clock day', () => {
    useCalendarStore.getState().addEvent(
      makeRecurringTask('FREQ=DAILY', {
        id: 'nyc-task',
        uid: 'nyc-task',
        calendarId: 'default',
        title: 'NYC late task',
        isAllDay: false,
        timezone: 'America/New_York',
        start: '2026-08-03T23:00:00',
        end: '2026-08-03T23:30:00',
        dueDate: '2026-08-03T23:30:00',
        rruleString: 'FREQ=DAILY',
      })
    )

    const events = useCalendarStore.getState().events
    // The wall-clock due day (Aug 3) must show the occurrence, even though the
    // due instant is 03:30Z the next day — in both vitest zones. (Aug 4 also
    // shows one: the daily series has its own Aug 4 occurrence.)
    const onWallDay = getTasksForDay(events, '2026-08-03')
    expect(onWallDay.some((e) => e.id.startsWith('nyc-task-'))).toBe(true)
  })
})
