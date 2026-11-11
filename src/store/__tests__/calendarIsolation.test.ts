import { describe, it, expect, beforeEach } from 'vitest'
import type { Calendar } from '@/types'
import { useCalendarStore } from '../calendarStore'

function calendar(id: string, isVisible: boolean): Calendar {
  return { id, name: id, color: '#4285F4', isVisible, isDefault: id === 'work', showTasksInViews: true }
}

function visibility(): Record<string, boolean> {
  return Object.fromEntries(
    useCalendarStore.getState().calendars.map((c) => [c.id, c.isVisible])
  )
}

describe('calendar isolation', () => {
  beforeEach(() => {
    useCalendarStore.setState({
      calendars: [calendar('work', true), calendar('home', false), calendar('family', true)],
      calendarVisibilitySnapshot: null,
    })
  })

  describe('isolateCalendar', () => {
    it('shows only the chosen calendar and snapshots the previous visibility', () => {
      const versionBefore = useCalendarStore.getState().rangeExpansionVersion

      useCalendarStore.getState().isolateCalendar('home')

      const state = useCalendarStore.getState()
      expect(visibility()).toEqual({ work: false, home: true, family: false })
      expect(state.calendarVisibilitySnapshot).toEqual({ work: true, home: false, family: true })
      // Visibility feeds getEventsForDateRange, so its cache must invalidate.
      expect(state.rangeExpansionVersion).toBeGreaterThan(versionBefore)
    })

    it('keeps the original snapshot when switching to another calendar', () => {
      const store = useCalendarStore.getState()
      store.isolateCalendar('home')
      store.isolateCalendar('family')

      expect(visibility()).toEqual({ work: false, home: false, family: true })
      expect(useCalendarStore.getState().calendarVisibilitySnapshot).toEqual({
        work: true,
        home: false,
        family: true,
      })
    })

    it('keeps the snapshot across manual toggles while isolated', () => {
      const store = useCalendarStore.getState()
      store.isolateCalendar('home')
      store.toggleCalendarVisibility('work')

      expect(visibility()).toEqual({ work: true, home: true, family: false })
      expect(useCalendarStore.getState().calendarVisibilitySnapshot).toEqual({
        work: true,
        home: false,
        family: true,
      })
    })

    it('ignores an unknown calendar id', () => {
      useCalendarStore.getState().isolateCalendar('missing')

      expect(visibility()).toEqual({ work: true, home: false, family: true })
      expect(useCalendarStore.getState().calendarVisibilitySnapshot).toBeNull()
    })
  })

  describe('restoreCalendarVisibility', () => {
    it('restores the pre-isolation visibility and clears the snapshot', () => {
      const store = useCalendarStore.getState()
      store.isolateCalendar('home')
      store.isolateCalendar('family')
      const versionBefore = useCalendarStore.getState().rangeExpansionVersion

      store.restoreCalendarVisibility()

      const state = useCalendarStore.getState()
      expect(visibility()).toEqual({ work: true, home: false, family: true })
      expect(state.calendarVisibilitySnapshot).toBeNull()
      expect(state.rangeExpansionVersion).toBeGreaterThan(versionBefore)
    })

    it('leaves calendars added since isolating alone and ignores deleted ones', () => {
      const store = useCalendarStore.getState()
      store.isolateCalendar('work')
      store.addCalendar(calendar('new-hidden', false))
      store.addCalendar(calendar('new-visible', true))
      store.deleteCalendar('family')

      store.restoreCalendarVisibility()

      expect(visibility()).toEqual({
        work: true,
        home: false,
        'new-hidden': false,
        'new-visible': true,
      })
      expect(useCalendarStore.getState().calendarVisibilitySnapshot).toBeNull()
    })

    it('does nothing when no calendar is isolated', () => {
      const before = useCalendarStore.getState().calendars

      useCalendarStore.getState().restoreCalendarVisibility()

      expect(useCalendarStore.getState().calendars).toBe(before)
    })
  })
})
