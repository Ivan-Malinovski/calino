import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import { writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import type { JsonObject, JsonValue, JSCalendarObject } from '../../types'
import { icsToJscalendar } from '../icsToJscalendar'
import { applyJmapPatch, isJsonObject } from '../jscalendarDiff'
import { eventToICAL, eventsToICAL } from '../../../caldav/adapter/iCalendarAdapter'
import type { CalendarEvent } from '@/types'

const fixtureUrls = import.meta.glob('./fixtures-ics/*.ics', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const fixture = (name: string) => fixtureUrls[`./fixtures-ics/${name}.ics`]
const convert = (name: string) => icsToJscalendar(fixture(name)).event
function event(lines: string[], type = 'VEVENT', extra = ''): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${extra}BEGIN:${type}\r\nUID:test@example.org\r\n${lines.join('\r\n')}\r\nEND:${type}\r\nEND:VCALENDAR\r\n`
}
function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new Error('Expected JSON object')
  return value
}

describe('icsToJscalendar', () => {
  it('converts weekly COUNT, typed nested objects and scheduling in draft vocabulary', () => {
    const result = icsToJscalendar(fixture('weekly-count'))
    expect(result.uid).toBe('write-weekly-count@example.org')
    expect(result.event).toMatchObject({
      '@type': 'Event',
      uid: result.uid,
      title: 'Weekly sync',
      description: 'Hello\nworld',
      start: '2026-10-10T10:00:00',
      timeZone: 'Europe/Copenhagen',
      duration: 'PT1H',
      organizerCalendarAddress: 'mailto:admin@example.org',
      recurrenceRule: {
        '@type': 'RecurrenceRule',
        frequency: 'weekly',
        count: 4,
        firstDayOfWeek: 'su',
        byDay: [
          { '@type': 'NDay', day: 'mo' },
          { '@type': 'NDay', day: 'we' },
        ],
      },
    })
    expect(Object.values(object(result.event.participants))).toContainEqual({
      '@type': 'Participant',
      calendarAddress: 'mailto:bob@example.org',
      name: 'Bob',
      participationStatus: 'needs-action',
      expectReply: true,
      roles: { required: true },
    })
    for (const key of [
      'id',
      'calendarIds',
      'isDraft',
      'isOrigin',
      'X-CALINO-FOO',
      'sendTo',
      'recurrenceRules',
    ])
      expect(result.event).not.toHaveProperty(key)
  })
  it('uses RFC 8984 recurrenceRules, sendTo, email, replyTo and participant-id delegation', () => {
    const converted = icsToJscalendar(fixture('attendees'), {
      vocabulary: 'rfc8984',
      calendarIds: { b: true },
    }).event
    expect(converted.replyTo).toEqual({ imip: 'mailto:alice@example.org' })
    expect(converted.calendarIds).toEqual({ b: true })
    const people = object(converted.participants)
    const group = Object.values(people)
      .map(object)
      .find((person) => person.email === 'group@example.org')!
    for (const key of Object.keys(object(group.delegatedTo))) expect(people).toHaveProperty(key)
    expect(converted).not.toHaveProperty('organizerCalendarAddress')
    const weekly = icsToJscalendar(fixture('weekly-count'), {
      vocabulary: 'rfc8984',
    }).event
    expect(weekly.recurrenceRules).toEqual([convert('weekly-count').recurrenceRule])
    expect(weekly).not.toHaveProperty('recurrenceRule')
  })
  it('maps ordinals and every BY part without conflating BYSETPOS with BYDAY', () => {
    expect(convert('monthly-ordinal').recurrenceRule).toEqual({
      '@type': 'RecurrenceRule',
      frequency: 'monthly',
      interval: 2,
      firstDayOfWeek: 'mo',
      count: 6,
      byDay: [
        { '@type': 'NDay', day: 'tu', nthOfPeriod: 2 },
        { '@type': 'NDay', day: 'fr', nthOfPeriod: -1 },
      ],
      bySetPosition: [1, -1],
    })
    expect(convert('yearly').recurrenceRule).toMatchObject({
      frequency: 'yearly',
      byMonth: ['10'],
      byMonthDay: [10],
      byYearDay: [283],
      byWeekNo: [41],
      byHour: [14],
      byMinute: [0],
      bySecond: [0],
    })
  })
  it.each([
    ['until-zoned', '2026-11-01T10:00:00'],
    ['until-new-york', '2026-11-10T10:00:00'],
    ['until-utc', '2026-11-01T14:00:00'],
    ['all-day', '2026-11-01T00:00:00'],
    ['floating', '2026-11-01T10:00:00'],
  ])('converts %s UNTIL into the master clock', (name, until) => {
    expect(object(convert(name).recurrenceRule).until).toBe(until)
  })
  it('keeps all-day end exclusive, UTC explicit, and floating time independent of host zone', () => {
    expect(convert('all-day')).toMatchObject({
      start: '2026-10-10T00:00:00',
      duration: 'P3D',
      showWithoutTime: true,
      timeZone: null,
    })
    expect(convert('utc')).toMatchObject({
      start: '2026-10-10T14:00:00',
      timeZone: 'UTC',
      duration: 'PT1H',
    })
    expect(convert('floating')).toMatchObject({
      start: '2026-10-10T10:00:00',
      timeZone: null,
      duration: 'PT1H',
    })
    expect(icsToJscalendar(event(['DTSTART;VALUE=DATE:20261010'])).event.duration).toBe('P1D')
    expect(icsToJscalendar(event(['DTSTART:20261010T100000'])).event.duration).toBe('PT0S')
    expect(
      icsToJscalendar(event(['DTSTART;VALUE=DATE:20261010', 'DURATION:P1W'])).event.duration
    ).toBe('P7D')
  })
  it('computes zoned elapsed durations across DST and different end zones', () => {
    expect(
      icsToJscalendar(
        event([
          'DTSTART;TZID=Europe/Copenhagen:20261025T010000',
          'DTEND;TZID=Europe/Copenhagen:20261025T040000',
        ])
      ).event.duration
    ).toBe('PT4H')
    expect(
      icsToJscalendar(
        event([
          'DTSTART;TZID=America/New_York:20261010T100000',
          'DTEND;TZID=Europe/Copenhagen:20261010T170000',
        ])
      ).event.duration
    ).toBe('PT1H')
  })
  it('maps Windows aliases and VTIMEZONE X-LIC-LOCATION', () => {
    expect(
      icsToJscalendar(
        event(['DTSTART;TZID="Eastern Standard Time":20261010T100000', 'DURATION:PT1H'])
      ).event.timeZone
    ).toBe('America/New_York')
    const zone =
      'BEGIN:VTIMEZONE\r\nTZID:Company/Copenhagen\r\nX-LIC-LOCATION:Europe/Copenhagen\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n'
    expect(
      icsToJscalendar(
        event(['DTSTART;TZID=Company/Copenhagen:20261010T100000', 'DURATION:PT1H'], 'VEVENT', zone)
      ).event
    ).toMatchObject({
      start: '2026-10-10T10:00:00',
      timeZone: 'Europe/Copenhagen',
    })
  })
  it('uses embedded offsets for unresolved custom zones, and rejects zones with no data', () => {
    const zone =
      'BEGIN:VTIMEZONE\r\nTZID:Company/Custom\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0530\r\nTZOFFSETTO:+0530\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n'
    expect(
      icsToJscalendar(
        event(
          [
            'DTSTART;TZID=Company/Custom:20261010T100000',
            'DTEND;TZID=Company/Custom:20261010T110000',
          ],
          'VEVENT',
          zone
        )
      ).event
    ).toMatchObject({
      start: '2026-10-10T04:30:00',
      timeZone: 'UTC',
      duration: 'PT1H',
    })
    expect(() => icsToJscalendar(event(['DTSTART;TZID=Company/Custom:20261010T100000']))).toThrow(
      'Cannot resolve TZID'
    )
  })
  it('combines RDATE, period RDATE, EXDATE and minimal detached patches', () => {
    const converted = convert('overrides')
    const overrides = object(converted.recurrenceOverrides)
    expect(overrides['2026-10-17T10:00:00']).toEqual({ excluded: true })
    expect(overrides['2026-11-07T10:00:00']).toEqual({})
    expect(overrides['2026-11-14T10:00:00']).toEqual({
      start: '2026-11-14T10:00:00',
      duration: 'PT2H',
    })
    expect(overrides['2026-10-31T10:00:00']).toEqual({})
    const changed = object(overrides['2026-10-24T10:00:00'])
    expect(changed.title).toBe('Moved')
    expect(changed.start).toBe('2026-10-24T12:00:00')
    expect(Object.keys(changed)).toHaveLength(3)
    expect(Object.entries(changed)).toContainEqual([
      expect.stringMatching(/^alerts\/weekly-alarm\/trigger\/offset$/),
      '-PT30M',
    ])
    expect(applyJmapPatch({ ...converted, start: '2026-10-24T10:00:00' }, changed)).toMatchObject({
      title: 'Moved',
      start: '2026-10-24T12:00:00',
    })
  })
  it('deletes omitted alarms and turns a cancelled detached component into an exclusion', () => {
    const base = fixture('overrides')
    const calendar = new ICAL.Component(ICAL.parse(base))
    const detached = calendar.getAllSubcomponents('vevent')[1]
    detached.removeAllSubcomponents('valarm')
    const converted = icsToJscalendar(calendar.toString()).event
    const changed = object(object(converted.recurrenceOverrides)['2026-10-24T10:00:00'])
    expect(changed.alerts).toBeNull()
    detached.updatePropertyWithValue('status', 'CANCELLED')
    detached.removeAllProperties('dtstart')
    expect(
      object(icsToJscalendar(calendar.toString()).event.recurrenceOverrides)['2026-10-24T10:00:00']
    ).toEqual({ excluded: true })
  })
  it('normalizes UTC exclusions to the master zone and gives EXDATE precedence', () => {
    const converted = icsToJscalendar(
      event([
        'DTSTART;TZID=Europe/Copenhagen:20261010T100000',
        'DURATION:PT1H',
        'RDATE;TZID=Europe/Copenhagen:20261017T100000',
        'EXDATE:20261017T080000Z',
      ])
    ).event
    expect(converted.recurrenceOverrides).toEqual({
      '2026-10-17T10:00:00': { excluded: true },
    })
  })
  it('maps three alarms with relative start/end, absolute trigger, UID and acknowledgement', () => {
    const converted = convert('alarms')
    expect(Object.keys(object(converted.alerts))).toEqual(['start-alarm', 'end-alarm', 'a2'])
    expect(Object.values(object(converted.alerts))).toEqual([
      {
        '@type': 'Alert',
        acknowledged: '2026-10-06T12:00:00Z',
        action: 'display',
        trigger: {
          '@type': 'OffsetTrigger',
          offset: '-PT15M',
          relativeTo: 'start',
        },
      },
      {
        '@type': 'Alert',
        action: 'email',
        trigger: {
          '@type': 'OffsetTrigger',
          offset: 'PT5M',
          relativeTo: 'end',
        },
      },
      {
        '@type': 'Alert',
        action: 'display',
        trigger: { '@type': 'AbsoluteTrigger', when: '2026-10-10T13:00:00Z' },
      },
    ])
  })
  it('maps text, links, geo, keywords, formal categories and metadata; drops extensions/EXRULE', () => {
    const converted = convert('metadata')
    expect(converted).toMatchObject({
      title: 'Møde, café; plan\\ning',
      description:
        'Første linje\nAnden linje med en meget lang tekst derfortsætter på en foldet linje.',
      locations: {
        l0: {
          '@type': 'Location',
          name: 'Kontor, 2. sal',
          coordinates: 'geo:55.6761,12.5683',
        },
      },
      keywords: { work: true, 'team,nordic': true },
      categories: {
        'https://example.org/concepts/meeting': true,
        'tag:example.org:2026:planning': true,
      },
      priority: 3,
      privacy: 'secret',
      freeBusyStatus: 'free',
      status: 'tentative',
      sequence: 7,
      created: '2026-09-01T10:00:00Z',
      updated: '2026-10-06T12:00:00Z',
      color: 'blue',
      relatedTo: {
        'sibling@example.org': {
          '@type': 'Relation',
          relation: { sibling: true },
        },
      },
    })
    expect(Object.values(object(converted.links))).toEqual([
      {
        '@type': 'Link',
        href: 'https://example.org/meeting',
        rel: 'describedby',
      },
      {
        '@type': 'Link',
        href: 'https://example.org/agenda.pdf',
        rel: 'enclosure',
        contentType: 'application/pdf',
      },
      {
        '@type': 'Link',
        href: 'data:text/plain;base64,SGVsbG8=',
        rel: 'enclosure',
        contentType: 'text/plain',
      },
    ])
    expect(converted).not.toHaveProperty('excludedRecurrenceRules')
    expect(JSON.stringify(converted)).not.toContain('do not send')
  })
  it('merges organizer and attendee roles and uses addresses for draft delegation', () => {
    const people = Object.values(object(convert('attendees').participants)).map(object)
    expect(
      people.find((person) => person.calendarAddress === 'mailto:alice@example.org')
    ).toMatchObject({ roles: { owner: true, chair: true } })
    expect(
      people.find((person) => person.calendarAddress === 'mailto:room@example.org')
    ).toMatchObject({
      roles: { required: true },
      kind: 'location',
      expectReply: false,
    })
    expect(
      people.find((person) => person.calendarAddress === 'mailto:group@example.org')
    ).toMatchObject({
      roles: { informational: true },
      kind: 'group',
      participationStatus: 'delegated',
      delegatedTo: {
        'mailto:bob@example.org': true,
        'mailto:delegate@example.org': true,
      },
      delegatedFrom: { 'mailto:alice@example.org': true },
    })
  })
  it('returns identical JSON and stable keys across repeated conversions', () => {
    for (const ics of Object.values(fixtureUrls))
      expect(icsToJscalendar(ics)).toEqual(icsToJscalendar(ics))
    const initial = convert('attendees')
    const renamed = icsToJscalendar(fixture('attendees').replace('CN=Bob', 'CN=Robert')).event
    expect(Object.keys(object(initial.participants))).toEqual(
      Object.keys(object(renamed.participants))
    )
  })
  it('supports Task due, progress, percentComplete and estimatedDuration', () => {
    expect(
      icsToJscalendar(
        event(
          [
            'DTSTART:20261010T100000Z',
            'DUE:20261011T100000Z',
            'DURATION:PT2H',
            'SUMMARY:Task',
            'STATUS:IN-PROCESS',
            'PERCENT-COMPLETE:40',
          ],
          'VTODO'
        )
      ).event
    ).toMatchObject({
      '@type': 'Task',
      start: '2026-10-10T10:00:00',
      due: '2026-10-11T10:00:00',
      timeZone: 'UTC',
      percentComplete: 40,
      progress: 'in-process',
      estimatedDuration: 'PT2H',
    })
    expect(
      icsToJscalendar(event(['SUMMARY:Undated', 'STATUS:NEEDS-ACTION'], 'VTODO')).event
    ).toEqual({
      '@type': 'Task',
      uid: 'test@example.org',
      title: 'Undated',
      progress: 'needs-action',
    })
  })
  it('rejects malformed resources and changes that need splitting rather than losing data', () => {
    expect(() => icsToJscalendar(event(['SUMMARY:No start']))).toThrow('DTSTART')
    expect(() =>
      icsToJscalendar(event(['DTSTART:20261010T110000Z', 'DTEND:20261010T100000Z']))
    ).toThrow('precedes')
    expect(() =>
      icsToJscalendar(
        fixture('overrides').replace('RECURRENCE-ID;TZID', 'RECURRENCE-ID;RANGE=THISANDFUTURE;TZID')
      )
    ).toThrow('splitting')
    expect(() =>
      icsToJscalendar(
        fixture('overrides').replace('UID:write-overrides@example.org', 'UID:another')
      )
    ).toThrow('share')
    expect(() =>
      icsToJscalendar(event(['DTSTART:20261010T100000Z', 'RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY']))
    ).toThrow('one RRULE')
  })
  it('converts real Calino-generated iCalendar and detached groups', () => {
    const master: CalendarEvent = {
      id: 'calino-master',
      uid: 'calino-uid',
      calendarId: 'cal-1',
      title: 'Café sync',
      description: 'Line one\nLine two',
      location: 'Office',
      start: '2026-10-10T10:00:00',
      end: '2026-10-10T11:00:00',
      timezone: 'Europe/Copenhagen',
      isAllDay: false,
      recurrence: { frequency: 'weekly', interval: 1, count: 4 },
      reminders: [{ id: 'r1', minutesBefore: 15, method: 'popup' }],
      categories: ['work'],
      concepts: ['https://example.org/work'],
    }
    const converted = icsToJscalendar(eventToICAL(master)).event
    expect(converted).toMatchObject({
      uid: 'calino-uid',
      title: 'Café sync',
      start: '2026-10-10T10:00:00',
      timeZone: 'Europe/Copenhagen',
      duration: 'PT1H',
      keywords: { work: true },
    })
    const detached: CalendarEvent = {
      ...master,
      id: 'calino-detached',
      title: 'Moved',
      start: '2026-10-17T12:00:00',
      end: '2026-10-17T13:00:00',
      recurrence: undefined,
      recurrenceId: '2026-10-17T10:00:00',
      recurrenceMasterId: master.id,
    }
    const group = icsToJscalendar(eventsToICAL([master, detached])).event
    expect(object(group.recurrenceOverrides)['2026-10-17T10:00:00']).toMatchObject({
      title: 'Moved',
      start: '2026-10-17T12:00:00',
    })
  })
})

// Captures are only produced by the opt-in live test; never manufacture server evidence.
const captures = import.meta.glob('./fixtures-ics/*.stalwart.json', {
  eager: true,
  import: 'default',
}) as Record<string, JSCalendarObject>
for (const [path, capture] of Object.entries(captures)) {
  it(`matches captured Stalwart projection: ${path}`, () => {
    expect(normalize(convert(path.split('/').pop()!.replace('.stalwart.json', '')))).toEqual(
      normalize(capture)
    )
  })
}

/** Ignore defaults/server metadata and canonicalize generated map ids, including override paths. */
function normalize(input: JSCalendarObject): JSCalendarObject {
  const result = structuredClone(input)
  for (const key of [
    'id',
    'calendarIds',
    'isDraft',
    'isOrigin',
    'created',
    'updated',
    'prodId',
    'version',
  ])
    delete result[key]
  const defaults: Record<string, JsonValue> = {
    title: '',
    description: '',
    descriptionContentType: 'text/plain',
    showWithoutTime: false,
    timeZone: null,
    status: 'confirmed',
    privacy: 'public',
    freeBusyStatus: 'busy',
    priority: 0,
    sequence: 0,
    useDefaultAlerts: false,
  }
  for (const [key, value] of Object.entries(defaults)) if (result[key] === value) delete result[key]
  const ids = new Map<string, string>()
  for (const field of ['participants', 'locations', 'alerts', 'links']) {
    if (!isJsonObject(result[field])) continue
    const entries = Object.entries(result[field]).sort((a, b) => {
      const sorted = (value: JsonValue): JsonValue =>
        Array.isArray(value)
          ? value.map(sorted)
          : isJsonObject(value)
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, sorted(value[key])])
              )
            : value
      const value = (entry: [string, JsonValue]) => JSON.stringify(sorted(entry[1]))
      return value(a).localeCompare(value(b))
    })
    const map: JsonObject = {}
    for (const [index, [key, value]] of entries.entries()) {
      const newKey = `k${index}`
      ids.set(`${field}/${key}`, `${field}/${newKey}`)
      map[newKey] = value
    }
    result[field] = map
  }
  const rule = isJsonObject(result.recurrenceRule) ? result.recurrenceRule : undefined
  if (rule) {
    for (const [key, value] of Object.entries({
      interval: 1,
      firstDayOfWeek: 'mo',
      rscale: 'gregorian',
      skip: 'omit',
    }))
      if (rule[key] === value) delete rule[key]
  }
  const overrides = isJsonObject(result.recurrenceOverrides)
    ? result.recurrenceOverrides
    : undefined
  if (overrides)
    for (const [date, entry] of Object.entries(overrides)) {
      if (!isJsonObject(entry)) continue
      const patch: JsonObject = {}
      for (const [path, value] of Object.entries(entry)) {
        let rewritten = path
        for (const [oldId, newId] of ids)
          if (path.startsWith(oldId + '/')) rewritten = newId + path.slice(oldId.length)
        patch[rewritten] = value
      }
      overrides[date] = patch
    }
  return result
}

function occurrences(ics: string): string[] {
  const components = new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent')
  const master = components.find((component) => !component.hasProperty('recurrence-id'))
  if (!master) throw new Error('Missing master VEVENT')
  const series = new ICAL.Event(master)
  for (const component of components)
    if (component !== master) series.relateException(new ICAL.Event(component))
  const iterator = series.iterator()
  const result: string[] = []
  for (let i = 0; i < 12; i++) {
    const next = iterator.next()
    if (!next) break
    const occurrence = series.getOccurrenceDetails(next)
    result.push(
      JSON.stringify({
        start: occurrence.startDate.toString(),
        end: occurrence.endDate.toString(),
        title: occurrence.item.summary ?? '',
        description: occurrence.item.description ?? '',
        location: occurrence.item.location ?? '',
      })
    )
    if (!series.isRecurring()) break
  }
  return result
}

/**
 * Differences between our output and Stalwart's own conversion that are not
 * bugs: nested @type is optional, `relativeTo: start` is the default, Stalwart
 * spells UTC as Etc/UTC, upper-cases relation names, keeps one delegate (JMAP
 * delegation is single-valued there) and mangles inline data: links. Overrides
 * are compared by recurrence expansion and by the CalDAV round trip instead.
 */
function liveNormalize(input: JSCalendarObject): JSCalendarObject {
  const strip = (value: JsonValue, depth: number): JsonValue => {
    if (Array.isArray(value)) return value.map((item) => strip(item, depth + 1))
    if (!isJsonObject(value)) return value
    const result: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === '@type' && depth > 0) continue
      if (key === 'relativeTo' && item === 'start') continue
      if (['delegatedTo', 'delegatedFrom', 'recurrenceOverrides'].includes(key)) continue
      if (key === 'timeZone' && item === 'Etc/UTC') {
        result[key] = 'UTC'
        continue
      }
      result[key] = strip(item, depth + 1)
    }
    if (typeof result.href === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(result.href))
      delete result.href
    if (typeof result.href === 'string' && result.href.startsWith('data:')) delete result.href
    if (isJsonObject(result.roles)) {
      delete result.roles.required
      if (!Object.keys(result.roles).length) delete result.roles
    }
    if (isJsonObject(result.relation))
      result.relation = Object.fromEntries(
        Object.entries(result.relation).map(([key, item]) => [key.toLowerCase(), item])
      )
    return result
  }
  return strip(normalize(input), 0) as JSCalendarObject
}

const liveUrl = globalThis.process.env.CALINO_TEST_JMAP_URL
const liveUser = globalThis.process.env.CALINO_TEST_JMAP_USER
const livePass = globalThis.process.env.CALINO_TEST_JMAP_PASS
it.skipIf(!liveUrl || !liveUser || !livePass)(
  'live Stalwart: CalDAV → JMAP, authored JSON → CalDAV, vendor rejection',
  async () => {
    const auth = 'Basic ' + Buffer.from(`${liveUser}:${livePass}`).toString('base64')
    const origin = new URL(liveUrl!).origin
    const davHome =
      globalThis.process.env.CALINO_TEST_JMAP_DAV_HOME ??
      `${origin}/dav/cal/admin%40example.org/default/`
    async function request(
      url: string,
      method: string,
      body?: string,
      contentType = 'application/json'
    ): Promise<string> {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: auth,
          'Content-Type': contentType,
          ...(method === 'REPORT' ? { Depth: '1' } : {}),
        },
        body,
      })
      const data = await response.text()
      if (!response.ok) throw new Error(`${method} ${url}: HTTP ${response.status}: ${data}`)
      return data
    }
    const session = JSON.parse(await request(`${origin}/jmap/session`, 'GET')) as {
      primaryAccounts: Record<string, string>
    }
    const accountId = session.primaryAccounts['urn:ietf:params:jmap:calendars']
    async function jmap(method: string, args: JsonObject): Promise<JsonObject> {
      const response = JSON.parse(
        await request(
          `${origin}/jmap/`,
          'POST',
          JSON.stringify({
            using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:calendars'],
            methodCalls: [[method, { accountId, ...args }, 'c']],
          })
        )
      ) as { methodResponses: [string, JsonObject, string][] }
      expect(response.methodResponses[0][0]).toBe(method)
      return response.methodResponses[0][1]
    }
    async function davEvent(uid: string): Promise<string> {
      const xml = await request(
        davHome,
        'REPORT',
        `<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${uid}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
        'application/xml'
      )
      const parsed = new DOMParser().parseFromString(xml, 'application/xml')
      const data = parsed.getElementsByTagNameNS(
        'urn:ietf:params:xml:ns:caldav',
        'calendar-data'
      )[0]?.textContent
      expect(data).toBeTruthy()
      return data!
    }
    const calendars = (await jmap('Calendar/get', { ids: null })).list as { id: string }[]
    const calendarId = calendars[0].id
    const failures: string[] = []
    const differing = (a: JsonValue, b: JsonValue, at = ''): string[] => {
      if (isJsonObject(a) && isJsonObject(b))
        return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
          differing(a[key], b[key], `${at}/${key}`)
        )
      return JSON.stringify(a) === JSON.stringify(b)
        ? []
        : [`${at}: ours=${JSON.stringify(a)} server=${JSON.stringify(b)}`]
    }
    for (const [path, original] of Object.entries(fixtureUrls)) {
      const token = `calino-write-${globalThis.crypto.randomUUID()}-${path.split('/').pop()!.replace('.ics', '')}`
      const oldUid = icsToJscalendar(original).uid
      const ics = original.replaceAll(oldUid, token)
      const href = `${davHome}${token}.ics`
      const destroy: string[] = []
      let stored = false
      try {
        await request(href, 'PUT', ics, 'text/calendar')
        stored = true
        const list = (await jmap('CalendarEvent/get', {})).list as JSCalendarObject[]
        const baseline = list.find((entry) => entry.uid === token)
        expect(baseline, path).toBeDefined()
        const ours = icsToJscalendar(ics).event
        const diff = differing(liveNormalize(ours), liveNormalize(baseline!))
        if (diff.length)
          throw new Error(`differs from Stalwart's own conversion:\n  ${diff.join('\n  ')}`)
        if (globalThis.process.env.CALINO_TEST_JMAP_CAPTURE === '1') {
          const capture = { ...baseline!, uid: oldUid }
          writeFileSync(
            new URL(path.replace('.ics', '.stalwart.json'), import.meta.url),
            JSON.stringify(capture, null, 2) + '\n'
          )
        }
        const createdUid = `${token}-created`
        const response = await jmap('CalendarEvent/set', {
          create: { c: { ...ours, uid: createdUid, calendarIds: { [calendarId]: true } } },
        })
        expect(response.notCreated, path).toBeUndefined()
        destroy.push(object(object(response.created).c).id as string)
        const returnedIcs = await davEvent(createdUid)
        const roundTrip = differing(
          liveNormalize({ ...icsToJscalendar(returnedIcs).event, uid: token }),
          liveNormalize(ours)
        )
        if (roundTrip.length)
          throw new Error(
            `round trip through Stalwart changed the event:\n  ${roundTrip.join('\n  ')}`
          )
        // Check recurrence expansion independently with ical.js, rather than solely
        // comparing two outputs from the converter under test.
        let expected: string[] | undefined
        try {
          expected = occurrences(ics)
        } catch {
          // ical.js cannot expand some over-constrained selectors (BYYEARDAY with BYMONTH).
        }
        if (expected) expect(occurrences(returnedIcs), path).toEqual(expected)
      } catch (error) {
        failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (destroy.length) await jmap('CalendarEvent/set', { destroy })
        if (stored) await request(href, 'DELETE')
      }
    }
    expect(failures).toEqual([])
    const response = await jmap('CalendarEvent/set', {
      create: {
        invalid: {
          '@type': 'Event',
          uid: `calino-vendor-${Date.now()}`,
          start: '2026-10-10T10:00:00',
          duration: 'PT1H',
          calendarIds: { [calendarId]: true },
          'example.org/unknown': 'test',
        },
      },
    })
    const unexpected = isJsonObject(response.created) ? response.created.invalid : undefined
    if (isJsonObject(unexpected)) await jmap('CalendarEvent/set', { destroy: [unexpected.id] })
    const invalid = object(object(response.notCreated).invalid)
    expect(invalid.type).toBe('invalidProperties')
    expect(invalid.properties).toContain('example.org/unknown')
  },
  120_000
)
