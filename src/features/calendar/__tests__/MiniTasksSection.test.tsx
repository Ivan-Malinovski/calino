import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { MiniTasksSection } from '../components/MiniTasksSection'

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({ updateEvent: vi.fn(), saveRecurrenceOverride: vi.fn() }),
}))

vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }))

function renderTasks() {
  const view = render(
    <BrowserRouter>
      <MiniTasksSection isExpanded onToggle={vi.fn()} />
    </BrowserRouter>
  )
  const row = (id: string) => view.container.querySelector(`[data-mini-task-id="${id}"]`)!
  const label = (id: string) => row(id).querySelector('[data-component="task-calendar-label"]')
  return { ...view, row, label }
}

describe('MiniTasksSection calendar reveal', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings()
    useCalendarStore.setState({
      calendars: [
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
      ],
      events: [
        {
          id: 'work-task',
          title: 'Prepare trip',
          calendarId: 'work',
          type: 'task',
          start: '2026-10-02',
          end: '2026-10-02',
          isAllDay: true,
          description: 'Keep the packing list',
          completed: false,
        },
        {
          id: 'home-task',
          title: 'Water plants',
          calendarId: 'home',
          type: 'task',
          start: '2026-10-02',
          end: '2026-10-02',
          isAllDay: true,
          completed: false,
        },
      ],
    })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.getState().resetSettings()
  })

  it('keeps labels hidden at rest and reveals only the hovered task', async () => {
    const { row, label } = renderTasks()
    expect(label('work-task')).toBeNull()
    expect(label('home-task')).toBeNull()
    expect(screen.queryByText('Try labels:')).not.toBeInTheDocument()
    fireEvent.mouseEnter(row('work-task'))
    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(label('home-task')).toBeNull()
    expect(row('work-task').querySelector('[data-component="task-due-date"]')).toBeInTheDocument()
    expect(screen.getByText('Keep the packing list')).toBeInTheDocument()
    fireEvent.mouseLeave(row('work-task'))
    await waitFor(() => expect(label('work-task')).toBeNull())
  })

  it('reveals on keyboard focus and retains the label while focus stays within the row', async () => {
    const { row, label } = renderTasks()
    const check = row('work-task').querySelector('[data-component="mini-task-checkbox"]')!
    const content = row('work-task').querySelector('button[type="button"]')!
    fireEvent.focus(check)
    expect(await screen.findByText('Work')).toBeInTheDocument()
    fireEvent.blur(check, { relatedTarget: content })
    fireEvent.focus(content)
    expect(label('work-task')).toHaveTextContent('Work')
    fireEvent.blur(content, {
      relatedTarget: screen.getByRole('button', { expanded: true }),
    })
    await waitFor(() => expect(label('work-task')).toBeNull())
  })

  it('toggles only the sidebar reveal and leaves task titles and dates intact', async () => {
    const { row, label } = renderTasks()
    fireEvent.mouseEnter(row('work-task'))
    expect(await screen.findByText('Work')).toBeInTheDocument()
    act(() => useSettingsStore.getState().updateSettings({ showSidebarTaskCalendarLabels: false }))
    await waitFor(() => expect(label('work-task')).toBeNull())
    expect(useSettingsStore.getState().showSidebarTaskCalendarLabels).toBe(false)
    expect(useSettingsStore.getState().showTaskCalendarLabels).toBe(true)
    expect(screen.getByText('Prepare trip')).toBeInTheDocument()
    expect(row('work-task').querySelector('[data-component="task-due-date"]')).toBeInTheDocument()
    act(() => useSettingsStore.getState().updateSettings({ showSidebarTaskCalendarLabels: true }))
    expect(await screen.findByText('Work')).toBeInTheDocument()
  })

  it('suppresses the reveal for a single enabled calendar without overwriting the preference', async () => {
    const { row, label } = renderTasks()
    fireEvent.mouseEnter(row('work-task'))
    expect(await screen.findByText('Work')).toBeInTheDocument()
    act(() => useCalendarStore.getState().toggleCalendarVisibility('home'))
    await waitFor(() => expect(label('work-task')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Show calendar labels' })).not.toBeInTheDocument()
    expect(useSettingsStore.getState().showSidebarTaskCalendarLabels).toBe(true)
  })
})
