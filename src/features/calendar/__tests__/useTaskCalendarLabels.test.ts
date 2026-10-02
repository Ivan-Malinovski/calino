import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Calendar } from '@/types'
import { useTaskCalendarLabels } from '../hooks/useTaskCalendarLabels'

const calendars: Calendar[] = [
  {
    id: 'work',
    name: 'Work',
    color: '#4285F4',
    isVisible: true,
    isDefault: true,
    showTasksInViews: true,
    supportedComponents: ['VTODO'],
  },
  {
    id: 'home',
    name: 'Home',
    color: '#E8710A',
    isVisible: true,
    isDefault: false,
    showTasksInViews: true,
  },
  {
    id: 'events',
    name: 'Events only',
    color: '#123456',
    isVisible: true,
    isDefault: false,
    showTasksInViews: true,
    supportedComponents: ['VEVENT'],
  },
]

describe('useTaskCalendarLabels', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings()
    useCalendarStore.setState({ calendars, events: [] })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.getState().resetSettings()
  })

  it('changes only the preference for the current task surface', () => {
    const { result } = renderHook(() => ({
      tasks: useTaskCalendarLabels('tasks'),
      sidebar: useTaskCalendarLabels('sidebar'),
    }))
    expect(result.current.tasks.labelsVisible).toBe(true)
    expect(result.current.sidebar.labelsVisible).toBe(true)
    act(() => useSettingsStore.getState().updateSettings({ showSidebarTaskCalendarLabels: false }))
    expect(result.current.sidebar.showLabels).toBe(false)
    expect(result.current.sidebar.labelsVisible).toBe(false)
    expect(result.current.tasks.labelsVisible).toBe(true)
    act(() => useSettingsStore.getState().updateSettings({ showTaskCalendarLabels: false }))
    expect(result.current.tasks.labelsVisible).toBe(false)
    act(() => useSettingsStore.getState().updateSettings({ showSidebarTaskCalendarLabels: true }))
    expect(result.current.sidebar.labelsVisible).toBe(true)
    expect(result.current.tasks.labelsVisible).toBe(false)
  })

  it('suppresses labels without overwriting either saved preference', () => {
    useSettingsStore.getState().updateSettings({ showSidebarTaskCalendarLabels: false })
    const { result } = renderHook(() => ({
      tasks: useTaskCalendarLabels('tasks'),
      sidebar: useTaskCalendarLabels('sidebar'),
    }))
    expect(result.current.tasks.enabledTaskCalendarCount).toBe(2)
    act(() =>
      useCalendarStore.setState({
        calendars: calendars.map((calendar) => ({
          ...calendar,
          isVisible: calendar.id !== 'home',
        })),
      })
    )
    expect(result.current.tasks.enabledTaskCalendarCount).toBe(1)
    expect(result.current.tasks.labelsVisible).toBe(false)
    expect(result.current.tasks.showLabels).toBe(true)
    expect(result.current.sidebar.showLabels).toBe(false)
    act(() => useCalendarStore.setState({ calendars }))
    expect(result.current.tasks.labelsVisible).toBe(true)
    expect(result.current.sidebar.labelsVisible).toBe(false)
  })

  it('reads current calendar names and colors without filtering by task contents', () => {
    const { result } = renderHook(() => useTaskCalendarLabels('tasks'))
    expect(result.current.enabledTaskCalendarCount).toBe(2)
    act(() =>
      useCalendarStore.setState({
        calendars: calendars.map((calendar) =>
          calendar.id === 'work' ? { ...calendar, name: 'Renamed', color: '#abcdef' } : calendar
        ),
      })
    )
    expect(result.current.calendarById.get('work')?.name).toBe('Renamed')
    expect(result.current.calendarById.get('work')?.color).toBe('#abcdef')
  })
})
