import { describe, it, expect } from 'vitest'
import {
  parseVFreeBusy,
  parseScheduleResponse,
  buildFreeBusyQueryXml,
  buildFreeBusyRequestIcs,
  toIcalUtcStamp,
} from '../freeBusy'

const VFREEBUSY = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VFREEBUSY
DTSTART:20260310T000000Z
DTEND:20260311T000000Z
FREEBUSY;FBTYPE=BUSY:20260310T090000Z/20260310T100000Z
FREEBUSY;FBTYPE=BUSY-TENTATIVE:20260310T140000Z/20260310T150000Z
END:VFREEBUSY
END:VCALENDAR`

describe('parseVFreeBusy', () => {
  it('reads periods and their FBTYPE', () => {
    const periods = parseVFreeBusy(VFREEBUSY)

    expect(periods).toHaveLength(2)
    expect(periods[0]!.type).toBe('BUSY')
    expect(periods[0]!.start.toISOString()).toBe('2026-03-10T09:00:00.000Z')
    expect(periods[0]!.end.toISOString()).toBe('2026-03-10T10:00:00.000Z')
    expect(periods[1]!.type).toBe('BUSY-TENTATIVE')
  })

  it('defaults a missing FBTYPE to BUSY, per RFC 5545', () => {
    const ics = VFREEBUSY.replace(';FBTYPE=BUSY:', ':').replace(
      'FREEBUSY;FBTYPE=BUSY-TENTATIVE:20260310T140000Z/20260310T150000Z\n',
      ''
    )
    const periods = parseVFreeBusy(ics)

    expect(periods).toHaveLength(1)
    expect(periods[0]!.type).toBe('BUSY')
  })

  it('expands the start/duration period form', () => {
    const ics = VFREEBUSY.replace(
      '20260310T090000Z/20260310T100000Z',
      '20260310T090000Z/PT90M'
    ).replace('FREEBUSY;FBTYPE=BUSY-TENTATIVE:20260310T140000Z/20260310T150000Z\n', '')

    const periods = parseVFreeBusy(ics)
    expect(periods).toHaveLength(1)
    expect(periods[0]!.end.toISOString()).toBe('2026-03-10T10:30:00.000Z')
  })

  it('reads a multi-value FREEBUSY property', () => {
    const ics = VFREEBUSY.replace(
      'FREEBUSY;FBTYPE=BUSY:20260310T090000Z/20260310T100000Z',
      'FREEBUSY;FBTYPE=BUSY:20260310T090000Z/20260310T100000Z,20260310T110000Z/20260310T113000Z'
    )
    expect(parseVFreeBusy(ics)).toHaveLength(3)
  })

  it('returns an empty list rather than throwing on garbage', () => {
    expect(parseVFreeBusy('not a calendar at all')).toEqual([])
    expect(parseVFreeBusy('')).toEqual([])
    expect(parseVFreeBusy('   ')).toEqual([])
  })

  it('returns an empty list for a VFREEBUSY with no periods', () => {
    const ics = VFREEBUSY.split('\n')
      .filter((l) => !l.startsWith('FREEBUSY'))
      .join('\n')
    expect(parseVFreeBusy(ics)).toEqual([])
  })
})

describe('buildFreeBusyQueryXml', () => {
  it('emits an RFC 4791 free-busy-query with a UTC time-range', () => {
    const xml = buildFreeBusyQueryXml(
      new Date('2026-03-10T08:00:00Z'),
      new Date('2026-03-10T18:00:00Z')
    )

    expect(xml).toContain('<C:free-busy-query')
    expect(xml).toContain('urn:ietf:params:xml:ns:caldav')
    expect(xml).toContain('start="20260310T080000Z"')
    expect(xml).toContain('end="20260310T180000Z"')
  })
})

describe('buildFreeBusyRequestIcs', () => {
  it('emits a METHOD:REQUEST VFREEBUSY naming every recipient', () => {
    const ics = buildFreeBusyRequestIcs(
      'me@example.com',
      ['a@example.com', 'b@example.com'],
      new Date('2026-03-10T08:00:00Z'),
      new Date('2026-03-10T18:00:00Z')
    )

    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('BEGIN:VFREEBUSY')
    expect(ics).toContain('ORGANIZER:mailto:me@example.com')
    expect(ics).toContain('ATTENDEE:mailto:a@example.com')
    expect(ics).toContain('ATTENDEE:mailto:b@example.com')
    expect(ics).toContain('DTSTART:20260310T080000Z')
    // Must be CRLF-delimited to be a valid iCalendar stream.
    expect(ics).toContain('\r\n')
  })

  it('round-trips through the parser', () => {
    const ics = buildFreeBusyRequestIcs(
      'me@example.com',
      ['a@example.com'],
      new Date('2026-03-10T08:00:00Z'),
      new Date('2026-03-10T18:00:00Z')
    )
    // No FREEBUSY periods in a request, but it must still parse.
    expect(parseVFreeBusy(ics)).toEqual([])
  })
})

describe('toIcalUtcStamp', () => {
  it('produces basic-format UTC', () => {
    expect(toIcalUtcStamp(new Date('2026-03-10T08:05:09Z'))).toBe('20260310T080509Z')
  })
})

const SCHEDULE_RESPONSE = `<?xml version="1.0" encoding="utf-8" ?>
<C:schedule-response xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:response>
    <C:recipient><D:href>mailto:busy@example.com</D:href></C:recipient>
    <C:request-status>2.0;Success</C:request-status>
    <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VFREEBUSY
FREEBUSY;FBTYPE=BUSY:20260310T090000Z/20260310T100000Z
END:VFREEBUSY
END:VCALENDAR</C:calendar-data>
  </C:response>
  <C:response>
    <C:recipient><D:href>mailto:stranger@elsewhere.test</D:href></C:recipient>
    <C:request-status>3.7;Invalid calendar user</C:request-status>
  </C:response>
  <C:response>
    <C:recipient><D:href>mailto:broken@example.com</D:href></C:recipient>
    <C:request-status>5.1;Service unavailable</C:request-status>
  </C:response>
</C:schedule-response>`

describe('parseScheduleResponse', () => {
  it('parses a successful recipient into periods', () => {
    const responses = parseScheduleResponse(SCHEDULE_RESPONSE)
    const busy = responses.find((r) => r.recipient === 'busy@example.com')

    expect(busy?.periods).toHaveLength(1)
    expect(busy!.periods![0]!.start.toISOString()).toBe('2026-03-10T09:00:00.000Z')
  })

  it('maps 3.7 and 5.x to unknown rather than to free', () => {
    const responses = parseScheduleResponse(SCHEDULE_RESPONSE)

    expect(responses.find((r) => r.recipient === 'stranger@elsewhere.test')?.periods).toBeNull()
    expect(responses.find((r) => r.recipient === 'broken@example.com')?.periods).toBeNull()
  })

  it('strips the mailto: scheme from recipients', () => {
    expect(parseScheduleResponse(SCHEDULE_RESPONSE).map((r) => r.recipient)).toEqual([
      'busy@example.com',
      'stranger@elsewhere.test',
      'broken@example.com',
    ])
  })

  it('returns an empty list rather than throwing on malformed XML', () => {
    expect(parseScheduleResponse('<not><closed>')).toEqual([])
    expect(parseScheduleResponse('')).toEqual([])
  })

  it('reports unknown when a 2.0 response carries no calendar-data', () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<C:schedule-response xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:response>
    <C:recipient><D:href>mailto:quiet@example.com</D:href></C:recipient>
    <C:request-status>2.0;Success</C:request-status>
  </C:response>
</C:schedule-response>`

    expect(parseScheduleResponse(xml)[0]).toEqual({
      recipient: 'quiet@example.com',
      periods: null,
    })
  })
})
