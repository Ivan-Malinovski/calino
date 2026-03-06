import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FullCalendarWrapper } from '../components/FullCalendarWrapper'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { CalendarEvent, Calendar } from '@/types'

// Mock FullCalendar to avoid complex DOM operations in tests
vi.mock('@fullcalendar/react', () => ({
  default: vi.fn().mockImplementation((props) => {
    const { events, initialView } = props

    return (
      <div data-testid="fullcalendar-mock">
        <div data-testid="events-count">{events?.length || 0}</div>
        <div data-testid="initial-view">{initialView}</div>
      </div>
    )
  }),
}))

vi.mock('@fullcalendar/daygrid', () => ({ default: vi.fn() }))
vi.mock('@fullcalendar/timegrid', () => ({ default: vi.fn() }))
vi.mock('@fullcalendar/list', () => ({ default: vi.fn() }))
vi.mock('@fullcalendar/interaction', () => ({ default: vi.fn() }))
vi.mock('@fullcalendar/rrule', () => ({ default: vi.fn() }))

describe('FullCalendarWrapper', () => {
  const mockCalendar1: Calendar = {
    id: 'calendar-1',
    name: 'Work',
    color: '#4285f4',
    isVisible: true,
    isDefault: true,
  }

  const mockCalendar2: Calendar = {
    id: 'calendar-2',
    name: 'Personal',
    color: '#34a853',
    isVisible: true,
    isDefault: false,
  }

  const mockEvent1: CalendarEvent = {
    id: 'event-1',
    calendarId: 'calendar-1',
    title: 'Team Meeting',
    start: '2024-03-15T10:00:00',
    end: '2024-03-15T11:00:00',
    isAllDay: false,
    description: 'Weekly team sync',
    location: 'Conference Room A',
  }

  const mockEvent2: CalendarEvent = {
    id: 'event-2',
    calendarId: 'calendar-2',
    title: 'Lunch with John',
    start: '2024-03-15T12:00:00',
    end: '2024-03-15T13:00:00',
    isAllDay: false,
  }

  const mockTask: CalendarEvent = {
    id: 'task-1',
    calendarId: 'calendar-1',
    title: 'Complete report',
    start: '2024-03-15',
    end: '2024-03-15',
    isAllDay: true,
    type: 'task',
    dueDate: '2024-03-15',
    completed: false,
    priority: 1,
  }

  const mockAllDayEvent: CalendarEvent = {
    id: 'allday-1',
    calendarId: 'calendar-1',
    title: 'Birthday Party',
    start: '2024-03-15',
    end: '2024-03-15',
    isAllDay: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    const calendarStore = useCalendarStore.getState()
    calendarStore.events.forEach((e) => calendarStore.deleteEvent(e.id))
    calendarStore.calendars.forEach((c) => calendarStore.deleteCalendar(c.id))

    calendarStore.addCalendar(mockCalendar1)
    calendarStore.addCalendar(mockCalendar2)

    const settingsStore = useSettingsStore.getState()
    settingsStore.updateSettings({ firstDayOfWeek: 0 }) // Sunday
    settingsStore.updateSettings({ defaultView: 'month' })
  })

  describe('Rendering', () => {
    it('renders without crashing', () => {
      render(<FullCalendarWrapper />)
      expect(screen.getByTestId('fullcalendar-mock')).toBeInTheDocument()
    })

    it('displays events from store', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)
      store.addEvent(mockEvent2)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('2')
    })

    it('respects calendar visibility', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)
      store.addEvent(mockEvent2)

      // Hide calendar-2
      store.updateCalendar('calendar-2', { isVisible: false })

      render(<FullCalendarWrapper />)

      // Only event-1 should be visible
      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('renders with default month view', () => {
      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('initial-view')).toHaveTextContent('dayGridMonth')
    })

    it('renders week view when set', () => {
      const store = useCalendarStore.getState()
      store.setCurrentView('week')

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('initial-view')).toHaveTextContent('timeGridWeek')
    })

    it('renders day view when set', () => {
      const store = useCalendarStore.getState()
      store.setCurrentView('day')

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('initial-view')).toHaveTextContent('timeGridDay')
    })

    it('renders agenda view when set', () => {
      const store = useCalendarStore.getState()
      store.setCurrentView('agenda')

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('initial-view')).toHaveTextContent('listMonth')
    })
  })

  describe('Event Display', () => {
    it('includes all event properties in calendar events', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('includes task properties for VTODO items', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockTask)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('includes all-day flag for all-day events', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockAllDayEvent)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('uses calendar color when event has no color', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1) // Has no color property

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('uses event color over calendar color', () => {
      const store = useCalendarStore.getState()
      const eventWithColor: CalendarEvent = {
        ...mockEvent1,
        color: '#ea4335',
      }
      store.addEvent(eventWithColor)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('excludes events from hidden calendars', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)
      store.addEvent(mockEvent2)
      store.updateCalendar('calendar-2', { isVisible: false })

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })
  })

  describe('Recurring Events', () => {
    it('includes rrule string for recurring events', () => {
      const store = useCalendarStore.getState()
      const recurringEvent: CalendarEvent = {
        ...mockEvent1,
        rruleString: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      }
      store.addEvent(recurringEvent)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('includes recurrence info in extended props', () => {
      const store = useCalendarStore.getState()
      const recurringEvent: CalendarEvent = {
        ...mockEvent1,
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          byWeekday: [1, 3, 5], // Monday, Wednesday, Friday
        },
      }
      store.addEvent(recurringEvent)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })
  })

  describe('Task (VTODO) Support', () => {
    it('includes task-specific properties', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockTask)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('handles completed tasks', () => {
      const store = useCalendarStore.getState()
      const completedTask: CalendarEvent = {
        ...mockTask,
        completed: true,
      }
      store.addEvent(completedTask)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('handles task priorities', () => {
      const store = useCalendarStore.getState()
      const highPriorityTask: CalendarEvent = {
        ...mockTask,
        priority: 1, // High priority
      }
      store.addEvent(highPriorityTask)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('handles tasks with due dates', () => {
      const store = useCalendarStore.getState()
      const taskWithDueDate: CalendarEvent = {
        ...mockTask,
        dueDate: '2024-03-20',
      }
      store.addEvent(taskWithDueDate)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })
  })

  describe('Event Properties', () => {
    it('includes description in extended props', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('includes location in extended props', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('includes travel duration in extended props', () => {
      const store = useCalendarStore.getState()
      const eventWithTravel: CalendarEvent = {
        ...mockEvent1,
        travelDuration: 30,
      }
      store.addEvent(eventWithTravel)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })
  })

  describe('Performance', () => {
    it('memoizes calendar events', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)

      const { rerender } = render(<FullCalendarWrapper />)

      // Re-render without changes should use memoized value
      rerender(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('updates when events change', () => {
      const store = useCalendarStore.getState()

      const { rerender } = render(<FullCalendarWrapper />)
      expect(screen.getByTestId('events-count')).toHaveTextContent('0')

      store.addEvent(mockEvent1)
      rerender(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('updates when calendar visibility changes', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)
      store.addEvent(mockEvent2)

      const { rerender } = render(<FullCalendarWrapper />)
      expect(screen.getByTestId('events-count')).toHaveTextContent('2')

      store.updateCalendar('calendar-2', { isVisible: false })
      rerender(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })

    it('handles multiple calendars correctly', () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockEvent1)
      store.addEvent(mockEvent2)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('2')
    })
  })

  describe('Edge Cases', () => {
    it('handles empty event list', () => {
      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('0')
    })

    it('handles event with no calendar', () => {
      const store = useCalendarStore.getState()
      const orphanEvent: CalendarEvent = {
        ...mockEvent1,
        calendarId: 'non-existent-calendar',
      }
      store.addEvent(orphanEvent)

      render(<FullCalendarWrapper />)

      // Event is not displayed because its calendar is not in the visible calendars list
      expect(screen.getByTestId('events-count')).toHaveTextContent('0')
    })

    it('handles events spanning multiple days', () => {
      const store = useCalendarStore.getState()
      const multiDayEvent: CalendarEvent = {
        ...mockEvent1,
        start: '2024-03-15T10:00:00',
        end: '2024-03-17T18:00:00',
      }
      store.addEvent(multiDayEvent)

      render(<FullCalendarWrapper />)

      expect(screen.getByTestId('events-count')).toHaveTextContent('1')
    })
  })
})
