import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarBackend } from '@/features/caldav/client/CalendarBackend'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import { classifyPendingChangeError } from '@/features/caldav/sync/pendingChangePolicy'
import { encodeBase64 } from '@/lib/settingsSync'
import { JmapClient } from '../../client/JmapClient'
import {
  JMAP_CALENDARS,
  JMAP_PRINCIPALS,
  JMAP_PRINCIPALS_AVAILABILITY,
  type JsonObject,
} from '../../types'
import { jscalendarToIcs } from '../../convert/jscalendarToIcs'
import { createJmapCalendarBackend } from '../JmapCalendarBackend'
import { eventEtag } from '../eventData'
import { FakeJmapServer } from './fakeServer'
import { eventIcs } from './fixtures'

const origin = 'https://calendar.test'
const credentials = {
  id: 'credential',
  serverUrl: origin,
  username: 'owner@example.test',
  password: '',
}
const calUrl = `${origin}/.jmap/real-account/default/`
const start = '20261001T000000Z'
const end = '20261101T000000Z'

describe('JmapCalendarBackend wire boundary', () => {
  let server: FakeJmapServer
  let backend: CalendarBackend
  beforeEach(async () => {
    server = new FakeJmapServer()
    vi.stubGlobal('fetch', server.fetch)
    backend = await createJmapCalendarBackend(origin, credentials, null)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  function last(method: string): JsonObject {
    return server.calls.filter(([name]) => name === method).at(-1)![1]
  }

  it('connects using the actual session account and retains endpoint settings', async () => {
    expect(backend.protocol).toBe('jmap')
    expect(backend.getServerUrl()).toBe(origin)
    expect(backend.getProxyUrl()).toBeNull()
    await backend.connect()
    const calendars = await backend.fetchCalendars()
    expect(calendars[0]).toMatchObject({
      id: calUrl,
      url: calUrl,
      name: 'Default',
      color: '#AABBCC',
      syncToken: 'event-0',
      ctag: null,
      isVisible: true,
      isDefault: true,
      readOnly: false,
      isSubscribed: true,
      calendarOrder: 1,
      supportedComponents: ['VEVENT'],
    })
    expect(last('Calendar/get').accountId).toBe('real-account')
  })
  it('maps visibility, rights, subscription and supported capabilities', async () => {
    server.calendars.set('read-only', {
      id: 'read-only',
      name: 'Shared',
      isVisible: true,
      isSubscribed: false,
      myRights: { mayReadItems: true },
      sortOrder: 9,
    })
    const calendar = (await backend.fetchCalendars())[1]
    expect(calendar).toMatchObject({
      isVisible: false,
      isSubscribed: false,
      readOnly: true,
      calendarOrder: 9,
      supportedComponents: ['VEVENT'],
    })
    server.session.accounts[server.accountId].accountCapabilities['urn:ietf:params:jmap:tasks'] = {}
    await backend.connect()
    expect((await backend.fetchCalendars())[0].supportedComponents).toEqual(['VEVENT', 'VTODO'])
    server.session.accounts[server.accountId].isReadOnly = true
    await backend.connect()
    expect((await backend.fetchCalendars())[0].readOnly).toBe(true)
  })
  it('hashes canonical server JSON independently of key order, including hidden fields', () => {
    const a = { uid: 'x', nested: { b: 2, a: 1 }, array: [1, 2] }
    expect(eventEtag(a)).toBe(eventEtag({ array: [1, 2], nested: { a: 1, b: 2 }, uid: 'x' }))
    expect(eventEtag(a)).not.toBe(eventEtag({ ...a, hidden: true }))
    expect(eventEtag(a)).not.toBe(eventEtag({ ...a, array: [2, 1] }))
  })
  it('creates by server id, ignores the filename, and returns adapter-compatible ICS', async () => {
    const created = await backend.createEvent(calUrl, eventIcs(), 'ignored.ics')
    expect(created.url).toMatch(/\/event\d+$/)
    expect(created.etag).toMatch(/^"[a-f0-9]{64}"$/)
    const resource = (await backend.fetchResourceByHref(created.url))!
    expect(resource.etag).toBe(created.etag)
    const events = parseICALData(resource.data, 'calendar')
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]).toMatchObject({ id: 'original-uid', title: 'Team meeting' })
    expect(resource.data).toContain('RRULE:')
    expect(resource.data).toContain('ATTENDEE')
    expect(resource.data).toContain('BEGIN:VALARM')
    expect([...server.events.values()][0]).toMatchObject({
      uid: 'original-uid',
      calendarIds: { default: true },
      recurrenceRule: { frequency: 'weekly' },
    })
    expect(await backend.fetchEtag(created.url)).toBe(created.etag)
  })
  it('falls back to the older inCalendars filter when the server rejects inCalendar', async () => {
    server.legacyCalendarFilter = true
    server.seed({ id: 'legacy' })
    const result = await backend.fetchEvents(calUrl, start, end)
    expect(result.objects).toHaveLength(1)
    expect(last('CalendarEvent/query').filter).toMatchObject({ inCalendars: ['default'] })
  })
  it('queries by time range, pages results, honours includeAllEvents and handles empty lists', async () => {
    server.seed({ id: 'past', start: '2000-01-01T10:00:00' })
    for (let index = 0; index < 5; index++) server.seed({ id: `current-${index}` })
    const bounded = await backend.fetchEvents(calUrl, start, end)
    expect(bounded.objects).toHaveLength(5)
    expect(bounded.hadComponentFailures).toBe(false)
    expect(last('CalendarEvent/query').filter).toEqual({
      inCalendar: 'default',
      after: '2026-10-01T00:00:00Z',
      before: '2026-11-01T00:00:00Z',
    })
    const all = await backend.fetchEvents(calUrl, 'ignored', 'ignored', true)
    expect(all.objects).toHaveLength(6)
    expect(last('CalendarEvent/query').filter).toEqual({ inCalendar: 'default' })
    server.events.clear()
    expect(await backend.fetchEvents(calUrl, start, end)).toEqual({
      objects: [],
      hadComponentFailures: false,
    })
  })
  it('returns null and empty etag for missing or moved resources and rejects foreign URLs', async () => {
    expect(await backend.fetchResourceByHref(calUrl + 'absent')).toBeNull()
    expect(await backend.fetchEtag(calUrl + 'absent')).toBe('')
    server.seed({ id: 'elsewhere', calendarIds: { other: true } })
    expect(await backend.fetchResourceByHref(calUrl + 'elsewhere')).toBeNull()
    for (const href of [
      'https://other.test/.jmap/real-account/default/a',
      `${origin}/.jmap/wrong/default/a`,
      calUrl + 'a?bad=1',
      calUrl + 'a/b',
    ])
      await expect(backend.fetchResourceByHref(href)).rejects.toMatchObject({ status: 400 })
  })
  it('uses minimal PATCH updates and preserves server-only properties and participant ids', async () => {
    const id = server.seed({
      id: 'custom',
      title: 'Old',
      serverData: { retained: true },
      participants: {
        'server-id': {
          '@type': 'Participant',
          calendarAddress: 'mailto:guest@example.test',
          name: 'Guest',
          roles: { required: true },
          participationStatus: 'accepted',
          serverOnly: 42,
        },
      },
      recurrenceRule: { '@type': 'RecurrenceRule', frequency: 'weekly', count: 3 },
    })
    const original = (await backend.fetchResourceByHref(calUrl + id))!
    const data = original.data
      .replace('SUMMARY:Old', 'SUMMARY:New')
      .replace('CN=Guest', 'CN=Renamed')
    const result = await backend.updateEvent(calUrl, original.url, data, original.etag!)
    const patch = (last('CalendarEvent/set').update as JsonObject)[id]
    expect(patch).toEqual({ title: 'New', 'participants/server-id/name': 'Renamed' })
    expect(server.events.get(id)).toMatchObject({
      serverData: { retained: true },
      participants: { 'server-id': { name: 'Renamed', serverOnly: 42 } },
    })
    expect(result.etag).not.toBe(original.etag)
    expect(result.etag).toBe(await backend.fetchEtag(result.url))
  })
  it('does not rewrite an unchanged lossy projection and removes represented fields', async () => {
    const id = server.seed({
      description: 'Remove me',
      virtualLocations: { remote: { uri: 'https://meeting.test', serverOnly: true } },
      timeZones: { custom: 'kept' },
    })
    const original = (await backend.fetchResourceByHref(calUrl + id))!
    const before = server.calls.filter(([method]) => method === 'CalendarEvent/set').length
    await backend.updateEvent(calUrl, original.url, original.data, original.etag!)
    expect(server.calls.filter(([method]) => method === 'CalendarEvent/set')).toHaveLength(before)
    await backend.updateEvent(
      calUrl,
      original.url,
      original.data.replace(/DESCRIPTION:Remove me\r\n/, ''),
      original.etag!
    )
    expect((last('CalendarEvent/set').update as JsonObject)[id]).toEqual({ description: null })
    expect(server.events.get(id)?.timeZones).toEqual({ custom: 'kept' })
  })
  it('edits alarms, locations and attachments using original map ids and retains extensions', async () => {
    const id = server.seed({
      alerts: {
        serverAlarm: {
          '@type': 'Alert',
          action: 'display',
          trigger: {
            '@type': 'OffsetTrigger',
            offset: '-PT15M',
            relativeTo: 'start',
            serverTrigger: true,
          },
          serverAlert: true,
        },
      },
      locations: { room: { '@type': 'Location', name: 'Old room', serverLocation: true } },
      links: {
        file: {
          '@type': 'Link',
          href: 'https://files.test/old',
          rel: 'enclosure',
          serverLink: true,
        },
      },
    })
    const resource = (await backend.fetchResourceByHref(calUrl + id))!
    await backend.updateEvent(
      calUrl,
      resource.url,
      resource.data
        .replace('-PT15M', '-PT30M')
        .replace('Old room', 'New room')
        .replace('https://files.test/old', 'https://files.test/new'),
      resource.etag!
    )
    expect((last('CalendarEvent/set').update as JsonObject)[id]).toEqual({
      'alerts/serverAlarm/trigger/offset': '-PT30M',
      'locations/room/name': 'New room',
      'links/file/href': 'https://files.test/new',
    })
    expect(server.events.get(id)).toMatchObject({
      alerts: { serverAlarm: { serverAlert: true, trigger: { serverTrigger: true } } },
      locations: { room: { serverLocation: true } },
      links: { file: { serverLink: true } },
    })
  })
  it('removes an alarm without changing the remaining server identity', async () => {
    const id = server.seed({
      alerts: {
        first: {
          '@type': 'Alert',
          action: 'display',
          trigger: { '@type': 'OffsetTrigger', offset: '-PT15M', relativeTo: 'start' },
        },
        second: {
          '@type': 'Alert',
          action: 'display',
          trigger: { '@type': 'OffsetTrigger', offset: '-PT30M', relativeTo: 'start' },
          retained: true,
        },
      },
    })
    const resource = (await backend.fetchResourceByHref(calUrl + id))!
    const data = resource.data.replace(/BEGIN:VALARM\r\n[\s\S]*?END:VALARM\r\n/, '')
    await backend.updateEvent(calUrl, resource.url, data, resource.etag!)
    expect((last('CalendarEvent/set').update as JsonObject)[id]).toEqual({ 'alerts/first': null })
    expect(Object.keys(server.events.get(id)!.alerts as JsonObject)).toEqual(['second'])
  })
  it('paginates without total and rejects changed or nonadvancing query results', async () => {
    for (let index = 0; index < 4; index++) server.seed({ id: `paged${index}` })
    const invoke = server.invoke.bind(server)
    const spy = vi.spyOn(server, 'invoke').mockImplementation((method, args) => {
      const result = invoke(method, args)
      if (method === 'CalendarEvent/query') delete result.total
      return result
    })
    expect((await backend.fetchEvents(calUrl, '', '', true)).objects).toHaveLength(4)
    spy.mockImplementation((method, args) => {
      const result = invoke(method, args)
      if (method === 'CalendarEvent/query' && args.position !== 0) result.queryState = 'changed'
      return result
    })
    await expect(backend.fetchEvents(calUrl, '', '', true)).rejects.toMatchObject({ status: 412 })
    spy.mockImplementation((method, args) => {
      const result = invoke(method, args)
      if (method === 'CalendarEvent/query') result.position = 0
      return result
    })
    await expect(backend.fetchEvents(calUrl, '', '', true)).rejects.toMatchObject({
      type: 'invalidResponse',
    })
  })
  it('encodes synthetic identifiers and escapes calendarIds patch paths', async () => {
    const id = server.seed({ id: 'event/#?ø', calendarIds: { 'calendar/~ø': true, default: true } })
    const encodedCalendar = `${origin}/.jmap/real-account/${encodeURIComponent('calendar/~ø')}/`
    const href = encodedCalendar + encodeURIComponent(id)
    expect((await backend.fetchResourceByHref(href))!.url).toBe(href)
    await backend.deleteEvent(href, '')
    expect((last('CalendarEvent/set').update as JsonObject)[id]).toEqual({
      'calendarIds/calendar~1~0ø': null,
    })
    expect(server.events.get(id)!.calendarIds).toEqual({ default: true })
  })
  it('rejects stale etags on updates and deletes with CalDAV-compatible HTTP 412 errors', async () => {
    const event = await backend.createEvent(calUrl, eventIcs(), '')
    server.events.get(event.url.split('/').at(-1)!)!.title = 'Concurrent edit'
    await expect(
      backend.updateEvent(calUrl, event.url, eventIcs(), event.etag)
    ).rejects.toMatchObject({ status: 412, code: 'conflict', body: 'ETag mismatch' })
    await expect(backend.deleteEvent(event.url, event.etag)).rejects.toMatchObject({ status: 412 })
    const fresh = await backend.fetchEtag(event.url)
    await backend.updateEvent(calUrl, event.url, eventIcs('original-uid', 'Resolved'), fresh)
    await backend.deleteEvent(event.url, '')
    await backend.deleteEvent(event.url, fresh)
    expect(await backend.fetchResourceByHref(event.url)).toBeNull()
  })
  it('moves using a calendarIds patch and makes source cleanup harmless', async () => {
    const target = await backend.createCalendar({ name: 'Target' })
    const initial = await backend.syncCollection(calUrl, null)
    const created = await backend.createEvent(calUrl, eventIcs(), '')
    const moved = await backend.updateEvent(target.url, created.url, eventIcs(), created.etag)
    expect(moved.url.split('/').at(-1)).toBe(created.url.split('/').at(-1))
    const targetId = target.url.split('/').at(-2)!
    expect(
      (last('CalendarEvent/set').update as JsonObject)[created.url.split('/').at(-1)!]
    ).toEqual({ 'calendarIds/default': null, [`calendarIds/${targetId}`]: true })
    expect(await backend.fetchResourceByHref(created.url)).toBeNull()
    await backend.deleteEvent(created.url, created.etag)
    expect(await backend.fetchResourceByHref(moved.url)).not.toBeNull()
    const sourceChanges = await backend.syncCollection(calUrl, initial.newSyncToken)
    expect(sourceChanges.changes).toContainEqual({
      href: created.url,
      etag: null,
      status: 'removed',
    })
    const targetChanges = await backend.syncCollection(target.url, initial.newSyncToken)
    expect(targetChanges.changes).toContainEqual({
      href: moved.url,
      etag: moved.etag,
      status: 'changed',
    })
  })
  it('deletes only the addressed membership when an event is in multiple calendars', async () => {
    const id = server.seed({ calendarIds: { default: true, other: true } })
    await backend.deleteEvent(calUrl + id, '')
    expect(server.events.get(id)?.calendarIds).toEqual({ other: true })
  })
  it('creates, patches and deletes calendars including description and notFound deletion', async () => {
    const calendar = await backend.createCalendar({
      name: 'New',
      description: 'Description',
      color: '#123456',
      components: ['VEVENT'],
    })
    const id = calendar.url.split('/').at(-2)!
    expect(server.calendars.get(id)).toMatchObject({
      name: 'New',
      description: 'Description',
      color: '#123456',
    })
    await backend.updateCalendar(calendar.url, {
      name: 'Renamed',
      color: '#654321',
      description: '',
    })
    expect((last('Calendar/set').update as JsonObject)[id]).toEqual({
      name: 'Renamed',
      color: '#654321',
      description: '',
    })
    const count = server.calls.length
    await backend.updateCalendar(calendar.url, {})
    expect(server.calls).toHaveLength(count)
    await backend.deleteCalendar(calendar.url)
    await backend.deleteCalendar(calendar.url)
    expect(server.calendars.has(id)).toBe(false)
    await expect(
      backend.createCalendar({ name: 'Task', components: ['VTODO'] })
    ).rejects.toMatchObject({ status: 400 })
  })
  it('syncs initially, advances through hasMoreChanges pages and returns tombstones', async () => {
    const first = await backend.syncCollection(calUrl, null)
    expect(first).toEqual({ changes: [], newSyncToken: 'event-0', tokenInvalidated: false })
    const ids = Array.from({ length: 5 }, (_, index) => server.seed({ id: `e${index}` }))
    server.events.get(ids[0])!.title = 'Updated'
    server.change(ids[0], 'updated')
    server.events.delete(ids[1])
    server.change(ids[1], 'destroyed')
    const report = await backend.syncCollection(calUrl, first.newSyncToken)
    expect(report.newSyncToken).toBe(server.state())
    expect(report.tokenInvalidated).toBe(false)
    expect(report.changes).toHaveLength(5)
    expect(report.changes).toContainEqual({ href: calUrl + ids[1], etag: null, status: 'removed' })
    expect(server.calls.filter(([method]) => method === 'CalendarEvent/changes')).toHaveLength(4)
    expect(await backend.syncCollection(calUrl, report.newSyncToken)).toEqual({
      changes: [],
      newSyncToken: report.newSyncToken,
      tokenInvalidated: false,
    })
    const full = await backend.syncCollection(calUrl, null)
    expect(full.changes).toHaveLength(4)
  })
  it('invalidates cannotCalculateChanges and failures so callers perform a full resync', async () => {
    server.failMethod = {
      method: 'CalendarEvent/changes',
      error: { type: 'cannotCalculateChanges' },
    }
    expect(await backend.syncCollection(calUrl, 'expired')).toEqual({
      changes: [],
      newSyncToken: null,
      tokenInvalidated: true,
    })
    server.failMethod = null
    expect((await backend.syncCollection(calUrl, null)).tokenInvalidated).toBe(false)
    server.failMethod = { method: 'CalendarEvent/query', error: { type: 'serverFail' } }
    expect((await backend.syncCollection(calUrl, null)).tokenInvalidated).toBe(true)
  })
  it('does not miss writes between the initial state read and the collection query', async () => {
    const original = server.invoke.bind(server)
    vi.spyOn(server, 'invoke').mockImplementation((method, args) => {
      if (method === 'CalendarEvent/query' && server.events.size === 0)
        server.seed({ id: 'concurrent' })
      return original(method, args)
    })
    const initial = await backend.syncCollection(calUrl, null)
    expect(initial.newSyncToken).toBe('event-0')
    expect(initial.changes).toHaveLength(1)
    expect((await backend.syncCollection(calUrl, initial.newSyncToken)).changes).toHaveLength(1)
  })
  it('stores settings through title/description, extracts folded UTF-8 payloads and cleans up', async () => {
    expect(await backend.discoverSettingsCalendar('ignored')).toBeNull()
    const url = await backend.createSettingsCalendar('ignored')
    expect(await backend.discoverSettingsCalendar('ignored')).toEqual({ url })
    expect(await backend.fetchSettingsEvent(url)).toBeNull()
    const json = JSON.stringify({
      syncedAt: '2026-10-06T09:00:00.123Z',
      theme: '日本語🌻'.repeat(50),
    })
    const etag = await backend.putSettingsEvent(url, encodeBase64(json))
    const remote = (await backend.fetchSettingsEvent(url))!
    expect(remote.etag).toBe(etag)
    expect(remote.data).toContain('SUMMARY:Calino Settings')
    expect(remote.data).toContain('\r\n ')
    expect(remote.data).not.toContain('X-CALINO')
    expect(backend.extractSettingsFromVEVENT(remote.data)).toBe(json)
    expect(remote.dtstamp).toMatch(/^\d{8}T\d{6}Z$/)
    expect(parseICALData(remote.data, 'settings')).toEqual([])
    const nextJson = JSON.stringify({ syncedAt: '2026-10-07T09:00:00Z', theme: 'new' })
    const updated = await backend.putSettingsEvent(url, encodeBase64(nextJson), etag, remote)
    expect(updated).not.toBe(etag)
    expect(backend.extractSettingsFromVEVENT((await backend.fetchSettingsEvent(url))!.data)).toBe(
      nextJson
    )
    expect((await backend.fetchSettingsEvent(url))!.dtstamp).toBe('20261007T090000Z')
    expect(server.events.size).toBe(1)
    await expect(
      backend.putSettingsEvent(url, encodeBase64('stale'), etag, remote)
    ).rejects.toMatchObject({ status: 412 })
    await expect(backend.putSettingsEvent(url, 'bad\r\nSUMMARY:Injected')).rejects.toThrow(
      'Invalid base64'
    )
    await backend.deleteSettingsEvent(url)
    await backend.deleteSettingsEvent(url)
    expect(await backend.fetchSettingsEvent(url)).toBeNull()
    await backend.deleteSettingsCalendar(url)
    expect(await backend.discoverSettingsCalendar('ignored')).toBeNull()
  })
  it('ignores unrelated or invalid settings descriptions', () => {
    expect(backend.extractSettingsFromVEVENT('invalid')).toBeNull()
    expect(backend.extractSettingsFromVEVENT(eventIcs())).toBeNull()
    expect(
      backend.extractSettingsFromVEVENT(
        jscalendarToIcs({
          '@type': 'Event',
          uid: 'calino-settings',
          start: '1970-01-01T00:00:00',
          description: 'Calino settings v1:bad%%',
        })
      )
    ).toBeNull()
  })
  it('supports known-absent settings, optional etags and automatic rediscovery', async () => {
    const url = await backend.createSettingsCalendar('')
    await backend.putSettingsEvent(url, encodeBase64('{}'), undefined, null)
    const old = (await backend.fetchSettingsEvent(url))!
    await backend.putSettingsEvent(url, encodeBase64('{"changed":true}'))
    expect((await backend.fetchSettingsEvent(url))!.etag).not.toBe(old.etag)
  })
  it('returns unknown free/busy without availability support and detects identities', async () => {
    const from = new Date('2026-10-01T00:00:00Z'),
      to = new Date('2026-11-01T00:00:00Z')
    expect(await backend.supportsScheduling()).toBe(false)
    server.identities = [{ id: 'identity', calendarAddress: 'mailto:owner@example.test' }]
    expect(await backend.supportsScheduling()).toBe(true)
    expect(await backend.queryFreeBusy(calUrl, from, to)).toBeNull()
    expect(await backend.queryAttendeeFreeBusy('', '', ['guest@example.test'], from, to)).toBeNull()
    expect(await backend.queryAttendeeFreeBusy('', '', [], from, to)).toEqual(new Map())
    server.failMethod = { method: 'ParticipantIdentity/get', error: { type: 'unknownMethod' } }
    expect(await backend.supportsScheduling()).toBe(false)
  })
  it('honours scheduling capability flags', async () => {
    server.session.accounts[server.accountId].accountCapabilities[
      JMAP_CALENDARS
    ].supportsScheduling = true
    await backend.connect()
    expect(await backend.supportsScheduling()).toBe(true)
  })
  it('maps advertised principal availability and keeps unknown attendee results null', async () => {
    server.session.capabilities[JMAP_PRINCIPALS] = {}
    server.session.capabilities[JMAP_PRINCIPALS_AVAILABILITY] = {}
    await backend.connect()
    const from = new Date('2026-10-06T09:00:00Z'),
      to = new Date('2026-10-06T13:00:00Z')
    server.principals.set('owner@example.test', 'owner')
    server.principals.set('guest@example.test', 'guest')
    server.availability.set('owner', [
      { utcStart: '2026-10-06T10:00:00Z', utcEnd: '2026-10-06T11:00:00Z', busyStatus: 'busy' },
    ])
    server.availability.set('guest', [
      { utcStart: '2026-10-06T11:00:00Z', utcEnd: '2026-10-06T12:00:00Z', busyStatus: 'tentative' },
    ])
    expect(await backend.supportsScheduling()).toBe(true)
    expect(await backend.queryFreeBusy(calUrl, from, to)).toEqual([
      {
        start: new Date('2026-10-06T10:00:00Z'),
        end: new Date('2026-10-06T11:00:00Z'),
        type: 'BUSY',
      },
    ])
    const result = await backend.queryAttendeeFreeBusy(
      '',
      'owner@example.test',
      ['GUEST@example.test', 'missing@example.test'],
      from,
      to
    )
    expect(result!.get('guest@example.test')![0].type).toBe('BUSY-TENTATIVE')
    expect(result!.get('missing@example.test')).toBeNull()
    expect(server.requests.at(-1)!.using).toContain(JMAP_PRINCIPALS_AVAILABILITY)
    server.failMethod = { method: 'Principal/getAvailability', error: { type: 'forbidden' } }
    expect(await backend.queryFreeBusy(calUrl, from, to)).toBeNull()
    expect(
      (await backend.queryAttendeeFreeBusy('', '', ['guest@example.test'], from, to))!.get(
        'guest@example.test'
      )
    ).toBeNull()
  })
  it('uses the calendar owner principal instead of the authenticated user when provided', async () => {
    server.session.capabilities[JMAP_PRINCIPALS_AVAILABILITY] = {}
    server.calendars.get('default')!.ownerPrincipalId = 'shared-owner'
    server.availability.set('shared-owner', [
      {
        utcStart: '2026-10-06T11:00:00Z',
        utcEnd: '2026-10-06T12:00:00Z',
        busyStatus: 'unavailable',
      },
    ])
    await backend.connect()
    expect(
      (await backend.queryFreeBusy(
        calUrl,
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-11-01T00:00:00Z')
      ))![0].type
    ).toBe('BUSY-UNAVAILABLE')
    expect(last('Principal/getAvailability').id).toBe('shared-owner')
  })
  it('wraps push and returns unsubscribe, ignoring changes for other accounts', () => {
    const unsubscribe = vi.fn()
    const spy = vi.spyOn(JmapClient.prototype, 'openEventSource').mockReturnValue(unsubscribe)
    const callback = vi.fn()
    const stop = backend.watch!(callback)
    expect(spy.mock.calls[0][0]).toEqual(['Calendar', 'CalendarEvent'])
    spy.mock.calls[0][1]({ '@type': 'StateChange', changed: { other: { CalendarEvent: 's1' } } })
    expect(callback).not.toHaveBeenCalled()
    spy.mock.calls[0][1]({
      '@type': 'StateChange',
      changed: { 'real-account': { CalendarEvent: 's2' } },
    })
    expect(callback).toHaveBeenCalledOnce()
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it.each([
    ['forbidden', 403],
    ['overQuota', 507],
    ['serverFail', 500],
    ['stateMismatch', 412],
    ['invalidProperties', 400],
    ['alreadyExists', 409],
  ] as const)('maps per-object %s errors to HTTP %i', async (type, status) => {
    server.failSet = {
      type: 'CalendarEvent',
      operation: 'create',
      error: { type, description: 'Fake rejection' },
    }
    await expect(backend.createEvent(calUrl, eventIcs(), '')).rejects.toMatchObject({
      type,
      status,
      body: expect.any(String),
    })
  })
  it('maps update/calendar/delete set failures and propagates read failures', async () => {
    const created = await backend.createEvent(calUrl, eventIcs(), '')
    server.failSet = { type: 'CalendarEvent', operation: 'update', error: { type: 'forbidden' } }
    await expect(
      backend.updateEvent(calUrl, created.url, eventIcs('original-uid', 'Changed'), '')
    ).rejects.toMatchObject({ status: 403 })
    server.failSet = { type: 'CalendarEvent', operation: 'destroy', error: { type: 'serverFail' } }
    await expect(backend.deleteEvent(created.url, '')).rejects.toMatchObject({ status: 500 })
    server.failSet = { type: 'Calendar', operation: 'update', error: { type: 'forbidden' } }
    await expect(backend.updateCalendar(calUrl, { name: 'Changed' })).rejects.toMatchObject({
      status: 403,
    })
    server.failMethod = { method: 'CalendarEvent/query', error: { type: 'serverUnavailable' } }
    try {
      await backend.fetchEvents(calUrl, start, end)
      throw new Error('Expected failure')
    } catch (error) {
      expect(error).toMatchObject({ status: 503 })
      expect(classifyPendingChangeError(error, 'update')).toBeDefined()
    }
  })
})
