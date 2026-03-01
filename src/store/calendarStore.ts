import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import { RRule } from 'rrule'
import type { CalendarStore, CalendarEvent, Calendar, ViewType } from '@/types'

const DEFAULT_CALENDAR: Calendar = {
  id: 'default',
  name: 'My Calendar',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
}

export const useCalendarStore = create<CalendarStore>()(
  persist(
    (set, get) => ({
      events: [],
      calendars: [DEFAULT_CALENDAR],
      currentDate: format(new Date(), 'yyyy-MM-dd'),
      currentView: 'month',
      selectedEventId: null,
      isModalOpen: false,
      selectedDate: null,
      selectedEndDate: null,

      addEvent: (event: CalendarEvent): void => {
        set((state) => ({
          events: [...state.events, event],
        }))
      },

      updateEvent: (id: string, updates: Partial<CalendarEvent>): void => {
        set((state) => ({
          events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        }))
      },

      deleteEvent: (id: string): void => {
        set((state) => ({
          events: state.events.filter((e) => e.id !== id),
        }))
      },

      duplicateEvent: (id: string): string | null => {
        const state = get()
        const eventToDuplicate = state.events.find((e) => e.id === id)
        if (!eventToDuplicate) return null

        const startDate = parseISO(eventToDuplicate.start)
        const endDate = parseISO(eventToDuplicate.end)
        const durationMs = endDate.getTime() - startDate.getTime()

        const newStart = new Date(startDate.getTime() + durationMs)
        const newEnd = new Date(newStart.getTime() + durationMs)

        const newEvent: CalendarEvent = {
          ...eventToDuplicate,
          id: crypto.randomUUID(),
          title: `${eventToDuplicate.title} (copy)`,
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        }

        set((state) => ({
          events: [...state.events, newEvent],
        }))

        return newEvent.id
      },

      addCalendar: (calendar: Calendar): void => {
        set((state) => ({
          calendars: [...state.calendars, calendar],
        }))
      },

      updateCalendar: (id: string, updates: Partial<Calendar>): void => {
        set((state) => ({
          calendars: state.calendars.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }))
      },

      deleteCalendar: (id: string): void => {
        set((state) => ({
          calendars: state.calendars.filter((c) => c.id !== id),
          events: state.events.filter((e) => e.calendarId !== id),
        }))
      },

      toggleCalendarVisibility: (id: string): void => {
        set((state) => ({
          calendars: state.calendars.map((c) =>
            c.id === id ? { ...c, isVisible: !c.isVisible } : c
          ),
        }))
      },

      setDefaultCalendar: (id: string): void => {
        set((state) => ({
          calendars: state.calendars.map((c) => ({
            ...c,
            isDefault: c.id === id,
          })),
        }))
      },

      setCurrentDate: (date: string): void => {
        set({ currentDate: date })
      },

      setCurrentView: (view: ViewType): void => {
        set({ currentView: view })
      },

      setSelectedEventId: (id: string | null): void => {
        set({ selectedEventId: id })
      },

      openModal: (date?: string, endDate?: string, eventId?: string): void => {
        set({
          isModalOpen: true,
          selectedEventId: eventId ?? null,
          selectedDate: date ?? null,
          selectedEndDate: endDate ?? null,
        })
      },

      closeModal: (): void => {
        set({
          isModalOpen: false,
          selectedEventId: null,
          selectedDate: null,
          selectedEndDate: null,
        })
      },

      getEventsForDateRange: (start: string, end: string): CalendarEvent[] => {
        const state = get()
        const visibleCalendarIds = state.calendars.filter((c) => c.isVisible).map((c) => c.id)

        const startDate = startOfDay(parseISO(start))
        const endDate = endOfDay(parseISO(end))
        const expandedEvents: CalendarEvent[] = []

        for (const event of state.events) {
          if (!visibleCalendarIds.includes(event.calendarId)) {
            continue
          }

          const hasRecurrence = event.rruleString || event.recurrence

          if (hasRecurrence) {
            let rruleString = event.rruleString

            if (!rruleString && event.recurrence) {
              const freqMap: Record<string, string> = {
                daily: 'DAILY',
                weekly: 'WEEKLY',
                monthly: 'MONTHLY',
                yearly: 'YEARLY',
              }
              const freq = freqMap[event.recurrence.frequency] || 'WEEKLY'
              rruleString = `FREQ=${freq};INTERVAL=${event.recurrence.interval || 1}`
            }

            try {
              if (!rruleString) {
                throw new Error('No rrule string')
              }
              const options = RRule.parseString(rruleString)
              const eventStart = parseISO(event.start)

              const rule = new RRule({
                ...options,
                dtstart: eventStart,
              })

              const occurrences = rule.between(startDate, endDate, true)

              for (const occ of occurrences) {
                const duration = parseISO(event.end).getTime() - eventStart.getTime()
                const occEnd = new Date(occ.getTime() + duration)

                expandedEvents.push({
                  ...event,
                  id: `${event.id}-${occ.toISOString()}`,
                  start: occ.toISOString(),
                  end: occEnd.toISOString(),
                })
              }
            } catch {
              const eventStart = parseISO(event.start)
              const eventEnd = parseISO(event.end)
              if (
                isWithinInterval(eventStart, { start: startDate, end: endDate }) ||
                isWithinInterval(eventEnd, { start: startDate, end: endDate }) ||
                (eventStart <= startDate && eventEnd >= endDate)
              ) {
                expandedEvents.push(event)
              }
            }
          } else {
            const eventStart = parseISO(event.start)
            const eventEnd = parseISO(event.end)

            if (
              isWithinInterval(eventStart, { start: startDate, end: endDate }) ||
              isWithinInterval(eventEnd, { start: startDate, end: endDate }) ||
              (eventStart <= startDate && eventEnd >= endDate)
            ) {
              expandedEvents.push(event)
            }
          }
        }

        return expandedEvents
      },

      getVisibleEvents: (): CalendarEvent[] => {
        const state = get()
        const visibleCalendarIds = state.calendars.filter((c) => c.isVisible).map((c) => c.id)

        return state.events.filter((event) => visibleCalendarIds.includes(event.calendarId))
      },
    }),
    {
      name: 'goodcal-storage',
      partialize: (state) => ({
        events: state.events,
        calendars: state.calendars,
      }),
    }
  )
)
