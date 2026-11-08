import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCalendarStore } from '@/store/calendarStore'
import { offerRollingCompletion, resetRollingPromptSession } from '@/lib/rollingCompletionPrompt'
import { makeRecurringTask } from '@/lib/__tests__/fixtures'
import type { Calendar, CalendarEvent } from '@/types'

const showToast = vi.fn()
vi.mock('@/lib/toast', () => ({ showToast: (...args: unknown[]) => showToast(...args) }))

const TASKS_ORG = '+//IDN tasks.org//android-151202//EN'

function calendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: 'list',
    name: 'Chores',
    color: '#4285F4',
    isVisible: true,
    isDefault: true,
    showTasksInViews: true,
    ...overrides,
  } as Calendar
}

function task(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', {
    id: 'chore',
    uid: 'chore',
    calendarId: 'list',
    title: 'Water plants',
    start: '2026-03-03T00:00:00',
    end: '2026-03-03T23:59:59',
    dueDate: '2026-03-03',
    clientProdid: TASKS_ORG,
    ...overrides,
  })
}

/** The options passed to the one toast shown. */
function toastOptions(): {
  id: string
  onLinkClick: () => void
  onCancelClick: () => void
} {
  expect(showToast).toHaveBeenCalledTimes(1)
  return showToast.mock.calls[0]![1]
}

describe('R2.8 rolling completion prompt', () => {
  beforeEach(() => {
    showToast.mockClear()
    resetRollingPromptSession()
    useCalendarStore.setState({ calendars: [calendar()], events: [task()] })
  })

  it('offers rolling mode for a list edited by Tasks.org, without switching', () => {
    offerRollingCompletion(task())

    expect(showToast.mock.calls[0]![0]).toContain('Tasks.org')
    expect(toastOptions().id).toBe('rolling-prompt-list')
    // Asking is all it does.
    expect(useCalendarStore.getState().calendars[0]!.taskCompletionMode).toBeUndefined()
  })

  it('switches the calendar to rolling only when the user accepts', () => {
    offerRollingCompletion(task())
    toastOptions().onLinkClick()

    expect(useCalendarStore.getState().calendars[0]!.taskCompletionMode).toBe('rolling')
  })

  it('remembers "Not now" on the calendar and does not ask again', () => {
    offerRollingCompletion(task())
    toastOptions().onCancelClick()
    const after = useCalendarStore.getState().calendars[0]!
    expect(after.rollingPromptDismissed).toBe(true)
    expect(after.taskCompletionMode).toBeUndefined()

    resetRollingPromptSession()
    showToast.mockClear()
    offerRollingCompletion(task())
    expect(showToast).not.toHaveBeenCalled()
  })

  it('asks at most once per calendar per session', () => {
    offerRollingCompletion(task())
    offerRollingCompletion(task())
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it('uses the hint from any task in the list when the completed one has none', () => {
    useCalendarStore.setState({
      events: [task({ id: 'other', uid: 'other' }), task({ clientProdid: undefined })],
    })
    offerRollingCompletion(task({ clientProdid: undefined }))
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it('stays quiet for lists with no override-hostile client', () => {
    useCalendarStore.setState({ events: [task({ clientProdid: '-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN' })] })
    offerRollingCompletion(task({ clientProdid: '-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN' }))
    expect(showToast).not.toHaveBeenCalled()
  })

  it('stays quiet when the list is already rolling or read-only', () => {
    useCalendarStore.setState({ calendars: [calendar({ taskCompletionMode: 'rolling' })] })
    offerRollingCompletion(task())
    useCalendarStore.setState({ calendars: [calendar({ readOnly: true })] })
    offerRollingCompletion(task())
    expect(showToast).not.toHaveBeenCalled()
  })
})
