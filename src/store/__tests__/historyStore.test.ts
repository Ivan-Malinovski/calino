import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarStore } from '../calendarStore'
import { useHistoryStore } from '../historyStore'
import type { CalendarEvent } from '@/types'

function makeEvent(id: string, title = id): CalendarEvent {
  return {
    id,
    calendarId: 'default',
    title,
    start: '2024-03-15T10:00:00',
    end: '2024-03-15T11:00:00',
    isAllDay: false,
    type: 'event',
  }
}

describe('historyStore', () => {
  beforeEach(() => {
    const defaultCal = useCalendarStore.getState().calendars.find((c) => c.isDefault)
    useCalendarStore.setState({
      events: [],
      calendars: defaultCal ? [defaultCal] : [],
    })
    useHistoryStore.getState().clear()
  })

  it('undoes an added event', () => {
    useCalendarStore.getState().addEvent(makeEvent('a'))
    expect(useCalendarStore.getState().events).toHaveLength(1)

    expect(useHistoryStore.getState().undo()).toBe(true)
    expect(useCalendarStore.getState().events).toHaveLength(0)
  })

  it('redoes an undone event', () => {
    useCalendarStore.getState().addEvent(makeEvent('a'))
    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().events).toHaveLength(0)

    expect(useHistoryStore.getState().redo()).toBe(true)
    expect(useCalendarStore.getState().events).toHaveLength(1)
    expect(useCalendarStore.getState().events[0].id).toBe('a')
  })

  it('undoes updates and deletes', () => {
    const store = useCalendarStore.getState()
    store.addEvent(makeEvent('a', 'Original'))
    store.updateEvent('a', { title: 'Changed' })
    expect(useCalendarStore.getState().events[0].title).toBe('Changed')

    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().events[0].title).toBe('Original')

    store.deleteEvent('a')
    expect(useCalendarStore.getState().events).toHaveLength(0)
    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().events).toHaveLength(1)
  })

  it('clears the redo stack after a fresh mutation', () => {
    const store = useCalendarStore.getState()
    store.addEvent(makeEvent('a'))
    useHistoryStore.getState().undo()
    expect(useHistoryStore.getState().canRedo()).toBe(true)

    store.addEvent(makeEvent('b'))
    expect(useHistoryStore.getState().canRedo()).toBe(false)
  })

  it('returns false when there is nothing to undo/redo', () => {
    expect(useHistoryStore.getState().undo()).toBe(false)
    expect(useHistoryStore.getState().redo()).toBe(false)
  })

  it('does not record its own undo/redo swaps as history', () => {
    const store = useCalendarStore.getState()
    store.addEvent(makeEvent('a'))
    store.addEvent(makeEvent('b'))
    useHistoryStore.getState().undo() // back to [a]
    useHistoryStore.getState().undo() // back to []
    expect(useCalendarStore.getState().events).toHaveLength(0)
    useHistoryStore.getState().redo() // [a]
    useHistoryStore.getState().redo() // [a, b]
    expect(useCalendarStore.getState().events).toHaveLength(2)
  })

  it('undoes adding a calendar', () => {
    const store = useCalendarStore.getState()
    const before = store.calendars.length
    store.addCalendar({
      id: 'cal-1',
      name: 'Work',
      color: '#ff0000',
      isVisible: true,
      isDefault: false,
      showTasksInViews: false,
    })
    expect(useCalendarStore.getState().calendars.length).toBe(before + 1)

    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().calendars.length).toBe(before)
  })

  it('undoes renaming a calendar', () => {
    const store = useCalendarStore.getState()
    store.addCalendar({
      id: 'cal-rename',
      name: 'Original',
      color: '#aaa',
      isVisible: true,
      isDefault: false,
      showTasksInViews: false,
    })
    const calId = 'cal-rename'
    store.updateCalendar(calId, { name: 'Renamed' })
    expect(useCalendarStore.getState().calendars.find((c) => c.id === calId)!.name).toBe('Renamed')

    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().calendars.find((c) => c.id === calId)!.name).toBe('Original')
  })

  it('undoes toggling calendar visibility', () => {
    const store = useCalendarStore.getState()
    store.addCalendar({
      id: 'cal-vis',
      name: 'Vis',
      color: '#bbb',
      isVisible: true,
      isDefault: false,
      showTasksInViews: false,
    })
    const calId = 'cal-vis'
    store.toggleCalendarVisibility(calId)
    expect(useCalendarStore.getState().calendars.find((c) => c.id === calId)!.isVisible).toBe(false)

    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().calendars.find((c) => c.id === calId)!.isVisible).toBe(true)
  })

  it('undoes deleting a calendar', () => {
    const store = useCalendarStore.getState()
    store.addCalendar({
      id: 'cal-del',
      name: 'Temp',
      color: '#000',
      isVisible: true,
      isDefault: false,
      showTasksInViews: false,
    })
    const beforeCount = useCalendarStore.getState().calendars.length
    store.deleteCalendar('cal-del')
    expect(useCalendarStore.getState().calendars.length).toBe(beforeCount - 1)

    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().calendars.some((c) => c.id === 'cal-del')).toBe(true)
  })

  it('captures both events and calendars in snapshots', () => {
    const store = useCalendarStore.getState()
    const eventsBefore = store.events.length
    const calsBefore = store.calendars.length
    store.addEvent(makeEvent('ev1'))
    store.addCalendar({
      id: 'cal-2',
      name: 'Personal',
      color: '#00f',
      isVisible: true,
      isDefault: false,
      showTasksInViews: false,
    })

    // Undo #1: reverts the calendar add — event stays, calendar removed.
    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().calendars.length).toBe(calsBefore)
    expect(useCalendarStore.getState().events.length).toBe(eventsBefore + 1)

    // Undo #2: reverts the event add — both back to initial.
    useHistoryStore.getState().undo()
    expect(useCalendarStore.getState().events.length).toBe(eventsBefore)
    expect(useCalendarStore.getState().calendars.length).toBe(calsBefore)

    // Redo #1: re-applies event add.
    useHistoryStore.getState().redo()
    expect(useCalendarStore.getState().events.length).toBe(eventsBefore + 1)

    // Redo #2: re-applies calendar add.
    useHistoryStore.getState().redo()
    expect(useCalendarStore.getState().events).toHaveLength(eventsBefore + 1)
    expect(useCalendarStore.getState().calendars).toHaveLength(calsBefore + 1)
  })
})
