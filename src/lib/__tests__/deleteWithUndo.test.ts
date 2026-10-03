import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CalendarEvent } from '@/types'
import { deleteEventWithUndo } from '../deleteWithUndo'

const messages: string[] = []
let undo: (() => void) | undefined

vi.mock('../toast', () => ({
  showToast: (message: string, options?: { onUndo?: () => void }) => {
    messages.push(message)
    undo = options?.onUndo
  },
}))

vi.mock('../i18n', () => ({
  default: { t: (key: string) => key },
}))

function makeEvent(type?: CalendarEvent['type'], calendarId = 'default'): CalendarEvent {
  return { id: 'item-1', calendarId, type } as CalendarEvent
}

describe('deleteEventWithUndo toast', () => {
  beforeEach(() => {
    messages.length = 0
    undo = undefined
  })

  it.each([
    [undefined, 'errors:undo.eventDeleted'],
    ['event', 'errors:undo.eventDeleted'],
    ['task', 'errors:undo.taskDeleted'],
    ['journal', 'errors:undo.journalDeleted'],
  ] as const)('uses the right message for type %s', (type, expected) => {
    deleteEventWithUndo({ event: makeEvent(type), deleteEvent: vi.fn(), addEvent: vi.fn() })
    expect(messages).toEqual([expected])
  })

  it.each([
    [undefined, 'errors:sync.eventRestoreFailed'],
    ['task', 'errors:sync.taskRestoreFailed'],
    ['journal', 'errors:sync.journalRestoreFailed'],
  ] as const)('uses the right restore-failure message for type %s', async (type, expected) => {
    deleteEventWithUndo({
      event: makeEvent(type, 'cal-1'),
      deleteEvent: vi.fn(),
      addEvent: vi.fn(),
      createCalDAVEvent: vi.fn().mockRejectedValue(new Error('offline')),
      deleteCalDAVEvent: vi.fn().mockResolvedValue(undefined),
    })
    undo?.()
    await vi.waitFor(() => expect(messages).toContain(expected))
  })
})
