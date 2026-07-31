import { describe, it, expect, vi, beforeEach } from 'vitest'
import { moveEventGroup, MoveLostSourceError } from '../moveEvent'
import type { SyncEngine } from '../syncEngine'
import type { CalendarEvent } from '@/types'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    calendarId: 'cal-target',
    title: 'Movable',
    start: '2026-08-03T14:00:00Z',
    end: '2026-08-03T15:00:00Z',
    isAllDay: false,
    ...overrides,
  } as CalendarEvent
}

function makeEngines(): {
  targetEngine: SyncEngine
  sourceEngine: SyncEngine
  order: string[]
} {
  const order: string[] = []
  const targetEngine = {
    putEventGroup: vi.fn(async () => {
      order.push('put')
      return { url: 'https://dav.example/work/event-1.ics', etag: '"new"' }
    }),
  } as unknown as SyncEngine
  const sourceEngine = {
    deleteEvent: vi.fn(async () => {
      order.push('delete')
    }),
  } as unknown as SyncEngine
  return { targetEngine, sourceEngine, order }
}

const SOURCE_HREF = 'https://dav.example/personal/event-1.ics'

describe('moveEventGroup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes the destination BEFORE deleting the source', async () => {
    // Order is the whole safety argument: if the PUT fails first, the source is
    // untouched and no duplicate can exist.
    const { targetEngine, sourceEngine, order } = makeEngines()

    const result = await moveEventGroup([makeEvent()], {
      targetEngine,
      sourceEngine,
      sourceHref: SOURCE_HREF,
      sourceEtag: '"old"',
    })

    expect(order).toEqual(['put', 'delete'])
    expect(sourceEngine.deleteEvent).toHaveBeenCalledWith(SOURCE_HREF, '"old"')
    expect(result).toMatchObject({
      url: 'https://dav.example/work/event-1.ics',
      etag: '"new"',
      sourceDeleted: true,
      memberIds: ['event-1'],
    })
  })

  it('throws and never deletes the source when the destination write fails', async () => {
    const { targetEngine, sourceEngine } = makeEngines()
    vi.mocked(targetEngine.putEventGroup).mockRejectedValue(new Error('500 boom'))

    await expect(
      moveEventGroup([makeEvent()], {
        targetEngine,
        sourceEngine,
        sourceHref: SOURCE_HREF,
      })
    ).rejects.toThrow('500 boom')

    expect(sourceEngine.deleteEvent).not.toHaveBeenCalled()
  })

  it('treats a 404 on the source as already cleaned up', async () => {
    const { targetEngine, sourceEngine } = makeEngines()
    vi.mocked(sourceEngine.deleteEvent).mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    )

    const result = await moveEventGroup([makeEvent()], {
      targetEngine,
      sourceEngine,
      sourceHref: SOURCE_HREF,
    })

    expect(result.sourceDeleted).toBe(true)
  })

  it('reports an un-deleted source instead of throwing', async () => {
    // The destination already has the event; throwing here would make the
    // caller think the move failed and retry it, when what is actually needed
    // is a queued cleanup.
    const { targetEngine, sourceEngine } = makeEngines()
    vi.mocked(sourceEngine.deleteEvent).mockRejectedValue(
      Object.assign(new Error('Server Error'), { status: 500 })
    )

    const result = await moveEventGroup([makeEvent()], {
      targetEngine,
      sourceEngine,
      sourceHref: SOURCE_HREF,
    })

    expect(result.sourceDeleted).toBe(false)
    expect(result.url).toBe('https://dav.example/work/event-1.ics')
  })

  it('skips the delete when the source was local-only', async () => {
    const { targetEngine } = makeEngines()

    const result = await moveEventGroup([makeEvent()], {
      targetEngine,
      sourceEngine: null,
    })

    // Nothing remains on any server, so there is nothing to queue.
    expect(result.sourceDeleted).toBe(true)
  })

  it('carries every member of a recurrence group', async () => {
    const { targetEngine, sourceEngine } = makeEngines()
    const master = makeEvent({ id: 'series', uid: 'series' })
    const override = makeEvent({
      id: 'series-2026-08-10',
      uid: 'series',
      recurrenceId: '2026-08-10T14:00:00.000Z',
      recurrenceMasterId: 'series',
    })

    const result = await moveEventGroup([master, override], {
      targetEngine,
      sourceEngine,
      sourceHref: SOURCE_HREF,
    })

    expect(targetEngine.putEventGroup).toHaveBeenCalledWith([master, override])
    expect(result.memberIds).toEqual(['series', 'series-2026-08-10'])
  })

  describe('servers that reject a duplicate UID', () => {
    it('falls back to deleting the source first, then writing', async () => {
      const { targetEngine, sourceEngine, order } = makeEngines()
      // Keep recording call order across both attempts — a bare
      // mockRejectedValueOnce would replace the recording implementation.
      vi.mocked(targetEngine.putEventGroup)
        .mockImplementationOnce(async () => {
          order.push('put')
          throw Object.assign(new Error('Conflict'), { status: 409 })
        })
        .mockImplementationOnce(async () => {
          order.push('put')
          return { url: 'https://dav.example/work/event-1.ics', etag: '"new"' }
        })

      const result = await moveEventGroup([makeEvent()], {
        targetEngine,
        sourceEngine,
        sourceHref: SOURCE_HREF,
      })

      expect(order).toEqual(['put', 'delete', 'put'])
      expect(result.sourceDeleted).toBe(true)
    })

    it('reports a lost source distinctly when the retry also fails', async () => {
      // The caller must re-CREATE here, not re-move: the source is gone, so a
      // move would have nothing to move.
      const { targetEngine, sourceEngine } = makeEngines()
      vi.mocked(targetEngine.putEventGroup)
        .mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }))
        .mockRejectedValueOnce(new Error('503 unavailable'))

      await expect(
        moveEventGroup([makeEvent()], {
          targetEngine,
          sourceEngine,
          sourceHref: SOURCE_HREF,
        })
      ).rejects.toBeInstanceOf(MoveLostSourceError)

      expect(sourceEngine.deleteEvent).toHaveBeenCalledOnce()
    })

    it('does not attempt the fallback when there is no source to delete', async () => {
      const { targetEngine } = makeEngines()
      vi.mocked(targetEngine.putEventGroup).mockRejectedValue(
        Object.assign(new Error('Conflict'), { status: 409 })
      )

      await expect(
        moveEventGroup([makeEvent()], { targetEngine, sourceEngine: null })
      ).rejects.toThrow('Conflict')
    })
  })
})
