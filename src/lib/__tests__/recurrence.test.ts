import { describe, it, expect } from 'vitest'
import { buildRRuleString, describeRecurrence } from '../recurrence'
import type { CalendarEvent, RecurrenceRule } from '@/types'

function rule(partial: Partial<RecurrenceRule>): RecurrenceRule {
  return { frequency: 'weekly', interval: 1, ...partial }
}

describe('buildRRuleString', () => {
  it('emits FREQ and omits INTERVAL when interval is 1', () => {
    expect(buildRRuleString(rule({ frequency: 'daily', interval: 1 }))).toBe('FREQ=DAILY')
  })

  it('includes INTERVAL when greater than 1', () => {
    expect(buildRRuleString(rule({ frequency: 'weekly', interval: 2 }))).toBe(
      'FREQ=WEEKLY;INTERVAL=2'
    )
  })

  it('maps byWeekday numbers to BYDAY codes in order', () => {
    // 1=MO, 3=WE, 5=FR
    expect(buildRRuleString(rule({ frequency: 'weekly', byWeekday: [1, 3, 5] }))).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR'
    )
  })

  it('encodes "last Friday of month" as BYDAY=-1FR (nth-weekday via byDayOrdinals)', () => {
    // R2.4 — Per-BYDAY ordinals now live in byDayOrdinals, NOT bySetPos.
    const s = buildRRuleString(rule({ frequency: 'monthly', byWeekday: [5], byDayOrdinals: [-1] }))
    expect(s).toBe('FREQ=MONTHLY;BYDAY=-1FR')
  })

  it('encodes "second Tuesday of month" as BYDAY=2TU', () => {
    const s = buildRRuleString(rule({ frequency: 'monthly', byWeekday: [2], byDayOrdinals: [2] }))
    expect(s).toBe('FREQ=MONTHLY;BYDAY=2TU')
  })

  it('does not attach a zero position to a weekday code', () => {
    const s = buildRRuleString(rule({ frequency: 'weekly', byWeekday: [1], byDayOrdinals: [0] }))
    expect(s).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  it('emits standalone BYSETPOS only when no byWeekday is present', () => {
    expect(buildRRuleString(rule({ frequency: 'monthly', bySetPos: [-1] }))).toBe(
      'FREQ=MONTHLY;BYSETPOS=-1'
    )
    // R2.4 — When byWeekday is present, the ordinal is now in byDayOrdinals,
    // NOT in bySetPos. So setting bySetPos with byWeekday present does
    // NOT emit a standalone BYSETPOS — byDayOrdinals is what produces
    // the positional BYDAY.
    expect(
      buildRRuleString(rule({ frequency: 'monthly', byWeekday: [5], bySetPos: [-1] }))
    ).not.toContain('BYSETPOS')
  })

  it('includes BYMONTHDAY and BYMONTH', () => {
    const s = buildRRuleString(rule({ frequency: 'yearly', byMonth: [12], byMonthDay: [25] }))
    expect(s).toContain('BYMONTH=12')
    expect(s).toContain('BYMONTHDAY=25')
  })

  it('emits COUNT when count is set and no endDate', () => {
    expect(buildRRuleString(rule({ frequency: 'daily', count: 10 }))).toBe('FREQ=DAILY;COUNT=10')
  })

  it('prefers UNTIL over COUNT when both are present (UNTIL wins)', () => {
    const s = buildRRuleString(
      rule({ frequency: 'daily', count: 10, endDate: '2026-06-01T00:00:00.000Z' })
    )
    expect(s).toContain('UNTIL=')
    expect(s).not.toContain('COUNT=')
  })

  it('falls back to WEEKLY for an unknown frequency', () => {
    const s = buildRRuleString({ frequency: 'bogus' as RecurrenceRule['frequency'], interval: 1 })
    expect(s).toBe('FREQ=WEEKLY')
  })
})

describe('describeRecurrence', () => {
  const baseEvent = (partial: Partial<CalendarEvent>): CalendarEvent =>
    ({
      id: 'e1',
      calendarId: 'c1',
      title: 'x',
      start: '2026-01-01T09:00:00.000Z',
      end: '2026-01-01T10:00:00.000Z',
      isAllDay: false,
      ...partial,
    }) as CalendarEvent

  it('returns "Recurring" when there is no recurrence', () => {
    expect(describeRecurrence(baseEvent({}))).toBe('Recurring')
  })

  it('describes a raw rruleString', () => {
    const text = describeRecurrence(baseEvent({ rruleString: 'FREQ=WEEKLY' }))
    expect(text.toLowerCase()).toContain('week')
  })

  it('describes a structured recurrence rule', () => {
    const text = describeRecurrence(
      baseEvent({ recurrence: rule({ frequency: 'daily', interval: 1 }) })
    )
    expect(text.toLowerCase()).toContain('day')
  })

  it('never throws on a malformed rruleString', () => {
    expect(() => describeRecurrence(baseEvent({ rruleString: 'NOT A VALID RULE' }))).not.toThrow()
  })
})
