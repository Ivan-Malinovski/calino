import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '@/types'
import { syncJournalEntryToServer } from '../journalSync'

const existing: CalendarEvent = {
  id: 'journal-1',
  calendarId: 'work',
  title: 'A journal entry',
  description: 'Some notes',
  start: '2026-08-22',
  end: '2026-08-22',
  isAllDay: true,
  type: 'journal',
  resourceHref: '/dav/journal-1.ics',
}

type UpdateCalDAVEvent = (calendarId: string, event: CalendarEvent) => Promise<void>

const options = (updateCalDAVEvent: UpdateCalDAVEvent) => ({
  existing: { ...existing },
  targetCalendarId: 'work',
  syncedEntry: existing,
  updateCalDAVEvent,
  createCalDAVEvent: vi.fn().mockResolvedValue(undefined),
  deleteCalDAVEventByHref: vi.fn().mockResolvedValue(undefined),
  showToast: vi.fn(),
})

describe('syncJournalEntryToServer', () => {
  it('reports a failed remote update so the caller can keep an error save state', async () => {
    const updateCalDAVEvent = vi.fn().mockRejectedValue(new Error('offline'))
    const opts = options(updateCalDAVEvent)

    await expect(syncJournalEntryToServer(opts)).resolves.toBe(false)
    expect(opts.showToast).toHaveBeenCalledWith('Failed to sync update. It will be retried.')
  })

  it('reports local-only changes as already synced', async () => {
    const opts = options(vi.fn().mockResolvedValue(undefined))
    opts.existing.calendarId = 'default'
    opts.targetCalendarId = 'default'

    await expect(syncJournalEntryToServer(opts)).resolves.toBe(true)
    expect(opts.showToast).not.toHaveBeenCalled()
  })
})
