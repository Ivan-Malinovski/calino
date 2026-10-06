import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import {
  calendarEventToIcalComponent,
  calendarEventToIcalVjournal,
  calendarEventToIcalVtodo,
  icalEventToCalendarEvent,
  icalVjournalToCalendarEvent,
  icalVtodoToCalendarEvent,
} from '../icalTypeMapping'
import { patchICALData } from '../icalPatch'
import { readScalarProperties, writeScalarProperties } from '../icalPropertyRegistry'

// RFC 9253 §8.1: CONCEPT is URI-valued, repeatable, allowed in any component,
// and only takes IANA / non-standard parameters. Test URIs below deliberately
// include a comma (tag: URIs) which TEXT escaping would corrupt.
// Property naming/shape originally contributed by Al Franco (al-franco-data).

const TAG = 'tag:example.com,2026:record/note'

function wrap(component: string, lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    `BEGIN:${component}`,
    ...lines,
    `END:${component}`,
    'END:VCALENDAR',
  ].join('\r\n')
}

function sub(ics: string, name: string): ICAL.Component {
  const c = new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent(name)
  if (!c) throw new Error(`No ${name}`)
  return c
}

describe('RFC 9253 CONCEPT mapping', () => {
  it('round-trips CONCEPT on VEVENT without escaping the URI', () => {
    const ics = wrap('VEVENT', [
      'UID:c-ev',
      'DTSTART:20260830T120000Z',
      'DTEND:20260830T130000Z',
      'SUMMARY:E',
      `CONCEPT:${TAG}`,
    ])
    const parsed = icalEventToCalendarEvent(sub(ics, 'vevent'), 'cal-1')
    expect(parsed.concepts).toEqual([TAG])

    const out = calendarEventToIcalComponent(parsed).toString()
    expect(out).toContain(`CONCEPT:${TAG}`)
    expect(out).not.toContain('example.com\\,2026')
  })

  it('round-trips CONCEPT on VTODO', () => {
    const ics = wrap('VTODO', ['UID:c-td', 'SUMMARY:T', 'STATUS:NEEDS-ACTION', `CONCEPT:${TAG}`])
    const parsed = icalVtodoToCalendarEvent(sub(ics, 'vtodo'), 'cal-1')
    expect(parsed.concepts).toEqual([TAG])
    expect(calendarEventToIcalVtodo(parsed).toString()).toContain(`CONCEPT:${TAG}`)
  })

  it('round-trips CONCEPT on VJOURNAL', () => {
    const ics = wrap('VJOURNAL', ['UID:c-jn', 'DTSTART;VALUE=DATE:20260829', 'SUMMARY:J', `CONCEPT:${TAG}`])
    const parsed = icalVjournalToCalendarEvent(sub(ics, 'vjournal'), 'cal-1')
    expect(parsed.concepts).toEqual([TAG])
    expect(calendarEventToIcalVjournal(parsed).toString()).toContain(`CONCEPT:${TAG}`)
  })

  it('keeps multiple CONCEPT lines as separate values in order', () => {
    const ics = wrap('VEVENT', [
      'UID:c-multi',
      'DTSTART:20260830T120000Z',
      'DTEND:20260830T130000Z',
      'SUMMARY:M',
      'CONCEPT:https://example.com/concepts/one',
      `CONCEPT:${TAG}`,
    ])
    const parsed = icalEventToCalendarEvent(sub(ics, 'vevent'), 'cal-1')
    expect(parsed.concepts).toEqual(['https://example.com/concepts/one', TAG])

    const lines = calendarEventToIcalComponent(parsed)
      .toString()
      .split(/\r?\n/)
      .filter((l: string) => l.startsWith('CONCEPT:'))
    expect(lines).toEqual(['CONCEPT:https://example.com/concepts/one', `CONCEPT:${TAG}`])
  })

  it('leaves concepts undefined when absent and writes no CONCEPT line', () => {
    const ics = wrap('VEVENT', ['UID:c-none', 'DTSTART:20260830T120000Z', 'DTEND:20260830T130000Z', 'SUMMARY:N'])
    const parsed = icalEventToCalendarEvent(sub(ics, 'vevent'), 'cal-1')
    expect(parsed.concepts).toBeUndefined()
    expect(calendarEventToIcalComponent(parsed).toString()).not.toContain('CONCEPT')
  })

  it('removes CONCEPT when the event no longer has any', () => {
    const ics = wrap('VEVENT', [
      'UID:c-clear',
      'DTSTART:20260830T120000Z',
      'DTEND:20260830T130000Z',
      'SUMMARY:C',
      `CONCEPT:${TAG}`,
    ])
    const parsed = icalEventToCalendarEvent(sub(ics, 'vevent'), 'cal-1')
    const out = calendarEventToIcalComponent({ ...parsed, concepts: undefined }).toString()
    expect(out).not.toContain('CONCEPT')
  })
})

describe('RFC 9253 CONCEPT parameters and patching', () => {
  it('preserves non-standard parameters on retained CONCEPT lines', () => {
    const c = new ICAL.Component('vevent')
    const kept = new ICAL.Property('concept', c)
    kept.setValue('https://example.com/a')
    kept.setParameter('x-source', 'import')
    c.addProperty(kept)
    const dropped = new ICAL.Property('concept', c)
    dropped.setValue('https://example.com/b')
    c.addProperty(dropped)

    writeScalarProperties(c, 'concept', ['https://example.com/a', 'https://example.com/c'])

    expect(readScalarProperties(c, 'concept')).toEqual(['https://example.com/a', 'https://example.com/c'])
    const first = c.getAllProperties('concept')[0]
    expect(first.getParameter('x-source')).toBe('import')
  })

  it('deduplicates repeated values on read and write', () => {
    const c = new ICAL.Component('vtodo')
    writeScalarProperties(c, 'concept', [' https://example.com/a ', 'https://example.com/a', ''])
    expect(c.getAllProperties('concept')).toHaveLength(1)
    expect(readScalarProperties(c, 'concept')).toEqual(['https://example.com/a'])
  })

  it('patch mode keeps unchanged CONCEPT params and applies edits', () => {
    const ics = wrap('VEVENT', [
      'UID:c-patch',
      'DTSTART:20260830T120000Z',
      'DTEND:20260830T130000Z',
      'SUMMARY:P',
      'CONCEPT;X-SRC=srv:https://example.com/keep',
      'CONCEPT:https://example.com/drop',
    ])
    const parsed = icalEventToCalendarEvent(sub(ics, 'vevent'), 'cal-1')
    const patched = patchICALData(ics, [
      { ...parsed, concepts: ['https://example.com/keep', 'https://example.com/new'] },
    ])
    expect(patched).not.toBeNull()
    expect(patched).toContain('CONCEPT;X-SRC=srv:https://example.com/keep')
    expect(patched).toContain('CONCEPT:https://example.com/new')
    expect(patched).not.toContain('https://example.com/drop')
  })
})
