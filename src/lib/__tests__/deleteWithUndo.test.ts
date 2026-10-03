import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CalendarEvent } from '@/types'
import { deleteEventWithUndo } from '../deleteWithUndo'

const messages: string[] = []

vi.mock('../toast', () => ({
  showToast: (message: string) => {
    messages.push(message)
  },
}))

vi.mock('../i18n', () => ({
  default: { t: (key: string) => key },
}))

function makeEvent(type?: CalendarEvent['type']): CalendarEvent {
  return { id: 'item-1', calendarId: 'default', type } as CalendarEvent
}

describe('deleteEventWithUndo toast', () => {
  beforeEach(() => {
    messages.length = 0
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
})
