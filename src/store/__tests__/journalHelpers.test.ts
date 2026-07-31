import { describe, it, expect } from 'vitest'
import {
  getJournalDates,
  getJournalEntriesForDate,
  getJournalEntriesForMonth,
  isJournalEntryVisible,
} from '../calendarStore'
import type { CalendarEvent } from '@/types'

/**
 * Journal entries live in calendars, so hiding a calendar in the sidebar must
 * hide its entries too — the same rule already applied to events and tasks.
 * Regression net for issue #88.
 */

function journal(id: string, calendarId: string, start: string): CalendarEvent {
  return {
    id,
    calendarId,
    title: id,
    start,
    end: start,
    isAllDay: true,
    type: 'journal',
  }
}

const work = journal('work-entry', 'work', '2026-07-15')
const personal = journal('personal-entry', 'personal', '2026-07-15')
const otherMonth = journal('old-entry', 'work', '2026-06-02')
const meeting: CalendarEvent = {
  id: 'meeting',
  calendarId: 'work',
  title: 'Standup',
  start: '2026-07-15T09:00:00',
  end: '2026-07-15T09:15:00',
  isAllDay: false,
  type: 'event',
}

const events = [work, personal, otherMonth, meeting]
const onlyWork = new Set(['work'])

describe('isJournalEntryVisible', () => {
  it('rejects non-journal events regardless of calendar', () => {
    expect(isJournalEntryVisible(meeting, onlyWork)).toBe(false)
  })

  it('accepts every journal entry when no calendar filter is supplied', () => {
    expect(isJournalEntryVisible(personal)).toBe(true)
  })

  it('rejects entries whose calendar is not visible', () => {
    expect(isJournalEntryVisible(personal, onlyWork)).toBe(false)
    expect(isJournalEntryVisible(work, onlyWork)).toBe(true)
  })
})

describe('getJournalEntriesForDate', () => {
  it('returns entries from every calendar when unfiltered', () => {
    expect(getJournalEntriesForDate(events, '2026-07-15').map((e) => e.id)).toEqual([
      'work-entry',
      'personal-entry',
    ])
  })

  it('drops entries from hidden calendars', () => {
    expect(getJournalEntriesForDate(events, '2026-07-15', onlyWork).map((e) => e.id)).toEqual([
      'work-entry',
    ])
  })

  it('returns nothing when every calendar is hidden', () => {
    expect(getJournalEntriesForDate(events, '2026-07-15', new Set())).toEqual([])
  })
})

describe('getJournalEntriesForMonth', () => {
  it('drops entries from hidden calendars', () => {
    // month is zero-based: 6 === July
    expect(getJournalEntriesForMonth(events, 2026, 6, onlyWork).map((e) => e.id)).toEqual([
      'work-entry',
    ])
  })

  it('still scopes to the requested month', () => {
    expect(getJournalEntriesForMonth(events, 2026, 5, onlyWork).map((e) => e.id)).toEqual([
      'old-entry',
    ])
  })
})

describe('getJournalDates', () => {
  it('marks dates from every calendar when unfiltered', () => {
    expect([...getJournalDates(events)].sort()).toEqual(['2026-06-02', '2026-07-15'])
  })

  it('omits dates whose only entry is in a hidden calendar', () => {
    const onlyPersonal = new Set(['personal'])
    expect([...getJournalDates(events, onlyPersonal)]).toEqual(['2026-07-15'])
  })

  it('marks no dates when every calendar is hidden', () => {
    expect(getJournalDates(events, new Set()).size).toBe(0)
  })
})
