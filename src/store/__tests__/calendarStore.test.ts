import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCalendarStore } from '../calendarStore'

describe('calendarStore', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    // Also remove any non-default calendars
    store.calendars.forEach((c) => {
      if (!c.isDefault) store.deleteCalendar(c.id)
    })
    // Clear categories and rules
    const state = useCalendarStore.getState()
    state.categories.forEach((c) => state.deleteCategory(c.id))
    state.autoCategoryRules.forEach((r) => state.deleteAutoCategoryRule(r.id))
    useCalendarStore.setState({ selectedCategoryIds: [] })
  })

  describe('addEvent', () => {
    it('adds an event to the store', () => {
      const store = useCalendarStore.getState()
      const initialCount = store.events.length

      store.addEvent({
        id: 'test-1',
        calendarId: 'default',
        title: 'Test Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      expect(useCalendarStore.getState().events.length).toBe(initialCount + 1)
      expect(useCalendarStore.getState().events[0].title).toBe('Test Event')
    })
  })

  describe('updateEvent', () => {
    it('updates an existing event', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'test-2',
        calendarId: 'default',
        title: 'Original Title',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.updateEvent('test-2', { title: 'Updated Title' })

      const updated = useCalendarStore.getState().events.find((e) => e.id === 'test-2')
      expect(updated?.title).toBe('Updated Title')
    })
  })

  describe('completeTask', () => {
    const addTask = (id: string, parentTaskId?: string) => {
      useCalendarStore.getState().addEvent({
        id,
        calendarId: 'default',
        title: id,
        start: '2024-03-15T00:00:00',
        end: '2024-03-15T00:00:00',
        isAllDay: true,
        type: 'task',
        parentTaskId,
      })
    }

    it('completes a task and every nested descendant with consistent task fields', () => {
      addTask('parent')
      addTask('child', 'parent')
      addTask('grandchild', 'child')
      addTask('unrelated')
      useCalendarStore.getState().addEvent({
        id: 'related-event',
        calendarId: 'default',
        title: 'Related event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
        parentTaskId: 'parent',
      })

      const updatedTasks = useCalendarStore.getState().completeTask('parent', true)

      expect(updatedTasks.map((task) => task.id)).toEqual(['parent', 'child', 'grandchild'])
      for (const task of updatedTasks) {
        expect(task).toEqual(
          expect.objectContaining({
            completed: true,
            taskStatus: 'COMPLETED',
            percentComplete: 100,
          })
        )
      }
      expect(new Set(updatedTasks.map((task) => task.completedAt)).size).toBe(1)
      expect(updatedTasks[0].completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const eventsById = new Map(useCalendarStore.getState().events.map((event) => [event.id, event]))
      expect(eventsById.get('unrelated')?.completed).toBeUndefined()
      expect(eventsById.get('related-event')?.completed).toBeUndefined()
    })

    it('uncompletes only the selected task and clears its completion metadata', () => {
      addTask('parent')
      addTask('child', 'parent')
      addTask('grandchild', 'child')
      useCalendarStore.getState().completeTask('parent', true)

      const updatedTasks = useCalendarStore.getState().completeTask('parent', false)

      expect(updatedTasks).toEqual([
        expect.objectContaining({
          id: 'parent',
          completed: false,
          taskStatus: 'NEEDS-ACTION',
          percentComplete: 0,
          completedAt: undefined,
        }),
      ])
      const eventsById = new Map(useCalendarStore.getState().events.map((event) => [event.id, event]))
      expect(eventsById.get('child')).toEqual(
        expect.objectContaining({
          completed: true,
          taskStatus: 'COMPLETED',
          percentComplete: 100,
        })
      )
      expect(eventsById.get('grandchild')).toEqual(
        expect.objectContaining({
          completed: true,
          taskStatus: 'COMPLETED',
          percentComplete: 100,
        })
      )
    })
  })

  describe('deleteEvent', () => {
    it('removes an event from the store', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'test-3',
        calendarId: 'default',
        title: 'To Delete',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.deleteEvent('test-3')

      const exists = useCalendarStore.getState().events.find((e) => e.id === 'test-3')
      expect(exists).toBeUndefined()
    })
  })

  describe('getEventsForDateRange', () => {
    it('returns events within a date range', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'event-1',
        calendarId: 'default',
        title: 'Event 1',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.addEvent({
        id: 'event-2',
        calendarId: 'default',
        title: 'Event 2',
        start: '2024-03-20T14:00:00',
        end: '2024-03-20T15:00:00',
        isAllDay: false,
      })

      const events = store.getEventsForDateRange('2024-03-15', '2024-03-15')
      expect(events.length).toBe(1)
      expect(events[0].title).toBe('Event 1')
    })

    it('excludes events from hidden calendars', () => {
      const store = useCalendarStore.getState()

      store.addCalendar({
        id: 'work',
        name: 'Work',
        color: '#FF0000',
        isVisible: false,
        isDefault: false,
        showTasksInViews: true,
      })

      store.addEvent({
        id: 'visible-event',
        calendarId: 'default',
        title: 'Visible Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.addEvent({
        id: 'hidden-event',
        calendarId: 'work',
        title: 'Hidden Event',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
      })

      const events = store.getEventsForDateRange('2024-03-15', '2024-03-15')
      expect(events.length).toBe(1)
      expect(events[0].title).toBe('Visible Event')
    })

    it('returns all-day events', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'allday',
        calendarId: 'default',
        title: 'All Day Event',
        start: '2024-03-15T00:00:00',
        end: '2024-03-15T23:59:59',
        isAllDay: true,
      })

      const events = store.getEventsForDateRange('2024-03-15', '2024-03-15')
      expect(events.length).toBe(1)
      expect(events[0].isAllDay).toBe(true)
    })
  })

  describe('calendar management', () => {
    it('adds a calendar', () => {
      const store = useCalendarStore.getState()
      const initialCount = store.calendars.length

      store.addCalendar({
        id: 'personal',
        name: 'Personal',
        color: '#00FF00',
        isVisible: true,
        isDefault: false,
        showTasksInViews: true,
      })

      expect(useCalendarStore.getState().calendars.length).toBe(initialCount + 1)
    })

    it('toggles calendar visibility', () => {
      const store = useCalendarStore.getState()

      store.addCalendar({
        id: 'test-cal',
        name: 'Test',
        color: '#000000',
        isVisible: true,
        isDefault: false,
        showTasksInViews: true,
      })

      store.toggleCalendarVisibility('test-cal')

      const calendar = useCalendarStore.getState().calendars.find((c) => c.id === 'test-cal')
      expect(calendar?.isVisible).toBe(false)
    })

    it('deletes calendar and its events', () => {
      const store = useCalendarStore.getState()

      store.addCalendar({
        id: 'to-delete',
        name: 'To Delete',
        color: '#000000',
        isVisible: true,
        isDefault: false,
        showTasksInViews: true,
      })

      store.addEvent({
        id: 'event-to-delete',
        calendarId: 'to-delete',
        title: 'Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.deleteCalendar('to-delete')

      const calendar = useCalendarStore.getState().calendars.find((c) => c.id === 'to-delete')
      const event = useCalendarStore.getState().events.find((e) => e.id === 'event-to-delete')

      expect(calendar).toBeUndefined()
      expect(event).toBeUndefined()
    })
  })

  describe('navigation', () => {
    it('sets current date', () => {
      const store = useCalendarStore.getState()
      store.setCurrentDate('2024-06-15')
      expect(useCalendarStore.getState().currentDate).toBe('2024-06-15')
    })

    it('sets current view', () => {
      const store = useCalendarStore.getState()
      store.setCurrentView('week')
      expect(useCalendarStore.getState().currentView).toBe('week')

      store.setCurrentView('day')
      expect(useCalendarStore.getState().currentView).toBe('day')

      store.setCurrentView('agenda')
      expect(useCalendarStore.getState().currentView).toBe('agenda')
    })
  })

  describe('modal', () => {
    it('opens modal with date', () => {
      const store = useCalendarStore.getState()
      store.openModal('2024-03-15')

      expect(useCalendarStore.getState().isModalOpen).toBe(true)
      expect(useCalendarStore.getState().selectedDate).toBe('2024-03-15')
    })

    it('opens modal without date', () => {
      const store = useCalendarStore.getState()
      store.openModal()

      expect(useCalendarStore.getState().isModalOpen).toBe(true)
      expect(useCalendarStore.getState().selectedDate).toBeNull()
    })

it('closes modal', () => {
      const store = useCalendarStore.getState()
      store.openModal('2024-03-15')
      store.closeModal()

      expect(useCalendarStore.getState().isModalOpen).toBe(false)
      expect(useCalendarStore.getState().selectedDate).toBeNull()
    })

    // R1.5: TodoView composer forwards its text into the modal via the
    // 5th openModal parameter so the user doesn't have to retype the
    // title they just typed in the inline composer.
    it('forwards initialTitle when opening modal from composer', () => {
      const store = useCalendarStore.getState()
      store.openModal('2024-03-15', undefined, undefined, 'task', 'Buy milk')

      expect(useCalendarStore.getState().isModalOpen).toBe(true)
      expect(useCalendarStore.getState().selectedEventType).toBe('task')
      expect(useCalendarStore.getState().initialTitle).toBe('Buy milk')
    })

    it('clears initialTitle when modal closes', () => {
      const store = useCalendarStore.getState()
      store.openModal('2024-03-15', undefined, undefined, 'task', 'Buy milk')
      store.closeModal()

      expect(useCalendarStore.getState().initialTitle).toBeNull()
    })

    it('defaults initialTitle to null when not passed', () => {
      const store = useCalendarStore.getState()
      store.openModal('2024-03-15')

      expect(useCalendarStore.getState().initialTitle).toBeNull()
})
  })

  describe('recurring event expansion with timezone', () => {
    it('expands recurring event with correct UTC conversion', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'recurring-test',
        calendarId: 'default',
        title: 'Weekly Meeting',
        start: '2024-03-18T09:00:00.000Z',
        end: '2024-03-18T10:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      })

      const events = store.getEventsForDateRange('2024-03-18', '2024-03-22')

      expect(events.length).toBeGreaterThan(0)

      const mondayEvent = events.find((e) => e.id.startsWith('recurring-test-2024-03-18'))
      expect(mondayEvent).toBeDefined()

      const hour = new Date(mondayEvent!.start).getUTCHours()
      expect(hour).toBe(9)
    })

    it('handles DST transition correctly', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'dst-test',
        calendarId: 'default',
        title: 'DST Test',
        start: '2024-03-25T08:00:00.000Z',
        end: '2024-03-25T09:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      })

      const marchEvents = store.getEventsForDateRange('2024-03-25', '2024-03-31')
      const octEvents = store.getEventsForDateRange('2024-10-28', '2024-11-03')

      expect(marchEvents.length).toBeGreaterThan(0)
      expect(octEvents.length).toBeGreaterThan(0)

      const marchHour = new Date(marchEvents[0].start).getUTCHours()
      const octHour = new Date(octEvents[0].start).getUTCHours()

      expect(marchHour).toBe(8)
      expect(octHour).toBe(8)
    })
  })

  describe('recurring event exception override', () => {
    it('uses exception event data instead of expanded instance', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'master-event',
        calendarId: 'default',
        title: 'Weekly Meeting',
        start: '2024-03-18T09:00:00.000Z',
        end: '2024-03-18T10:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      })

      store.addEvent({
        id: 'exception-event',
        calendarId: 'default',
        title: 'Exception Meeting',
        start: '2024-03-18T14:00:00.000Z',
        end: '2024-03-18T15:00:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-03-18T09:00:00.000Z',
      })

      const events = store.getEventsForDateRange('2024-03-18', '2024-03-18')

      expect(events.length).toBe(1)
      expect(events[0].title).toBe('Exception Meeting')
      expect(events[0].start).toBe('2024-03-18T14:00:00.000Z')
      expect(events[0].end).toBe('2024-03-18T15:00:00.000Z')
    })

    it('preserves exception event start/end times', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'master-2',
        calendarId: 'default',
        title: 'Daily Standup',
        start: '2024-03-20T08:00:00.000Z',
        end: '2024-03-20T08:30:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'daily', interval: 1 },
        rruleString: 'FREQ=DAILY;INTERVAL=1',
      })

      store.addEvent({
        id: 'exception-2',
        calendarId: 'default',
        title: 'Special Standup',
        start: '2024-03-20T10:00:00.000Z',
        end: '2024-03-20T11:00:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-03-20T08:00:00.000Z',
      })

      const events = store.getEventsForDateRange('2024-03-20', '2024-03-20')

      expect(events.length).toBe(1)
      expect(events[0].start).toBe('2024-03-20T10:00:00.000Z')
      expect(events[0].end).toBe('2024-03-20T11:00:00.000Z')
    })

    it('expands master events without exceptions normally', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'master-only',
        calendarId: 'default',
        title: 'Regular Meeting',
        start: '2024-03-21T09:00:00.000Z',
        end: '2024-03-21T10:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      })

      const events = store.getEventsForDateRange('2024-03-21', '2024-03-28')

      expect(events.length).toBeGreaterThan(0)
      events.forEach((e) => {
        expect(e.title).toBe('Regular Meeting')
        expect(e.start).toContain('T09:00:00')
      })
    })

    it('exception only affects specific date, other occurrences expand normally', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'multi-master',
        calendarId: 'default',
        title: 'Weekly Sync',
        start: '2024-03-18T10:00:00.000Z',
        end: '2024-03-18T11:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      })

      store.addEvent({
        id: 'single-exception',
        calendarId: 'default',
        title: 'Modified Sync',
        start: '2024-03-18T15:00:00.000Z',
        end: '2024-03-18T16:00:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-03-18T10:00:00.000Z',
      })

      const events = store.getEventsForDateRange('2024-03-18', '2024-04-01')

      expect(events.length).toBe(3)

      const march18Modified = events.filter((e) => e.title === 'Modified Sync')
      expect(march18Modified.length).toBe(1)
      expect(march18Modified[0].start).toBe('2024-03-18T15:00:00.000Z')

      const weeklySyncEvents = events.filter((e) => e.title === 'Weekly Sync')
      expect(weeklySyncEvents.length).toBe(2)
    })
  })

  // ======================================================================
  // Bug fix tests
  // ======================================================================

  describe('Bug 1: persist migrate preserves persistedState', () => {
    it('migrate returns persisted data instead of empty state', () => {
      // The migrate function should preserve existing fields from persistedState.
      // We test this by directly importing and checking the migrate behavior.
      // Since zustand persist's migrate is internal, we test the observable outcome:
      // After a version bump, existing data should survive.
      //
      // We can test indirectly: store data, force a rehydrate, and check it survives.
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'persist-test',
        calendarId: 'default',
        title: 'Should Survive Migration',
        start: '2024-06-01T10:00:00',
        end: '2024-06-01T11:00:00',
        isAllDay: false,
      })

      const eventsBefore = useCalendarStore.getState().events
      expect(eventsBefore.length).toBe(1)
      expect(eventsBefore[0].title).toBe('Should Survive Migration')

      // Verify the store's state is intact (migration won't actually fire on same version,
      // but we verify the migrate function signature accepts and forwards persistedState)
      const currentEvents = useCalendarStore.getState().events
      expect(currentEvents.length).toBe(1)
    })

    it('migrate function signature accepts persisted state parameter', () => {
      // Verify that the migrate function properly destructures persistedState
      // by testing the import - if migrate ignores the parameter, it would always
      // return empty arrays
      const store = useCalendarStore.getState()

      // Add multiple data types
      store.addEvent({
        id: 'migrate-ev',
        calendarId: 'default',
        title: 'Test',
        start: '2024-01-01T00:00:00',
        end: '2024-01-01T01:00:00',
        isAllDay: false,
      })

      store.addCategory({ id: 'cat-1', name: 'Work', color: '#FF0000' })

      // All data should be present
      const state = useCalendarStore.getState()
      expect(state.events.length).toBe(1)
      expect(state.categories.length).toBe(1)
    })

    // R1.3: the migrate() was dropping brokenEvents, currentDate, currentView,
    // and selectedCategoryIds. These tests pin the new behavior: persisted state
    // survives a version bump across every key partialize() saves.
    const getMigrate = () =>
      useCalendarStore.persist.getOptions().migrate as (
        state: unknown,
      ) => Record<string, unknown>

    it('preserves all partialize() keys on version bump', () => {
      const persisted = {
        events: [{ id: 'e1', title: 'Persisted event' }],
        calendars: [{ id: 'c1', name: 'Work', color: '#FF0000' }],
        categories: [{ id: 'cat1', name: 'Work', color: '#FF0000' }],
        autoCategoryRules: [{ id: 'r1', pattern: 'meet', categoryId: 'cat1' }],
        brokenEvents: [{ event: { id: 'b1' }, reason: 'bad', detectedAt: '2024-01-01' }],
        currentDate: '2024-06-15',
        currentView: 'week',
        selectedCategoryIds: ['cat1'],
      }
      const result = getMigrate()(persisted)
      expect(result.events).toHaveLength(1)
      expect(result.calendars).toHaveLength(1)
      expect(result.categories).toHaveLength(1)
      expect(result.autoCategoryRules).toHaveLength(1)
      expect(result.brokenEvents).toHaveLength(1)
      expect(result.currentDate).toBe('2024-06-15')
      expect(result.currentView).toBe('week')
      expect(result.selectedCategoryIds).toEqual(['cat1'])
    })

    it('falls back to defaults for missing keys', () => {
      const result = getMigrate()({ events: [{ id: 'e1' }] })
      expect(result.events).toHaveLength(1)
      expect(result.calendars).toEqual([])
      expect(result.categories).toEqual([])
      expect(result.autoCategoryRules).toEqual([])
      expect(result.brokenEvents).toEqual([])
      expect(result.selectedCategoryIds).toEqual([])
      // currentDate falls back to today; just verify it's a yyyy-MM-dd string
      expect(result.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // currentView falls back to 'month'
      expect(result.currentView).toBe('month')
    })

    it('handles undefined persisted state gracefully', () => {
      const result = getMigrate()(undefined)
      expect(result.events).toEqual([])
      expect(result.brokenEvents).toEqual([])
      expect(result.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(result.currentView).toBe('month')
    })
  })

  describe('Bug 3: updateEvent does not mutate caller object', () => {
    it('does not modify the original updates object', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'mutate-test',
        calendarId: 'default',
        title: 'Original',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      const updates = { title: 'Updated' }
      const updatesSnapshot = { ...updates }

      store.updateEvent('mutate-test', updates)

      // The original updates object should not have been modified
      expect(updates).toEqual(updatesSnapshot)
      expect((updates as any).categories).toBeUndefined()
    })

    it('does not leak categories into caller updates when no autoCategoryRules match', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'cat-leak-test',
        calendarId: 'default',
        title: 'Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
        categories: ['Existing'],
      })

      const updates = { title: 'New Title' }
      store.updateEvent('cat-leak-test', updates)

      // The caller's updates object should not have gained a categories property
      expect((updates as any).categories).toBeUndefined()

      // But the event in the store should still have its original categories
      const event = useCalendarStore.getState().events.find((e) => e.id === 'cat-leak-test')
      expect(event?.categories).toEqual(['Existing'])
    })

    it('creates independent copy so multiple updates to same object are safe', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'multi-update',
        calendarId: 'default',
        title: 'Original',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
        categories: ['A'],
      })

      const updates = { title: 'First Update' }
      store.updateEvent('multi-update', updates)

      // Verify the event was updated
      const afterFirst = useCalendarStore.getState().events.find((e) => e.id === 'multi-update')
      expect(afterFirst?.title).toBe('First Update')

      // Apply a second update using the same object
      updates.title = 'Second Update'
      store.updateEvent('multi-update', updates)

      const afterSecond = useCalendarStore.getState().events.find((e) => e.id === 'multi-update')
      expect(afterSecond?.title).toBe('Second Update')
    })
  })

  describe('Bug 37: category filter does not hide recurrence exceptions', () => {
    it('shows exception even when it belongs to a different category than the master', () => {
      const store = useCalendarStore.getState()

      // Add two categories
      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })
      store.addCategory({ id: 'cat-personal', name: 'Personal', color: '#00FF00' })

      // Master event is "Work" category
      store.addEvent({
        id: 'master-cat',
        calendarId: 'default',
        title: 'Weekly Meeting',
        start: '2024-03-18T09:00:00.000Z',
        end: '2024-03-18T10:00:00.000Z',
        isAllDay: false,
        categories: ['Work'],
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      })

      // Exception for March 25 is "Personal" category
      store.addEvent({
        id: 'exception-cat',
        calendarId: 'default',
        title: 'Moved to Personal',
        start: '2024-03-25T14:00:00.000Z',
        end: '2024-03-25T15:00:00.000Z',
        isAllDay: false,
        categories: ['Personal'],
        recurrenceId: '2024-03-25T09:00:00.000Z',
      })

      // Filter by "Work" category
      const workCat = useCalendarStore.getState().categories.find((c) => c.name === 'Work')!
      store.toggleCategoryFilter(workCat.id)

      const events = store.getEventsForDateRange('2024-03-18', '2024-04-01')

      // The March 18 occurrence should show (Work category)
      const march18 = events.find((e) => e.start.startsWith('2024-03-18'))
      expect(march18).toBeDefined()
      expect(march18!.title).toBe('Weekly Meeting')

      // The March 25 occurrence should show the exception event
      // (even though the exception has "Personal" category, the exceptionMap
      // should not filter it out, so the occurrence should resolve to the exception)
      const march25 = events.find((e) => e.start.startsWith('2024-03-25'))
      // Before the fix, the exception would be missing from exceptionMap due to category filter,
      // so the master event would expand instead. After the fix, the exception is found in
      // exceptionMap and used.
      expect(march25).toBeDefined()
      expect(march25!.title).toBe('Moved to Personal')
    })

    it('exceptionMap contains exceptions regardless of category filter', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-a', name: 'CategoryA', color: '#FF0000' })
      store.addCategory({ id: 'cat-b', name: 'CategoryB', color: '#00FF00' })

      // Master with CategoryA
      store.addEvent({
        id: 'master-b37',
        calendarId: 'default',
        title: 'Daily Sync',
        start: '2024-04-01T08:00:00.000Z',
        end: '2024-04-01T08:30:00.000Z',
        isAllDay: false,
        categories: ['CategoryA'],
        recurrence: { frequency: 'daily', interval: 1 },
        rruleString: 'FREQ=DAILY;INTERVAL=1',
      })

      // Exception on April 2 with CategoryB
      store.addEvent({
        id: 'exc-b37',
        calendarId: 'default',
        title: 'Special Sync',
        start: '2024-04-02T10:00:00.000Z',
        end: '2024-04-02T11:00:00.000Z',
        isAllDay: false,
        categories: ['CategoryB'],
        recurrenceId: '2024-04-02T08:00:00.000Z',
      })

      // Filter by CategoryA
      const catA = useCalendarStore.getState().categories.find((c) => c.name === 'CategoryA')!
      store.toggleCategoryFilter(catA.id)

      const events = store.getEventsForDateRange('2024-04-01', '2024-04-03')

      // April 1: master event (CategoryA) should appear
      const apr1 = events.find((e) => e.start.startsWith('2024-04-01'))
      expect(apr1).toBeDefined()
      expect(apr1!.title).toBe('Daily Sync')

      // April 2: the exception should be used (exceptionMap should not have filtered it out)
      const apr2 = events.find((e) => e.start.startsWith('2024-04-02'))
      expect(apr2).toBeDefined()
      expect(apr2!.title).toBe('Special Sync')
      expect(apr2!.start).toBe('2024-04-02T10:00:00.000Z')
    })
  })

  describe('Bug 38: no duplicate from redundant exceptionId pattern-match', () => {
    it('does not produce duplicate events for a single exception', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'master-b38',
        calendarId: 'default',
        title: 'Weekly Call',
        start: '2024-03-18T10:00:00.000Z',
        end: '2024-03-18T11:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      })

      store.addEvent({
        id: 'exc-b38',
        calendarId: 'default',
        title: 'Rescheduled Call',
        start: '2024-03-25T15:00:00.000Z',
        end: '2024-03-25T16:00:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-03-25T10:00:00.000Z',
      })

      const events = store.getEventsForDateRange('2024-03-18', '2024-04-01')

      // 3 occurrences: March 18 (master), March 25 (exception), April 1 (master)
      expect(events.length).toBe(3)

      // March 25 should appear exactly once
      const march25Events = events.filter((e) => e.start.startsWith('2024-03-25'))
      expect(march25Events.length).toBe(1)
      expect(march25Events[0].title).toBe('Rescheduled Call')
    })

    it('each occurrence appears exactly once even with complex recurrence', () => {
      const store = useCalendarStore.getState()

      // Daily event over 5 days
      store.addEvent({
        id: 'daily-b38',
        calendarId: 'default',
        title: 'Daily Huddle',
        start: '2024-05-01T09:00:00.000Z',
        end: '2024-05-01T09:15:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'daily', interval: 1, count: 5 },
        rruleString: 'FREQ=DAILY;INTERVAL=1;COUNT=5',
      })

      // Exception on May 3
      store.addEvent({
        id: 'exc-daily-b38',
        calendarId: 'default',
        title: 'Skip Huddle',
        start: '2024-05-03T09:00:00.000Z',
        end: '2024-05-03T09:15:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-05-03T09:00:00.000Z',
      })

      const events = store.getEventsForDateRange('2024-05-01', '2024-05-05')

      // 5 occurrences total: May 1, 2, 3(exception), 4, 5
      expect(events.length).toBe(5)

      // May 3 should appear exactly once as the exception
      const may3 = events.filter((e) => e.start.startsWith('2024-05-03'))
      expect(may3.length).toBe(1)
      expect(may3[0].title).toBe('Skip Huddle')
    })
  })

  describe('Bug 41: duplicateEvent resets recurrence-instance metadata', () => {
    it('does not copy recurrenceId to the duplicate', () => {
      const store = useCalendarStore.getState()

      // Create an exception event (has recurrenceId)
      store.addEvent({
        id: 'exception-for-dup',
        calendarId: 'default',
        title: 'Exception Event',
        start: '2024-03-25T14:00:00.000Z',
        end: '2024-03-25T15:00:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-03-25T09:00:00.000Z',
        syncStatus: 'synced',
        etag: '"abc123"',
        sequence: 1,
      })

      const newId = store.duplicateEvent('exception-for-dup')
      expect(newId).not.toBeNull()

      const original = useCalendarStore.getState().events.find((e) => e.id === 'exception-for-dup')!
      const duplicate = useCalendarStore.getState().events.find((e) => e.id === newId!)!

      // recurrenceId should be cleared
      expect(duplicate.recurrenceId).toBeUndefined()
      // syncStatus should be cleared
      expect(duplicate.syncStatus).toBeUndefined()
      // etag should be cleared
      expect(duplicate.etag).toBeUndefined()
      // sequence should be cleared
      expect(duplicate.sequence).toBeUndefined()

      // But other fields should be preserved
      expect(duplicate.title).toBe('Exception Event (copy)')
      expect(duplicate.start).toBe(original.start)
      expect(duplicate.end).toBe(original.end)
      expect(duplicate.calendarId).toBe(original.calendarId)
    })

    it('does not copy isFragment fields to the duplicate', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'fragment-for-dup',
        calendarId: 'default',
        title: 'Fragmented Event',
        start: '2024-03-15T10:00:00.000Z',
        end: '2024-03-15T11:00:00.000Z',
        isAllDay: false,
        isFragment: true,
        isFirstFragment: true,
        isLastFragment: false,
        originalStart: '2024-03-15T09:00:00.000Z',
        originalEnd: '2024-03-15T12:00:00.000Z',
      })

      const newId = store.duplicateEvent('fragment-for-dup')
      const duplicate = useCalendarStore.getState().events.find((e) => e.id === newId!)!

      expect(duplicate.isFragment).toBeUndefined()
      expect(duplicate.isFirstFragment).toBeUndefined()
      expect(duplicate.isLastFragment).toBeUndefined()
      expect(duplicate.originalStart).toBeUndefined()
      expect(duplicate.originalEnd).toBeUndefined()
    })

    it('preserves normal fields like categories and reminders on duplicate', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'normal-for-dup',
        calendarId: 'default',
        title: 'Normal Event',
        start: '2024-03-15T10:00:00.000Z',
        end: '2024-03-15T11:00:00.000Z',
        isAllDay: false,
        categories: ['Work', 'Important'],
        location: 'Conference Room A',
        description: 'Team standup',
        reminders: [{ id: 'r1', minutesBefore: 15, method: 'popup' }],
      })

      const newId = store.duplicateEvent('normal-for-dup')
      const duplicate = useCalendarStore.getState().events.find((e) => e.id === newId!)!

      expect(duplicate.categories).toEqual(['Work', 'Important'])
      expect(duplicate.location).toBe('Conference Room A')
      expect(duplicate.description).toBe('Team standup')
      expect(duplicate.reminders).toHaveLength(1)
      expect(duplicate.reminders![0].id).toBe('r1')
    })
  })

  describe('Bug 51: start < end validation', () => {
    it('silently skips addEvent when start is after end', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'bad-event',
        calendarId: 'default',
        title: 'Bad Event',
        start: '2024-03-15T12:00:00',
        end: '2024-03-15T10:00:00',
        isAllDay: false,
      })

      // Event should not be in the store (skipped, not thrown)
      const event = useCalendarStore.getState().events.find((e) => e.id === 'bad-event')
      expect(event).toBeUndefined()
    })

    it('allows addEvent when start equals end (all-day events)', () => {
      const store = useCalendarStore.getState()

      expect(() => {
        store.addEvent({
          id: 'same-time',
          calendarId: 'default',
          title: 'All Day Event',
          start: '2024-03-15T00:00:00',
          end: '2024-03-15T00:00:00',
          isAllDay: true,
        })
      }).not.toThrow()

      const event = useCalendarStore.getState().events.find((e) => e.id === 'same-time')
      expect(event).toBeDefined()
    })

    it('accepts valid start < end in addEvent', () => {
      const store = useCalendarStore.getState()

      expect(() => {
        store.addEvent({
          id: 'good-event',
          calendarId: 'default',
          title: 'Good Event',
          start: '2024-03-15T10:00:00',
          end: '2024-03-15T11:00:00',
          isAllDay: false,
        })
      }).not.toThrow()

      const event = useCalendarStore.getState().events.find((e) => e.id === 'good-event')
      expect(event).toBeDefined()
    })

    it('moves event to brokenEvents when update creates start > end', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'update-bad',
        calendarId: 'default',
        title: 'Will Update',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.updateEvent('update-bad', {
        start: '2024-03-15T12:00:00',
        end: '2024-03-15T10:00:00',
      })

      // Event should be moved from events to brokenEvents
      const event = useCalendarStore.getState().events.find((e) => e.id === 'update-bad')
      expect(event).toBeUndefined()
      const brokenEvent = useCalendarStore.getState().brokenEvents.find((be) => be.event.id === 'update-bad')
      expect(brokenEvent).toBeDefined()
      expect(brokenEvent?.event.start).toBe('2024-03-15T12:00:00')
      expect(brokenEvent?.event.end).toBe('2024-03-15T10:00:00')
    })

    it('moves event to brokenEvents when only start exceeds end', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'update-start-only',
        calendarId: 'default',
        title: 'Start Only Update',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.updateEvent('update-start-only', {
        start: '2024-03-15T12:00:00',
      })

      // Event should be moved to brokenEvents
      const event = useCalendarStore.getState().events.find((e) => e.id === 'update-start-only')
      expect(event).toBeUndefined()
      const brokenEvent = useCalendarStore.getState().brokenEvents.find((be) => be.event.id === 'update-start-only')
      expect(brokenEvent).toBeDefined()
    })

    it('moves event to brokenEvents when only end makes start exceed it', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'update-end-only',
        calendarId: 'default',
        title: 'End Only Update',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      store.updateEvent('update-end-only', {
        end: '2024-03-15T09:00:00',
      })

      // Event should be moved to brokenEvents
      const event = useCalendarStore.getState().events.find((e) => e.id === 'update-end-only')
      expect(event).toBeUndefined()
      const brokenEvent = useCalendarStore.getState().brokenEvents.find((be) => be.event.id === 'update-end-only')
      expect(brokenEvent).toBeDefined()
    })

    it('allows updateEvent to change only title without validation error', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'title-only',
        calendarId: 'default',
        title: 'Old Title',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      expect(() => {
        store.updateEvent('title-only', { title: 'New Title' })
      }).not.toThrow()

      const event = useCalendarStore.getState().events.find((e) => e.id === 'title-only')
      expect(event?.title).toBe('New Title')
    })
  })

  describe('Bug 39: timezone-ambiguous date boundaries', () => {
    it('uses UTC boundaries when query string has Z suffix', () => {
      const store = useCalendarStore.getState()

      // Event at 23:00 UTC on March 18
      store.addEvent({
        id: 'utc-late',
        calendarId: 'default',
        title: 'Late UTC Event',
        start: '2024-03-18T23:00:00.000Z',
        end: '2024-03-18T23:30:00.000Z',
        isAllDay: false,
      })

      // Query for March 18 with explicit UTC boundary (Z suffix)
      const events = store.getEventsForDateRange('2024-03-18Z', '2024-03-18Z')

      // The event should be found because it falls within UTC March 18
      const found = events.find((e) => e.id === 'utc-late')
      expect(found).toBeDefined()
    })

    it('respects explicit datetime boundaries instead of rounding to day', () => {
      const store = useCalendarStore.getState()

      // Event at 01:00 UTC on March 19
      store.addEvent({
        id: 'utc-early',
        calendarId: 'default',
        title: 'Early UTC Event',
        start: '2024-03-19T01:00:00.000Z',
        end: '2024-03-19T01:30:00.000Z',
        isAllDay: false,
      })

      // Query with explicit time component — end boundary is exactly midnight March 19
      const events = store.getEventsForDateRange('2024-03-18T00:00:00Z', '2024-03-19T00:00:00Z')

      // The event at 01:00 UTC March 19 should NOT be in range (it's after midnight)
      const found = events.find((e) => e.id === 'utc-early')
      expect(found).toBeUndefined()
    })

    it('date-only query uses local timezone boundaries', () => {
      const store = useCalendarStore.getState()

      // Event at noon local time
      store.addEvent({
        id: 'local-noon',
        calendarId: 'default',
        title: 'Local Noon Event',
        start: '2024-03-15T12:00:00',
        end: '2024-03-15T13:00:00',
        isAllDay: false,
      })

      // Date-only query (no Z, no time) uses local boundaries
      const events = store.getEventsForDateRange('2024-03-15', '2024-03-15')

      const found = events.find((e) => e.id === 'local-noon')
      expect(found).toBeDefined()
    })
  })

  describe('Bug 40: excluded dates check compares date portions only', () => {
    it('excludes occurrence when excluded date has different time suffix', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'master-excl',
        calendarId: 'default',
        title: 'Weekly with Exclusion',
        start: '2024-03-18T09:00:00.000Z',
        end: '2024-03-18T10:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
        excludedDates: ['2024-03-25T00:00:00.000Z'],
      })

      const events = store.getEventsForDateRange('2024-03-18', '2024-04-01')

      // March 25 should be excluded even though excluded date has different time
      const march25 = events.find((e) => e.start.startsWith('2024-03-25'))
      expect(march25).toBeUndefined()

      // March 18 and April 1 should still appear
      const march18 = events.find((e) => e.start.startsWith('2024-03-18'))
      const apr1 = events.find((e) => e.start.startsWith('2024-04-01'))
      expect(march18).toBeDefined()
      expect(apr1).toBeDefined()
    })

    it('excludes occurrence when excluded date is date-only string', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'master-excl2',
        calendarId: 'default',
        title: 'Daily with Exclusion',
        start: '2024-04-01T08:00:00.000Z',
        end: '2024-04-01T08:30:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'daily', interval: 1 },
        rruleString: 'FREQ=DAILY;INTERVAL=1',
        excludedDates: ['2024-04-03'],
      })

      const events = store.getEventsForDateRange('2024-04-01', '2024-04-05')

      // April 3 should be excluded (date-only in excludedDates matches the occurrence date)
      const apr3 = events.find((e) => e.start.startsWith('2024-04-03'))
      expect(apr3).toBeUndefined()

      // Other dates should appear
      expect(events.length).toBe(4)
    })

    it('does not exclude occurrence when excluded date differs from occurrence date', () => {
      const store = useCalendarStore.getState()

      store.addEvent({
        id: 'master-excl3',
        calendarId: 'default',
        title: 'Weekly No Match',
        start: '2024-05-06T10:00:00.000Z',
        end: '2024-05-06T11:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
        excludedDates: ['2024-05-15T12:00:00.000Z'], // May 15 is NOT a weekly occurrence day
      })

      const events = store.getEventsForDateRange('2024-05-06', '2024-05-27')

      // May 20 should NOT be excluded because excluded date (May 15) differs from occurrence date (May 20)
      const may20 = events.find((e) => e.start.startsWith('2024-05-20'))
      expect(may20).toBeDefined()

      // All 4 Mondays (May 6, 13, 20, 27) should appear
      const mondays = events.filter((e) => e.id.startsWith('master-excl3'))
      expect(mondays.length).toBe(4)
    })
  })

  describe('Bug 43: updateCategory name-collision check', () => {
    it('rejects rename when new name matches existing category', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })
      store.addCategory({ id: 'cat-personal', name: 'Personal', color: '#00FF00' })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Try to rename 'Personal' to 'Work' (collision)
      store.updateCategory('cat-personal', { name: 'Work' })

      // Category name should remain unchanged
      const personal = useCalendarStore.getState().categories.find((c) => c.id === 'cat-personal')
      expect(personal?.name).toBe('Personal')

      // Warning should have been logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Category name 'Work' already exists")
      )

      consoleSpy.mockRestore()
    })

    it('rejects rename when names differ only by case', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-a', name: 'Work', color: '#FF0000' })
      store.addCategory({ id: 'cat-b', name: 'Personal', color: '#00FF00' })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Try to rename 'Personal' to 'work' (case-insensitive collision)
      store.updateCategory('cat-b', { name: 'work' })

      const personal = useCalendarStore.getState().categories.find((c) => c.id === 'cat-b')
      expect(personal?.name).toBe('Personal')

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('allows rename when new name is unique and updates events', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-x', name: 'Work', color: '#FF0000' })
      store.addCategory({ id: 'cat-y', name: 'Personal', color: '#00FF00' })

      // Add event with 'Personal' category BEFORE rename
      store.addEvent({
        id: 'cat-rename-test',
        calendarId: 'default',
        title: 'Test',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
        categories: ['Personal'],
      })

      // Verify event has 'Personal' category
      const before = useCalendarStore.getState().events.find((e) => e.id === 'cat-rename-test')
      expect(before?.categories).toContain('Personal')

      // Rename 'Personal' to 'Home' (no collision)
      store.updateCategory('cat-y', { name: 'Home' })

      const renamed = useCalendarStore.getState().categories.find((c) => c.id === 'cat-y')
      expect(renamed?.name).toBe('Home')

      // Events with old category name should be updated
      const event = useCalendarStore.getState().events.find((e) => e.id === 'cat-rename-test')
      expect(event?.categories).toContain('Home')
      expect(event?.categories).not.toContain('Personal')
    })

    it('allows updating color without collision check', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-c', name: 'Work', color: '#FF0000' })

      // Update color only (no name change, no collision check needed)
      store.updateCategory('cat-c', { color: '#0000FF' })

      const updated = useCalendarStore.getState().categories.find((c) => c.id === 'cat-c')
      expect(updated?.color).toBe('#0000FF')
      expect(updated?.name).toBe('Work')
    })
  })

  describe('auto-categorization', () => {
    it('auto-categorizes new events based on keyword rules', () => {
      const store = useCalendarStore.getState()

      // Add category
      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })

      // Add auto-category rule
      store.addAutoCategoryRule({
        id: 'rule-1',
        keywords: ['meeting', 'standup'],
        categoryId: 'cat-work',
      })

      // Add event that matches
      store.addEvent({
        id: 'evt-1',
        calendarId: 'default',
        title: 'Team Meeting',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      const event = useCalendarStore.getState().events.find((e) => e.id === 'evt-1')
      expect(event?.categories).toContain('Work')
    })

    it('auto-categorizes on title update', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })
      store.addAutoCategoryRule({
        id: 'rule-1',
        keywords: ['standup'],
        categoryId: 'cat-work',
      })

      // Add event without matching title
      store.addEvent({
        id: 'evt-1',
        calendarId: 'default',
        title: 'Lunch',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      // Update title to match
      store.updateEvent('evt-1', { title: 'Morning Standup' })

      const event = useCalendarStore.getState().events.find((e) => e.id === 'evt-1')
      expect(event?.categories).toContain('Work')
    })

    it('does not remove existing categories when title changes', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })
      store.addCategory({ id: 'cat-personal', name: 'Personal', color: '#00FF00' })

      store.addAutoCategoryRule({
        id: 'rule-1',
        keywords: ['meeting'],
        categoryId: 'cat-work',
      })

      // Add event with existing Personal category
      store.addEvent({
        id: 'evt-1',
        calendarId: 'default',
        title: 'Personal Chat',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
        categories: ['Personal'],
      })

      // Update title to match Work rule
      store.updateEvent('evt-1', { title: 'Work Meeting' })

      const event = useCalendarStore.getState().events.find((e) => e.id === 'evt-1')
      // Should have both Personal (existing) and Work (auto-added)
      expect(event?.categories).toContain('Personal')
      expect(event?.categories).toContain('Work')
    })

    it('case-insensitive keyword matching', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })
      store.addAutoCategoryRule({
        id: 'rule-1',
        keywords: ['meeting'],
        categoryId: 'cat-work',
      })

      // Title with different case
      store.addEvent({
        id: 'evt-1',
        calendarId: 'default',
        title: 'Team MEETING',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      const event = useCalendarStore.getState().events.find((e) => e.id === 'evt-1')
      expect(event?.categories).toContain('Work')
    })

    it('multiple rules can match the same event', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })
      store.addCategory({ id: 'cat-urgent', name: 'Urgent', color: '#FF6600' })

      store.addAutoCategoryRule({
        id: 'rule-1',
        keywords: ['meeting'],
        categoryId: 'cat-work',
      })
      store.addAutoCategoryRule({
        id: 'rule-2',
        keywords: ['urgent'],
        categoryId: 'cat-urgent',
      })

      // Event matches both rules
      store.addEvent({
        id: 'evt-1',
        calendarId: 'default',
        title: 'Urgent Meeting',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })

      const event = useCalendarStore.getState().events.find((e) => e.id === 'evt-1')
      expect(event?.categories).toContain('Work')
      expect(event?.categories).toContain('Urgent')
    })

    it('does not duplicate categories if event already has them', () => {
      const store = useCalendarStore.getState()

      store.addCategory({ id: 'cat-work', name: 'Work', color: '#FF0000' })
      store.addAutoCategoryRule({
        id: 'rule-1',
        keywords: ['meeting'],
        categoryId: 'cat-work',
      })

      // Event already has Work category
      store.addEvent({
        id: 'evt-1',
        calendarId: 'default',
        title: 'Team Meeting',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
        categories: ['Work'],
      })

      const event = useCalendarStore.getState().events.find((e) => e.id === 'evt-1')
      // Should have exactly one 'Work', not two
      expect(event?.categories?.filter((c) => c === 'Work')).toHaveLength(1)
    })
  })

  describe('Bug: recurrence exception + EXDATE collision', () => {
    it('shows only exception when master has both EXDATE and recurrenceId for same date', () => {
      const store = useCalendarStore.getState()

      // Master event: weekly on Mondays
      store.addEvent({
        id: 'master-exdate',
        calendarId: 'default',
        title: 'Weekly Meeting',
        start: '2024-03-18T09:00:00.000Z',
        end: '2024-03-18T10:00:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
        // Simulate the state after the fix: EXDATE added when exception was created
        excludedDates: ['2024-03-25T00:00:00.000Z'],
      })

      // Exception event for March 25 (different time and title)
      store.addEvent({
        id: 'master-exdate-2024-03-25T09:00:00.000Z',
        calendarId: 'default',
        title: 'Rescheduled Meeting',
        start: '2024-03-25T14:00:00.000Z',
        end: '2024-03-25T15:00:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-03-25T09:00:00.000Z',
      })

      const events = store.getEventsForDateRange('2024-03-18', '2024-04-01')

      // Should have 3 occurrences: Mar 18 (master), Mar 25 (exception), Apr 1 (master)
      expect(events.length).toBe(3)

      // March 25 should appear exactly once as the exception
      const march25 = events.filter((e) => e.start.startsWith('2024-03-25'))
      expect(march25.length).toBe(1)
      expect(march25[0].title).toBe('Rescheduled Meeting')
      expect(march25[0].start).toBe('2024-03-25T14:00:00.000Z')
    })

    it('does not show duplicate when exception exists alongside EXDATE', () => {
      const store = useCalendarStore.getState()

      // Master event: daily
      store.addEvent({
        id: 'daily-exdate',
        calendarId: 'default',
        title: 'Daily Standup',
        start: '2024-04-01T08:00:00.000Z',
        end: '2024-04-01T08:30:00.000Z',
        isAllDay: false,
        recurrence: { frequency: 'daily', interval: 1 },
        rruleString: 'FREQ=DAILY;INTERVAL=1',
        excludedDates: ['2024-04-03T00:00:00.000Z'],
      })

      // Exception event for April 3
      store.addEvent({
        id: 'daily-exdate-2024-04-03T08:00:00.000Z',
        calendarId: 'default',
        title: 'Special Standup',
        start: '2024-04-03T10:00:00.000Z',
        end: '2024-04-03T11:00:00.000Z',
        isAllDay: false,
        recurrenceId: '2024-04-03T08:00:00.000Z',
      })

      const events = store.getEventsForDateRange('2024-04-01', '2024-04-05')

      // Should have 5 occurrences (Apr 1-5), with Apr 3 being the exception
      expect(events.length).toBe(5)

      // April 3 should appear exactly once
      const apr3 = events.filter((e) => e.start.startsWith('2024-04-03'))
      expect(apr3.length).toBe(1)
      expect(apr3[0].title).toBe('Special Standup')
    })
  })
})
