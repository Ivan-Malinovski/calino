import { useMemo } from 'react'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'

export function useTaskCalendarLabels(surface: 'tasks' | 'sidebar') {
  const calendars = useCalendarStore((state) => state.calendars)
  const preferenceKey =
    surface === 'sidebar' ? 'showSidebarTaskCalendarLabels' : 'showTaskCalendarLabels'
  const showLabels = useSettingsStore((state) => state[preferenceKey])
  const calendarById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars]
  )
  const taskCalendars = useMemo(
    () =>
      calendars.filter(
        (calendar) =>
          calendar.isVisible &&
          (!calendar.supportedComponents || calendar.supportedComponents.includes('VTODO'))
      ),
    [calendars]
  )
  const enabledTaskCalendarCount = taskCalendars.length

  return {
    calendarById,
    taskCalendars,
    enabledTaskCalendarCount,
    showLabels,
    labelsVisible: enabledTaskCalendarCount > 1 && showLabels,
  }
}
