/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import type { JSCalendarObject, JsonObject, JsonValue } from '../../types'
import { parseICALDataAsyncWithStatus } from '@/features/caldav/adapter/iCalendarAdapter'
import { jscalendarToIcs } from '../jscalendarToIcs'
import { applyPatch, object } from '../jscalToIcsValues'
import pairedEvents from './fixtures/paired-events.json'

const fixtures = pairedEvents as unknown as {
  name: string
  provenance: string
  event: JSCalendarObject
}[]
const basic: JSCalendarObject = {
  '@type': 'Event',
  uid: 'unit-test',
  title: 'Appointment',
  start: '2026-10-10T10:00:00',
  timeZone: 'UTC',
  duration: 'PT1H',
}

const fixtureTexts = import.meta.glob('./fixtures/*.ics', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function readFixture(name: string): string {
  const value = fixtureTexts[`./fixtures/${name}.ics`]
  if (!value) throw new Error(`Missing fixture: ${name}`)
  return value
}

function calendar(ics: string): ICAL.Component {
  return new ICAL.Component(ICAL.parse(ics))
}

function master(ics: string): ICAL.Component {
  const component = calendar(ics).getFirstSubcomponent('vevent')
  if (!component) throw new Error('No VEVENT')
  return component
}

/** Compare decoded values, normalized defaults and recurrence parts, not line layout. */
function semantic(ics: string): string {
  const ignored = new Set(['dtstamp', 'last-modified', 'prodid', 'calscale'])
  const defaults: Record<string, string> = {
    status: 'CONFIRMED',
    transp: 'OPAQUE',
    class: 'PUBLIC',
    sequence: '0',
    priority: '0',
  }
  function normalize(component: ICAL.Component): string {
    const properties = component
      .getAllProperties()
      .flatMap((property) => {
        if (ignored.has(property.name) || property.name.startsWith('x-')) return []
        // JMAP alerts carry no text or recipients: Stalwart drops them, and the
        // converter fills in what RFC 5545 requires (the event title, the
        // attendee) for DISPLAY and EMAIL alarms.
        if (
          component.name === 'valarm' &&
          ['description', 'summary', 'attendee'].includes(property.name)
        )
          return []
        const json = property.toJSON() as [
          string,
          Record<string, JsonValue>,
          string,
          ...JsonValue[],
        ]
        const params = Object.entries(json[1])
          .filter(
            ([key, value]) =>
              !(key === 'related' && value === 'START') &&
              key !== 'value' &&
              // Stalwart does not expose the per-attendee schedule sequence over JMAP.
              key !== 'schedule-sequence'
          )
          .sort(([a], [b]) => a.localeCompare(b))
        const values = property.getValues().map((value: unknown) => {
          if (value instanceof ICAL.Recur) return value.toString().split(';').sort().join(';')
          if (value instanceof ICAL.Time || value instanceof ICAL.Duration)
            return value.toICALString()
          return value
        })
        if (
          params.length === 0 &&
          values.length === 1 &&
          String(values[0]) === defaults[property.name]
        )
          return []
        if (property.name === 'categories') values.sort()
        // A single comma-list RDATE/EXDATE equals several one-value properties.
        if (['rdate', 'exdate'].includes(property.name))
          return values.map((value) => JSON.stringify([property.name, params, value]))
        return [JSON.stringify([property.name, params, values])]
      })
      .sort()
    const children = component
      .getAllSubcomponents()
      .filter((child) => child.name !== 'vtimezone')
      .map(normalize)
      .sort()
    return JSON.stringify([component.name, properties, children])
  }
  return normalize(calendar(ics))
}

describe('JSCalendar to iCalendar paired fixtures', () => {
  it.each(fixtures)('$name matches the original iCalendar semantically', ({ name, event }) => {
    expect(semantic(jscalendarToIcs(event))).toBe(semantic(readFixture(name)))
  })

  it.each(fixtures)(
    '$name is accepted by Calino with the original title/times/recurrence/reminders',
    async ({ name, event }) => {
      const output = await parseICALDataAsyncWithStatus(jscalendarToIcs(event), 'test-calendar')
      const original = await parseICALDataAsyncWithStatus(readFixture(name), 'test-calendar')
      expect(output.hadParseFailures).toBe(false)
      expect(output.events.length).toBeGreaterThan(0)
      const simplify = (result: typeof output) =>
        result.events
          .map((e) => ({
            title: e.title,
            start: e.start,
            end: e.end,
            isAllDay: e.isAllDay,
            timezone: e.timezone,
            recurrence: e.recurrence,
            recurrenceId: e.recurrenceId,
            excludedDates: e.excludedDates?.sort(),
            reminders: e.reminders?.map(({ method, minutesBefore }) => ({ method, minutesBefore })),
            categories: e.categories?.sort(),
            concepts: e.concepts,
          }))
          .sort((a, b) => a.title.localeCompare(b.title))
      expect(simplify(output)).toEqual(simplify(original))
      const root = output.events.find((e) => !e.recurrenceId)
      expect(root?.title).toBe(event.title)
      if (name === 'weekly') {
        expect(root?.recurrence).toMatchObject({ frequency: 'weekly', count: 4 })
        expect(root?.reminders?.[0]).toMatchObject({ minutesBefore: 15, method: 'popup' })
      }
      if (name === 'copenhagen') {
        expect(root?.start).toBe('2026-10-10T10:00:00')
        expect(root?.timezone).toBe('Europe/Copenhagen')
        expect(root?.end).toBe('2026-10-10T11:00:00')
      }
      if (name === 'new-york') {
        expect(root?.start).toBe('2026-10-10T10:00:00')
        expect(root?.timezone).toBe('America/New_York')
      }
    }
  )
})

describe('wire format and additional mappings', () => {
  it('escapes TEXT and parameters and folds at 75 UTF-8 octets without breaking Unicode', () => {
    const title = 'Møde 😀, plan; next\\line\n'.repeat(12)
    const event = {
      ...basic,
      title,
      participants: {
        p: {
          email: 'a@example.org',
          name: 'A "quoted"; name^\nNew line',
          roles: { attendee: true },
        },
      },
    }
    const output = jscalendarToIcs(event, {
      prodId: 'Test, product',
      calendarName: 'Team; calendar',
    })
    expect(output).toContain('\r\n ')
    expect(output.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of output.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(master(output).getFirstPropertyValue('summary')).toBe(title)
    expect(master(output).getFirstProperty('attendee')?.getParameter('cn')).toBe(
      event.participants.p.name
    )
    expect(output).toContain('X-WR-CALNAME:Team\\; calendar')
    expect(jscalendarToIcs(event)).toBe(
      jscalendarToIcs(JSON.parse(JSON.stringify(event)) as JSCalendarObject)
    )
  })

  it('does not inject content lines from URI or option values', () => {
    const output = jscalendarToIcs(
      { ...basic, links: { p: { href: 'https://example.org/\r\nSTATUS:CANCELLED' } } },
      { prodId: 'Test\r\nSTATUS:CANCELLED' }
    )
    expect(master(output).getFirstPropertyValue('status')).toBeNull()
    expect(output).toContain('https://example.org/%0D%0ASTATUS:CANCELLED')
  })

  it('accepts Etc/UTC, html descriptions, replyTo and email fallback', () => {
    const component = master(
      jscalendarToIcs({
        ...basic,
        timeZone: 'Etc/UTC',
        description: '<b>Meeting</b>',
        descriptionContentType: 'text/html',
        replyTo: { imip: 'mailto:owner@example.org' },
        participants: { p: { email: 'a@example.org', roles: { required: true } } },
      })
    )
    expect(component.getFirstProperty('dtstart')?.toICALString()).toBe('DTSTART:20261010T100000Z')
    expect(component.getFirstPropertyValue('description')).toBe('<b>Meeting</b>')
    expect(component.getFirstPropertyValue('organizer')).toBe('mailto:owner@example.org')
    expect(component.getFirstPropertyValue('attendee')).toBe('mailto:a@example.org')
  })

  it.each([
    ['P1D', '20260329T120000'],
    ['PT24H', '20260329T130000'],
    ['P1DT1H', '20260329T130000'],
  ])('adds %s across DST with nominal days before elapsed hours', (duration, end) => {
    const c = master(
      jscalendarToIcs({
        ...basic,
        start: '2026-03-28T12:00:00',
        timeZone: 'Europe/Copenhagen',
        duration,
      })
    )
    expect(c.getFirstProperty('dtend')?.toICALString()).toBe(`DTEND;TZID=Europe/Copenhagen:${end}`)
  })

  it.each([
    ['2026-03-29T01:30:00', 'PT1H', '20260329T033000'],
    ['2026-03-29T02:30:00', 'PT1H', '20260329T043000'],
    ['2026-10-25T02:30:00', 'PT2H', '20261025T033000'],
  ])('handles DST gaps and folds for start %s', (start, duration, end) => {
    const output = jscalendarToIcs({ ...basic, start, duration, timeZone: 'Europe/Copenhagen' })
    expect(output).toContain(`DTEND;TZID=Europe/Copenhagen:${end}`)
  })

  it.each<JsonObject>([
    { endTimeZone: 'America/New_York' },
    { locations: { end: { relativeTo: 'end', timeZone: 'America/New_York' } } },
    { locations: { end: { rel: 'end', timeZone: 'America/New_York' } } },
  ])('converts the computed end instant into the end timezone', (fields) => {
    const c = master(
      jscalendarToIcs({ ...basic, timeZone: 'Europe/Copenhagen', duration: 'PT8H', ...fields })
    )
    expect(c.getFirstProperty('dtend')?.toICALString()).toBe(
      'DTEND;TZID=America/New_York:20261010T120000'
    )
  })

  it('defaults a zero-duration all-day event to one exclusive day and keeps UTC timestamps deterministic', () => {
    const output = jscalendarToIcs({ ...basic, showWithoutTime: true, duration: 'PT0S' })
    expect(output).toContain('DTEND;VALUE=DATE:20261011')
    expect(output).toContain('DTSTAMP:19700101T000000Z')
  })

  it('uses DURATION for zero-length timed events instead of an invalid equal DTEND', async () => {
    const output = jscalendarToIcs({ ...basic, duration: 'PT0S' })
    expect(output).toContain('DURATION:PT0S')
    expect(output).not.toContain('DTEND')
    const result = await parseICALDataAsyncWithStatus(output, 'test-calendar')
    expect(result.hadParseFailures).toBe(false)
    expect(result.events[0].start).toBe(result.events[0].end)
  })

  it('maps all recurrence selectors and prefers singular recurrenceRule', () => {
    const rule = {
      frequency: 'yearly',
      interval: 2,
      count: 4,
      byDay: [{ day: 'tu', nthOfPeriod: 2 }],
      byMonthDay: [1, -1],
      byMonth: ['3', '10'],
      bySetPosition: [2],
      byYearDay: [10],
      byWeekNo: [2],
      byHour: [10],
      byMinute: [15],
      bySecond: [30],
      firstDayOfWeek: 'su',
    }
    const c = master(
      jscalendarToIcs({ ...basic, recurrenceRule: rule, recurrenceRules: [{ frequency: 'daily' }] })
    )
    expect(c.getAllProperties('rrule')).toHaveLength(1)
    const output = c.getFirstProperty('rrule')?.toICALString()
    for (const part of [
      'FREQ=YEARLY',
      'INTERVAL=2',
      'COUNT=4',
      'BYDAY=2TU',
      'BYMONTHDAY=1,-1',
      'BYMONTH=3,10',
      'BYSETPOS=2',
      'BYYEARDAY=10',
      'BYWEEKNO=2',
      'BYHOUR=10',
      'BYMINUTE=15',
      'BYSECOND=30',
      'WKST=SU',
    ])
      expect(output).toContain(part)
  })

  it('supports multiple RFC rules and preserves unbounded exclusion rules as EXRULE', () => {
    const output = jscalendarToIcs({
      ...basic,
      recurrenceRules: [
        { frequency: 'daily', count: 3 },
        { frequency: 'yearly', count: 2 },
      ],
      excludedRecurrenceRules: [{ frequency: 'weekly', byDay: [{ day: 'su' }] }],
    })
    expect(master(output).getAllProperties('rrule')).toHaveLength(2)
    expect(output).toContain('EXRULE:FREQ=WEEKLY;BYDAY=SU')
  })

  it('enumerates finite exclusion rules into EXDATE', () => {
    const output = jscalendarToIcs({
      ...basic,
      recurrenceRule: { frequency: 'daily', count: 4 },
      excludedRecurrenceRules: [{ frequency: 'daily', interval: 2, count: 2 }],
    })
    expect(output).toContain('EXDATE:20261010T100000Z')
    expect(output).toContain('EXDATE:20261012T100000Z')
    expect(output).not.toContain('EXRULE')
  })

  it('lets the async Calino parser load referenced zones without VTIMEZONE', async () => {
    const output = jscalendarToIcs({ ...basic, timeZone: 'Europe/Copenhagen' })
    expect(output).not.toContain('BEGIN:VTIMEZONE')
    ICAL.TimezoneService.remove('Europe/Copenhagen')
    expect(ICAL.TimezoneService.has('Europe/Copenhagen')).toBe(false)
    const result = await parseICALDataAsyncWithStatus(output, 'test-calendar')
    expect(result.hadParseFailures).toBe(false)
    expect(ICAL.TimezoneService.has('Europe/Copenhagen')).toBe(true)
    expect(result.events[0]).toMatchObject({
      title: 'Appointment',
      start: '2026-10-10T10:00:00',
      end: '2026-10-10T11:00:00',
      timezone: 'Europe/Copenhagen',
    })
    const start = master(output).getFirstPropertyValue('dtstart') as ICAL.Time
    expect(start.toJSDate().toISOString()).toBe('2026-10-10T08:00:00.000Z')
  })

  it('uses owner as organizer and preserves both owner and attendee when both roles apply', () => {
    const c = master(
      jscalendarToIcs({
        ...basic,
        participants: {
          p: {
            calendarAddress: 'mailto:owner@example.org',
            roles: { owner: true, attendee: true },
          },
        },
      })
    )
    expect(c.getFirstPropertyValue('organizer')).toBe('mailto:owner@example.org')
    expect(c.getFirstPropertyValue('attendee')).toBe('mailto:owner@example.org')
  })

  it('writes virtual locations and percent-encoded binary attachments', () => {
    const output = jscalendarToIcs({
      ...basic,
      virtualLocations: { a: { uri: 'https://example.org/meeting', name: 'Video, meeting' } },
      links: { p: { rel: 'enclosure', href: 'data:application/octet-stream,%FF%00%41' } },
    })
    expect(output).toContain('URL:https://example.org/meeting')
    expect(output).toContain(
      'CONFERENCE;VALUE=URI;LABEL="Video, meeting":https://example.org/meeting'
    )
    expect(output.replace(/\r\n /g, '')).toContain(
      'ATTACH;VALUE=BINARY;ENCODING=BASE64;FMTTYPE=application/octet-stream:/wBB'
    )
  })

  it('maps Tasks to VTODO without imposing Event start or DTEND', () => {
    const output = jscalendarToIcs({
      '@type': 'Task',
      uid: 'task',
      title: 'Finish work',
      due: '2026-10-11T10:00:00',
      timeZone: 'UTC',
      estimatedDuration: 'PT2H',
      percentComplete: 100,
      progress: 'completed',
      progressUpdated: '2026-10-10T12:00:00Z',
    })
    const c = calendar(output).getFirstSubcomponent('vtodo')
    expect(c?.getFirstPropertyValue('status')).toBe('COMPLETED')
    expect(output).toContain('DUE:20261011T100000Z')
    expect(output).toContain('ESTIMATED-DURATION:PT2H')
    expect(output).toContain('PERCENT-COMPLETE:100')
    expect(output).toContain('COMPLETED:20261010T120000Z')
    expect(output).not.toContain('DTEND')
  })
})

describe('PatchObjects and recurrence membership', () => {
  it('applies escaped slash/tilde paths, replacement and null deletion without mutating input', () => {
    const event = {
      ...basic,
      alerts: {
        'a/b~c': {
          description: 'Delete me',
          trigger: { '@type': 'OffsetTrigger', offset: '-PT15M' },
        },
      },
      recurrenceRule: { frequency: 'weekly', count: 4 },
      recurrenceOverrides: {
        '2026-10-17T10:00:00': {
          'alerts/a~1b~0c/trigger/offset': '-PT30M',
          'alerts/a~1b~0c/description': null,
          title: 'Changed',
          description: null,
        },
      },
    }
    const before = JSON.stringify(event)
    const components = calendar(jscalendarToIcs(event)).getAllSubcomponents('vevent')
    expect(components).toHaveLength(2)
    expect(components[0].getAllProperties('rdate')).toHaveLength(0)
    expect(components[1].getFirstPropertyValue('summary')).toBe('Changed')
    expect(components[1].getFirstProperty('dtstart')?.toICALString()).toBe(
      'DTSTART:20261017T100000Z'
    )
    expect(
      components[1].getFirstSubcomponent('valarm')?.getFirstProperty('trigger')?.toICALString()
    ).toContain('-PT30M')
    expect(components[1].getAllProperties('rrule')).toHaveLength(0)
    expect(JSON.stringify(event)).toBe(before)
  })

  it.each<JsonObject>([
    { 'missing/title': 'Bad' },
    { 'alerts/a/trigger/offset': '-PT5M', alerts: {} },
    { 'recurrenceRules/0/frequency': 'daily' },
    { 'title~2': 'Bad' },
    { '__proto__/polluted': true },
  ])('rejects an invalid PatchObject in its entirety', (patch) => {
    const event = {
      ...basic,
      alerts: { a: { trigger: { offset: '-PT15M' } } },
      recurrenceRules: [{ frequency: 'weekly' }],
    }
    expect(() => applyPatch(event, patch)).toThrow(/patch/i)
    expect(object(event.alerts).a).toEqual({ trigger: { offset: '-PT15M' } })
    expect(Object.hasOwn({}, 'polluted')).toBe(false)
  })

  it('allows whole-array replacement and safe literal __proto__ properties', () => {
    const patch = JSON.parse(
      '{"__proto__":{"polluted":true},"keywords":{"x":true},"recurrenceRules":null}'
    ) as JsonObject
    const result = applyPatch({ ...basic, recurrenceRules: [{ frequency: 'weekly' }] }, patch)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(Object.hasOwn({}, 'polluted')).toBe(false)
    expect(result.recurrenceRules).toBeUndefined()
    expect(
      applyPatch(basic, { recurrenceRules: [{ frequency: 'daily' }] }).recurrenceRules
    ).toEqual([{ frequency: 'daily' }])
  })

  it('distinguishes BYDAY/count membership from added dates and does not detach empty patches', () => {
    const output = jscalendarToIcs({
      ...basic,
      start: '2026-10-13T10:00:00',
      recurrenceRule: { frequency: 'monthly', count: 2, byDay: [{ day: 'tu', nthOfPeriod: 2 }] },
      recurrenceOverrides: {
        '2026-11-10T10:00:00': { title: 'Second' },
        '2026-11-11T10:00:00': {},
        '2026-12-08T10:00:00': { title: 'After count' },
      },
    })
    expect(master(output).getAllProperties('rdate')).toHaveLength(2)
    expect(calendar(output).getAllSubcomponents('vevent')).toHaveLength(3)
    expect(output).toContain('RDATE:20261208T100000Z')
    expect(output).not.toContain('RDATE:20261110T100000Z')
  })

  it('uses master DATE and timezone for recurrence IDs even if the instance changes type or zone', () => {
    const output = jscalendarToIcs({
      ...basic,
      showWithoutTime: true,
      duration: 'P1D',
      recurrenceRule: { frequency: 'daily', count: 3 },
      recurrenceOverrides: {
        '2026-10-11T10:00:00': {
          showWithoutTime: false,
          timeZone: 'America/New_York',
          start: '2026-10-11T12:00:00',
        },
      },
    })
    expect(output).toContain('RECURRENCE-ID;VALUE=DATE:20261011')
    expect(output).toContain('DTSTART;TZID=America/New_York:20261011T120000')
  })

  it('compares zoned recurrence UNTIL in local time at an ambiguous DST fold', () => {
    const output = jscalendarToIcs({
      ...basic,
      start: '2026-10-24T02:30:00',
      timeZone: 'Europe/Copenhagen',
      recurrenceRule: { frequency: 'daily', until: '2026-10-25T02:30:00' },
      recurrenceOverrides: { '2026-10-25T02:30:00': { title: 'Last occurrence' } },
    })
    expect(output).toContain('UNTIL=20261025T003000Z')
    expect(output).not.toContain('RDATE')
    expect(output).toContain('RECURRENCE-ID;TZID=Europe/Copenhagen:20261025T023000')
  })
})

const liveUrl = globalThis.process.env.CALINO_TEST_JMAP_URL
const liveUser = globalThis.process.env.CALINO_TEST_JMAP_USER
const livePass = globalThis.process.env.CALINO_TEST_JMAP_PASS

describe('live Stalwart CalDAV → JMAP → converter comparison', () => {
  it.skipIf(!liveUrl || !liveUser || !livePass)(
    'compares every paired fixture and saves captured JSCalendar responses',
    async () => {
      const fsSpecifier = 'node:fs/promises'
      const fs = (await import(/* @vite-ignore */ fsSpecifier)) as typeof import('node:fs/promises')
      const origin = new URL(liveUrl!).origin
      const authorization = `Basic ${globalThis.Buffer.from(`${liveUser}:${livePass}`).toString('base64')}`
      const headers = { Authorization: authorization }
      const sessionResponse = await fetch(new URL('/jmap/session', origin), { headers })
      expect(sessionResponse.ok).toBe(true)
      const session = object((await sessionResponse.json()) as JsonValue)
      const accountId =
        typeof object(session.primaryAccounts)['urn:ietf:params:jmap:calendars'] === 'string'
          ? object(session.primaryAccounts)['urn:ietf:params:jmap:calendars']
          : 'b'
      // Stalwart advertises its configured hostname (https://localhost/), which a
      // plain-HTTP dev server does not serve. Call the origin we were given.
      const api = new URL('/jmap/', origin).href
      // Vitest runs west/east in parallel. Separate UIDs, resources and captures
      // prevent concurrent PUTs from replacing each other's recurrence series.
      const project = globalThis.process.env.TZ === 'Europe/Copenhagen' ? 'east' : 'west'
      const failures: string[] = []
      for (const { name, event } of fixtures) {
        const uid = `${event.uid}.${project}.${globalThis.process.pid}`
        const original = readFixture(name).replaceAll(String(event.uid), uid)
        // Owned test resources only; do not touch the user's existing objects.
        const resource = new URL(
          `/dav/cal/admin%40example.org/default/jscal-to-ics-${name}-${project}-${globalThis.process.pid}.ics`,
          origin
        )
        let created = false
        try {
          const put = await fetch(resource, {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'text/calendar', 'If-None-Match': '*' },
            body: original,
          })
          created = put.ok
          expect(put.ok, `${name} CalDAV PUT`).toBe(true)
          const report = await fetch(new URL('./', resource), {
            method: 'REPORT',
            headers: { ...headers, Depth: '1', 'Content-Type': 'application/xml' },
            body: `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${uid}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
          })
          expect(report.ok, `${name} CalDAV REPORT`).toBe(true)
          expect(await report.text()).toContain(uid)
          const response = await fetch(api, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:calendars'],
              methodCalls: [['CalendarEvent/get', { accountId }, 'get']],
            }),
          })
          expect(response.ok, `${name} JMAP get`).toBe(true)
          const data = object((await response.json()) as JsonValue)
          const calls = Array.isArray(data.methodResponses) ? data.methodResponses : []
          const get = calls.find((call) => Array.isArray(call) && call[0] === 'CalendarEvent/get')
          const result = object(Array.isArray(get) ? get[1] : undefined)
          const events = Array.isArray(result.list) ? result.list : []
          const captured = events.map(object).find((candidate) => candidate.uid === uid)
          expect(captured, `${name} returned over JMAP`).toBeDefined()
          await fs.writeFile(
            `${globalThis.process.cwd()}/src/features/jmap/convert/__tests__/fixtures/stalwart-${name}-${project}.json`,
            `${JSON.stringify(captured, null, 2)}\n`
          )
          const converted = jscalendarToIcs(captured!)
          const returned = await fetch(resource, { headers })
          expect(returned.ok).toBe(true)
          const serverIcs = await returned.text()
          await fs.writeFile(
            `${globalThis.process.cwd()}/src/features/jmap/convert/__tests__/fixtures/stalwart-${name}-${project}.ics`,
            serverIcs
          )
          expect(semantic(converted), `${name}: server CalDAV GET`).toBe(semantic(serverIcs))
          expect(semantic(converted), `${name}: original fixture`).toBe(semantic(original))
        } catch (error) {
          failures.push(`${name}: ${(error as Error).message.slice(0, 160)}`)
        } finally {
          if (created) {
            const removed = await fetch(resource, { method: 'DELETE', headers })
            expect(removed.ok || removed.status === 404, `${name} cleanup`).toBe(true)
          }
        }
      }
      expect(failures).toEqual([])
    },
    120_000
  )

  const captures = import.meta.glob('./fixtures/stalwart-*.json', {
    eager: true,
    import: 'default',
  }) as Record<string, JSCalendarObject>
  it.each(Object.entries(captures))('replays captured response %s offline', (path, event) => {
    const name = path.replace('./fixtures/stalwart-', '').replace('.json', '')
    expect(semantic(jscalendarToIcs(event))).toBe(semantic(readFixture(`stalwart-${name}`)))
  })
})
