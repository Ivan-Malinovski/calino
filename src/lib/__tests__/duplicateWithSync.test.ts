import { describe, it, expect, vi, beforeEach } from 'vitest'
import { duplicateEventWithSync } from '../duplicateWithSync'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent } from '@/types'

const baseEvent: CalendarEvent = {
  id: 'original-1',
  title: 'Standup',
  start: '2026-08-11T09:00:00.000Z',
  end: '2026-08-11T09:30:00.000Z',
  calendarId: 'work',
  type: 'event',
  isAllDay: false,
}

describe('duplicateEventWithSync', () => {
  beforeEach(() => {
    useCalendarStore.setState({ events: [baseEvent] })
  })

  it('pushes the copy to CalDAV', () => {
    const createCalDAVEvent = vi.fn().mockResolvedValue(undefined)
    const newId = duplicateEventWithSync({ eventId: 'original-1', createCalDAVEvent })

    expect(newId).toBeTruthy()
    expect(createCalDAVEvent).toHaveBeenCalledTimes(1)
    const [calendarId, pushed] = createCalDAVEvent.mock.calls[0]
    expect(calendarId).toBe('work')
    expect(pushed.id).toBe(newId)
    expect(pushed.title).toBe('Standup (copy)')
  })

  it('pushes the copy with drag updates already applied', () => {
    const createCalDAVEvent = vi.fn().mockResolvedValue(undefined)
    duplicateEventWithSync({
      eventId: 'original-1',
      addCopySuffix: false,
      updates: { start: '2026-08-12T14:00:00.000Z', end: '2026-08-12T14:30:00.000Z' },
      createCalDAVEvent,
    })

    const [, pushed] = createCalDAVEvent.mock.calls[0]
    expect(pushed.title).toBe('Standup')
    expect(pushed.start).toBe('2026-08-12T14:00:00.000Z')
    expect(pushed.end).toBe('2026-08-12T14:30:00.000Z')
  })

  it('does not push copies of local-only events', () => {
    useCalendarStore.setState({ events: [{ ...baseEvent, calendarId: 'default' }] })
    const createCalDAVEvent = vi.fn().mockResolvedValue(undefined)

    const newId = duplicateEventWithSync({ eventId: 'original-1', createCalDAVEvent })

    expect(newId).toBeTruthy()
    expect(createCalDAVEvent).not.toHaveBeenCalled()
  })

  it('returns null and pushes nothing when the source is gone', () => {
    const createCalDAVEvent = vi.fn().mockResolvedValue(undefined)
    expect(duplicateEventWithSync({ eventId: 'missing', createCalDAVEvent })).toBeNull()
    expect(createCalDAVEvent).not.toHaveBeenCalled()
  })

  it('survives a failed push without throwing', async () => {
    const createCalDAVEvent = vi.fn().mockRejectedValue(new Error('offline'))
    expect(() => duplicateEventWithSync({ eventId: 'original-1', createCalDAVEvent })).not.toThrow()
    await Promise.resolve()
  })
})
