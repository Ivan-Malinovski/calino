import { describe, it, expect, vi, beforeEach } from 'vitest'

import { deleteRecurringOccurrence, getOccurrenceStart } from '../recurrenceDelete'
import { makeEvent, makeRule } from './fixtures'
import type { CalendarEvent } from '@/types'

vi.mock('../toast', () => ({
  showToast: vi.fn(),
}))

function makeDeps(events: CalendarEvent[]) {
  return {
    events,
    saveRecurrenceOverride: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn(),
    addEvent: vi.fn(),
    createCalDAVEvent: vi.fn().mockResolvedValue(undefined),
    deleteCalDAVEvent: vi.fn().mockResolvedValue(undefined),
  }
}

const master = makeEvent({
  id: 'master1',
  start: '2024-03-01T09:00:00Z',
  end: '2024-03-01T10:00:00Z',
  recurrence: makeRule({ frequency: 'weekly' }),
})

describe('getOccurrenceStart', () => {
  it('prefers recurrenceId on an exception event', () => {
    const exception = makeEvent({ id: 'ex1', recurrenceId: '2024-03-15T09:00:00Z' })
    expect(getOccurrenceStart(exception, 'ex1', 'master1')).toBe('2024-03-15T09:00:00Z')
  })

  it('parses the occurrence out of a synthetic expansion id', () => {
    expect(getOccurrenceStart(undefined, 'master1-2024-03-15T09:00:00Z', 'master1')).toBe(
      '2024-03-15T09:00:00Z'
    )
  })

  it('falls back to the event start when the event is the master itself', () => {
    expect(getOccurrenceStart(master, 'master1', null)).toBe('2024-03-01T09:00:00Z')
  })

  it("does not slice an id that isn't prefixed by the master id", () => {
    const other = makeEvent({ id: 'unrelated', start: '2024-05-01T09:00:00Z' })
    expect(getOccurrenceStart(other, 'unrelated', 'master1')).toBe('2024-05-01T09:00:00Z')
  })
})

describe('deleteRecurringOccurrence', () => {
  beforeEach(() => vi.clearAllMocks())

  describe("mode 'this'", () => {
    it('adds the occurrence to excludedDates instead of deleting the series', async () => {
      const deps = makeDeps([master])
      const ok = await deleteRecurringOccurrence({
        mode: 'this',
        clickedEventId: 'master1-2024-03-15T09:00:00Z',
        originalEventId: 'master1',
        ...deps,
      })

      expect(ok).toBe(true)
      expect(deps.deleteEvent).not.toHaveBeenCalled()
      const [calendarId, updatedMaster] = deps.saveRecurrenceOverride.mock.calls[0]
      expect(calendarId).toBe('cal1')
      expect(updatedMaster.excludedDates).toEqual(['2024-03-15T09:00:00Z'])
    })

    it('excludes by date only for an all-day series', async () => {
      const allDay = { ...master, isAllDay: true }
      const deps = makeDeps([allDay])
      await deleteRecurringOccurrence({
        mode: 'this',
        clickedEventId: 'master1-2024-03-15T09:00:00Z',
        originalEventId: 'master1',
        ...deps,
      })

      expect(deps.saveRecurrenceOverride.mock.calls[0][1].excludedDates).toEqual(['2024-03-15'])
    })

    it('does not duplicate an already-excluded date', async () => {
      const withExclusion = { ...master, excludedDates: ['2024-03-15T09:00:00Z'] }
      const deps = makeDeps([withExclusion])
      await deleteRecurringOccurrence({
        mode: 'this',
        clickedEventId: 'master1-2024-03-15T09:00:00Z',
        originalEventId: 'master1',
        ...deps,
      })

      expect(deps.saveRecurrenceOverride.mock.calls[0][1].excludedDates).toEqual([
        '2024-03-15T09:00:00Z',
      ])
    })

    it('removes the override event when the occurrence was an exception', async () => {
      const exception = makeEvent({ id: 'ex1', recurrenceId: '2024-03-15T09:00:00Z' })
      const deps = makeDeps([master, exception])
      await deleteRecurringOccurrence({
        mode: 'this',
        clickedEventId: 'ex1',
        originalEventId: 'master1',
        ...deps,
      })

      expect(deps.saveRecurrenceOverride.mock.calls[0][3]).toEqual(['ex1'])
    })

    it('reports failure and keeps the event when the override save throws', async () => {
      const deps = makeDeps([master])
      deps.saveRecurrenceOverride.mockRejectedValue(new Error('offline'))
      const ok = await deleteRecurringOccurrence({
        mode: 'this',
        clickedEventId: 'master1-2024-03-15T09:00:00Z',
        originalEventId: 'master1',
        ...deps,
      })

      expect(ok).toBe(false)
      expect(deps.deleteEvent).not.toHaveBeenCalled()
    })
  })

  describe("mode 'future'", () => {
    it('truncates the master rather than deleting it', async () => {
      const deps = makeDeps([master])
      const ok = await deleteRecurringOccurrence({
        mode: 'future',
        clickedEventId: 'master1-2024-03-15T09:00:00Z',
        originalEventId: 'master1',
        ...deps,
      })

      expect(ok).toBe(true)
      expect(deps.deleteEvent).not.toHaveBeenCalled()
      expect(deps.saveRecurrenceOverride).toHaveBeenCalledTimes(1)
      expect(deps.saveRecurrenceOverride.mock.calls[0][1].recurrence?.endDate).toBeDefined()
    })

    it('deletes the whole series when the occurrence is the first one', async () => {
      const deps = makeDeps([master])
      const ok = await deleteRecurringOccurrence({
        mode: 'future',
        clickedEventId: 'master1',
        originalEventId: null,
        ...deps,
      })

      expect(ok).toBe(true)
      expect(deps.saveRecurrenceOverride).not.toHaveBeenCalled()
      expect(deps.deleteEvent).toHaveBeenCalledWith('master1')
      // Deleting the first occurrence removes the series, so it must be undoable.
      expect(deps.deleteCalDAVEvent).toHaveBeenCalledWith('cal1', 'master1')
    })

    it('reports failure and keeps the series when the truncation save throws', async () => {
      const deps = makeDeps([master])
      deps.saveRecurrenceOverride.mockRejectedValue(new Error('offline'))
      const ok = await deleteRecurringOccurrence({
        mode: 'future',
        clickedEventId: 'master1-2024-03-15T09:00:00Z',
        originalEventId: 'master1',
        ...deps,
      })

      expect(ok).toBe(false)
    })
  })

  describe("mode 'all'", () => {
    it('deletes the master through the undo path', async () => {
      const deps = makeDeps([master])
      const ok = await deleteRecurringOccurrence({
        mode: 'all',
        clickedEventId: 'master1-2024-03-15T09:00:00Z',
        originalEventId: 'master1',
        ...deps,
      })

      expect(ok).toBe(true)
      expect(deps.deleteEvent).toHaveBeenCalledWith('master1')
      expect(deps.deleteCalDAVEvent).toHaveBeenCalledWith('cal1', 'master1')
      // addEvent is the undo handler — wired, but not invoked by the delete.
      expect(deps.addEvent).not.toHaveBeenCalled()
    })

    it('falls back to the clicked event when there is no master', async () => {
      const standalone = makeEvent({ id: 'solo' })
      const deps = makeDeps([standalone])
      const ok = await deleteRecurringOccurrence({
        mode: 'all',
        clickedEventId: 'solo',
        originalEventId: null,
        ...deps,
      })

      expect(ok).toBe(true)
      expect(deps.deleteEvent).toHaveBeenCalledWith('solo')
    })

    it('does not touch CalDAV for local-only events', async () => {
      const local = makeEvent({ id: 'solo', calendarId: 'default' })
      const deps = makeDeps([local])
      await deleteRecurringOccurrence({
        mode: 'all',
        clickedEventId: 'solo',
        originalEventId: null,
        ...deps,
      })

      expect(deps.deleteEvent).toHaveBeenCalledWith('solo')
      expect(deps.deleteCalDAVEvent).not.toHaveBeenCalled()
    })
  })

  it('returns false when the target event is missing entirely', async () => {
    const deps = makeDeps([])
    const ok = await deleteRecurringOccurrence({
      mode: 'all',
      clickedEventId: 'ghost',
      originalEventId: null,
      ...deps,
    })

    expect(ok).toBe(false)
    expect(deps.deleteEvent).not.toHaveBeenCalled()
  })
})
