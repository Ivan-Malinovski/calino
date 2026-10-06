import ICAL from 'ical.js'
import type { CalendarBackend } from '@/features/caldav/client/CalendarBackend'
import {
  normalizeColor,
  type FetchEventsResult,
  type SyncCollectionResult,
} from '@/features/caldav/client/CalDAVClient'
import type {
  CalDAVCalendar,
  CalDAVCredentials,
  CreateCalendarOptions,
  UpdateCalendarOptions,
} from '@/features/caldav/types'
import type { FreeBusyPeriod } from '@/lib/freeBusyCalculator'
import { decodeBase64 } from '@/lib/settingsSync'
import { JmapClient, type JmapStateChange } from '../client/JmapClient'
import { JmapError, methodError } from '../client/errors'
import { isJsonObject } from '../convert/jscalendarDiff'
import { icsToJscalendar } from '../convert/icsToJscalendar'
import { jscalendarToIcs } from '../convert/jscalendarToIcs'
import {
  JMAP_CALENDARS,
  JMAP_PRINCIPALS,
  JMAP_PRINCIPALS_AVAILABILITY,
  type JsonObject,
  type JSCalendarObject,
} from '../types'
import { eventEtag, eventPatch } from './eventData'

const SETTINGS_NAME = 'Calino Settings'
const SETTINGS_UID = 'calino-settings'
const SETTINGS_PREFIX = 'Calino settings v1:'
function string(value: unknown): string {
  if (typeof value !== 'string')
    throw new JmapError('Invalid JMAP response', { type: 'invalidResponse' })
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new JmapError('Invalid JMAP id list', { type: 'invalidResponse' })
  return value
}
function list(value: unknown): JsonObject[] {
  if (!Array.isArray(value) || !value.every((item) => isJsonObject(item)))
    throw new JmapError('Invalid JMAP object list', { type: 'invalidResponse' })
  return value
}
function utc(value: string): string {
  const expanded = value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1-$2-$3T$4:$5:$6Z'
  )
  return new Date(expanded).toISOString().replace('.000Z', 'Z')
}

export class JmapCalendarBackend implements CalendarBackend {
  readonly protocol = 'jmap' as const
  private client: JmapClient
  private serverUrl: string
  private proxyUrl: string | null
  constructor(serverUrl: string, credentials: CalDAVCredentials, proxyUrl: string | null = null) {
    this.serverUrl = serverUrl
    this.proxyUrl = proxyUrl
    this.client = new JmapClient({ ...credentials, serverUrl, proxyUrl })
  }
  async connect(): Promise<void> {
    await this.client.connect()
    void this.client.accountId
  }
  getServerUrl(): string {
    return this.serverUrl
  }
  getProxyUrl(): string | null {
    return this.proxyUrl
  }
  private calendarUrl(id: string): string {
    return `${new URL(this.serverUrl).origin}/.jmap/${encodeURIComponent(this.client.accountId)}/${encodeURIComponent(id)}/`
  }
  private parseUrl(href: string, event = false): { calendarId: string; eventId: string } {
    const url = new URL(href)
    const prefix = `/.jmap/${encodeURIComponent(this.client.accountId)}/`
    if (
      url.origin !== new URL(this.serverUrl).origin ||
      !url.pathname.startsWith(prefix) ||
      url.search ||
      url.hash
    )
      throw new JmapError('Resource is outside this JMAP account', {
        type: 'invalidArguments',
        status: 400,
      })
    const parts = url.pathname.slice(prefix.length).split('/')
    if (parts.length !== 2 || !parts[0] || (event ? !parts[1] : !!parts[1]))
      throw new JmapError('Invalid synthetic JMAP resource URL', {
        type: 'invalidArguments',
        status: 400,
      })
    return { calendarId: decodeURIComponent(parts[0]), eventId: decodeURIComponent(parts[1]) }
  }
  private async call(method: string, args: JsonObject = {}, using?: string[]): Promise<JsonObject> {
    const response = await this.client.call(
      [[method, { accountId: this.client.accountId, ...args }, 'backend']],
      using
    )
    const result = response.methodResponses.find(
      ([name, , id]) => name === method && id === 'backend'
    )
    if (!result)
      throw new JmapError('JMAP response omitted method result', { type: 'invalidResponse' })
    return result[1]
  }
  private async set(
    type: 'Calendar' | 'CalendarEvent',
    operation: 'create' | 'update' | 'destroy',
    id: string,
    value?: JsonObject
  ): Promise<JsonObject> {
    const args: JsonObject =
      operation === 'destroy' ? { destroy: [id] } : { [operation]: { [id]: value! } }
    if (type === 'Calendar' && operation === 'destroy') args.onDestroyRemoveEvents = true
    const result = await this.call(`${type}/set`, args)
    const failureMap =
      result[{ create: 'notCreated', update: 'notUpdated', destroy: 'notDestroyed' }[operation]]
    const failure = isJsonObject(failureMap) ? failureMap[id] : undefined
    if (isJsonObject(failure)) {
      if (operation === 'destroy' && failure.type === 'notFound') return result
      const error = methodError(failure, `${type}/set`, 'backend')
      if (failure.type === 'invalidProperties')
        throw new JmapError(error.message, {
          type: 'invalidProperties',
          status: 400,
          details: failure,
          body: error.body,
        })
      if (failure.type === 'alreadyExists')
        throw new JmapError(error.message, {
          type: 'alreadyExists',
          status: 409,
          details: failure,
          body: error.body,
        })
      throw error
    }
    const success =
      result[{ create: 'created', update: 'updated', destroy: 'destroyed' }[operation]]
    if (
      operation === 'destroy'
        ? !Array.isArray(success) || !success.includes(id)
        : !isJsonObject(success) || !Object.hasOwn(success, id)
    )
      throw new JmapError('JMAP set response omitted operation outcome', {
        type: 'invalidResponse',
      })
    return result
  }
  private calendar(value: JsonObject, state: string): CalDAVCalendar {
    const url = this.calendarUrl(string(value.id))
    const rights = isJsonObject(value.myRights) ? value.myRights : null
    const taskCapability = Object.keys({
      ...this.client.capabilities,
      ...this.client.accountCapabilities,
    }).some((key) => /:tasks$/.test(key))
    return {
      id: url,
      url,
      name: typeof value.name === 'string' ? value.name : 'Unnamed Calendar',
      color: normalizeColor(typeof value.color === 'string' ? value.color : null),
      ctag: state,
      syncToken: state,
      isVisible: value.isVisible !== false && value.isSubscribed !== false,
      isDefault: value.isDefault === true,
      isSubscribed: value.isSubscribed === true,
      readOnly:
        this.client.session.accounts[this.client.accountId].isReadOnly ||
        (rights !== null &&
          !['mayAddItems', 'mayModifyItems', 'mayRemoveItems'].some((key) => rights[key] === true)),
      calendarOrder: typeof value.sortOrder === 'number' ? value.sortOrder : undefined,
      supportedComponents: taskCapability ? ['VEVENT', 'VTODO'] : ['VEVENT'],
    }
  }
  async fetchCalendars(): Promise<CalDAVCalendar[]> {
    const result = await this.call('Calendar/get', { ids: null })
    return list(result.list).map((value) => this.calendar(value, string(result.state)))
  }
  private inCalendarList = false
  private async query(calendarId: string, filter: JsonObject = {}): Promise<string[]> {
    const ids: string[] = []
    let state: string | undefined
    while (true) {
      const send = (inCalendar: JsonObject) =>
        this.call('CalendarEvent/query', {
          filter: { ...inCalendar, ...filter },
          position: ids.length,
          calculateTotal: true,
        })
      // Current JMAP Calendars drafts (and Stalwart) filter by `inCalendar: Id`;
      // older drafts used `inCalendars: Id[]`. Stalwart answers the old form with
      // unsupportedFilter, so remember whichever one the server accepts.
      let result: JsonObject
      try {
        result = await send(
          this.inCalendarList ? { inCalendars: [calendarId] } : { inCalendar: calendarId }
        )
      } catch (error) {
        if (
          this.inCalendarList ||
          !(error instanceof JmapError) ||
          error.type !== 'unsupportedFilter'
        )
          throw error
        this.inCalendarList = true
        result = await send({ inCalendars: [calendarId] })
      }
      const page = strings(result.ids)
      if (result.position !== ids.length || page.some((id) => ids.includes(id)))
        throw new JmapError('Invalid JMAP query pagination', { type: 'invalidResponse' })
      if (state !== undefined && result.queryState !== state)
        throw new JmapError('JMAP query changed while paging (HTTP 412)', {
          type: 'stateMismatch',
          status: 412,
        })
      state = string(result.queryState)
      ids.push(...page)
      if (!page.length || (typeof result.total === 'number' && ids.length >= result.total))
        return ids
    }
  }
  private async events(ids: string[]): Promise<JSCalendarObject[]> {
    if (!ids.length) return []
    return list((await this.call('CalendarEvent/get', { ids })).list)
  }
  private member(event: JSCalendarObject, calendarId: string): boolean {
    return isJsonObject(event.calendarIds) && event.calendarIds[calendarId] === true
  }
  private resource(event: JSCalendarObject, calendarId: string) {
    return {
      url: this.calendarUrl(calendarId) + encodeURIComponent(string(event.id)),
      data: jscalendarToIcs(event),
      etag: eventEtag(event),
    }
  }
  async fetchEvents(
    calendarUrl: string,
    start: string,
    end: string,
    includeAllEvents = false
  ): Promise<FetchEventsResult> {
    const { calendarId } = this.parseUrl(calendarUrl)
    const ids = await this.query(
      calendarId,
      includeAllEvents ? {} : { after: utc(start), before: utc(end) }
    )
    return {
      objects: (await this.events(ids))
        .filter((event) => this.member(event, calendarId))
        .map((event) => this.resource(event, calendarId)),
      hadComponentFailures: false,
    }
  }
  async fetchResourceByHref(href: string) {
    const { calendarId, eventId } = this.parseUrl(href, true)
    const [event] = await this.events([eventId])
    return event && this.member(event, calendarId) ? this.resource(event, calendarId) : null
  }
  async fetchEtag(eventUrl: string): Promise<string> {
    return (await this.fetchResourceByHref(eventUrl))?.etag ?? ''
  }
  private convert(ics: string): JSCalendarObject {
    const { event } = icsToJscalendar(ics)
    if (event['@type'] !== 'Event')
      throw new JmapError('JMAP CalendarEvent supports VEVENT only', {
        type: 'invalidProperties',
        status: 400,
      })
    return event
  }
  async createEvent(calendarUrl: string, iCalString: string, filename: string) {
    void filename // JMAP assigns the id; the DAV filename has no wire equivalent.
    const { calendarId } = this.parseUrl(calendarUrl)
    const result = await this.set('CalendarEvent', 'create', 'event', {
      ...this.convert(iCalString),
      calendarIds: { [calendarId]: true },
    })
    const created = isJsonObject(result.created) ? result.created.event : undefined
    const id = isJsonObject(created) ? string(created.id) : string(undefined)
    const url = this.calendarUrl(calendarId) + encodeURIComponent(id)
    return { url, etag: await this.fetchEtag(url) }
  }
  private conflict(): never {
    throw new JmapError('JMAP event changed: HTTP 412 Precondition Failed', {
      type: 'stateMismatch',
      status: 412,
      body: 'ETag mismatch',
    })
  }
  async updateEvent(calendarUrl: string, eventUrl: string, iCalString: string, etag: string) {
    const target = this.parseUrl(calendarUrl)
    const source = this.parseUrl(eventUrl, true)
    const [previous] = await this.events([source.eventId])
    if (!previous || !this.member(previous, source.calendarId))
      throw methodError({ type: 'notFound' }, 'CalendarEvent/get', 'backend')
    if (etag && eventEtag(previous) !== etag) this.conflict()
    const calendarIds = { ...(isJsonObject(previous.calendarIds) ? previous.calendarIds : {}) }
    if (target.calendarId !== source.calendarId) delete calendarIds[source.calendarId]
    Object.defineProperty(calendarIds, target.calendarId, {
      value: true,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    const patch = eventPatch(previous, { ...this.convert(iCalString), calendarIds })
    if (Object.keys(patch).length) await this.set('CalendarEvent', 'update', source.eventId, patch)
    const url = this.calendarUrl(target.calendarId) + encodeURIComponent(source.eventId)
    return { url, etag: await this.fetchEtag(url) }
  }
  async deleteEvent(eventUrl: string, etag: string): Promise<void> {
    const { calendarId, eventId } = this.parseUrl(eventUrl, true)
    const [previous] = await this.events([eventId])
    // A stale source href after an atomic move is already gone from that collection.
    if (!previous || !this.member(previous, calendarId)) return
    if (etag && eventEtag(previous) !== etag) this.conflict()
    const calendars = isJsonObject(previous.calendarIds) ? previous.calendarIds : {}
    if (Object.entries(calendars).some(([id, member]) => id !== calendarId && member === true)) {
      await this.set('CalendarEvent', 'update', eventId, {
        [`calendarIds/${calendarId.replace(/~/g, '~0').replace(/\//g, '~1')}`]: null,
      })
    } else await this.set('CalendarEvent', 'destroy', eventId)
  }
  async createCalendar(options: CreateCalendarOptions): Promise<CalDAVCalendar> {
    if (options.components?.some((component) => component !== 'VEVENT'))
      throw new JmapError('JMAP task calendars are not implemented', {
        type: 'invalidProperties',
        status: 400,
      })
    const result = await this.set('Calendar', 'create', 'calendar', {
      name: options.name,
      ...(options.color !== undefined ? { color: options.color } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
    })
    const created = isJsonObject(result.created) ? result.created.calendar : undefined
    const id = isJsonObject(created) ? string(created.id) : string(undefined)
    const fetched = await this.call('Calendar/get', { ids: [id] })
    const [calendar] = list(fetched.list)
    if (!calendar) throw methodError({ type: 'notFound' }, 'Calendar/get', 'backend')
    return this.calendar(calendar, string(fetched.state))
  }
  async updateCalendar(calendarUrl: string, options: UpdateCalendarOptions): Promise<void> {
    const { calendarId } = this.parseUrl(calendarUrl)
    const patch: JsonObject = {}
    for (const key of ['name', 'color', 'description'] as const)
      if (options[key] !== undefined) patch[key] = options[key]
    if (Object.keys(patch).length) await this.set('Calendar', 'update', calendarId, patch)
  }
  async deleteCalendar(calendarUrl: string): Promise<void> {
    await this.set('Calendar', 'destroy', this.parseUrl(calendarUrl).calendarId)
  }
  async syncCollection(
    collectionUrl: string,
    syncToken: string | null
  ): Promise<SyncCollectionResult> {
    const { calendarId } = this.parseUrl(collectionUrl)
    try {
      if (syncToken === null) {
        // Capture before listing: concurrent changes are safely replayed next time.
        const state = string((await this.call('CalendarEvent/get', { ids: [] })).state)
        const events = await this.events(await this.query(calendarId))
        return {
          changes: events
            .filter((event) => this.member(event, calendarId))
            .map((event) => ({
              href: this.resource(event, calendarId).url,
              etag: eventEtag(event),
              status: 'changed' as const,
            })),
          newSyncToken: state,
          tokenInvalidated: false,
        }
      }
      const changed = new Set<string>()
      const destroyed = new Set<string>()
      let state = syncToken
      while (true) {
        const result = await this.call('CalendarEvent/changes', { sinceState: state })
        for (const id of [...strings(result.created), ...strings(result.updated)]) {
          changed.add(id)
          destroyed.delete(id)
        }
        for (const id of strings(result.destroyed)) {
          destroyed.add(id)
          changed.delete(id)
        }
        const next = string(result.newState)
        if (result.hasMoreChanges && next === state)
          throw new JmapError('JMAP changes cursor did not advance', { type: 'invalidResponse' })
        state = next
        if (!result.hasMoreChanges) break
      }
      const events = new Map(
        (await this.events([...changed])).map((event) => [string(event.id), event])
      )
      const changes = [...new Set([...changed, ...destroyed])].map((id) => {
        const event = events.get(id)
        const present = event && this.member(event, calendarId)
        return {
          href: this.calendarUrl(calendarId) + encodeURIComponent(id),
          etag: present ? eventEtag(event) : null,
          status: present ? ('changed' as const) : ('removed' as const),
        }
      })
      return { changes, newSyncToken: state, tokenInvalidated: false }
    } catch {
      return { changes: [], newSyncToken: null, tokenInvalidated: true }
    }
  }
  async discoverSettingsCalendar(calendarHomeUrl: string): Promise<{ url: string } | null> {
    void calendarHomeUrl // Calendar/get already targets the session account.
    const calendar = (await this.fetchCalendars()).find(
      (calendar) => calendar.name === SETTINGS_NAME
    )
    return calendar ? { url: calendar.url } : null
  }
  async createSettingsCalendar(calendarHomeUrl: string): Promise<string> {
    void calendarHomeUrl
    return (
      await this.createCalendar({
        name: SETTINGS_NAME,
        description: 'Calino settings sync',
        color: '#808080',
      })
    ).url
  }
  async fetchSettingsEvent(settingsCalendarUrl: string) {
    const { calendarId } = this.parseUrl(settingsCalendarUrl)
    const event = (await this.events(await this.query(calendarId))).find(
      (event) => event.uid === SETTINGS_UID && this.member(event, calendarId)
    )
    if (!event) return null
    const resource = this.resource(event, calendarId)
    // Stalwart's updated field is DTSTAMP and does not advance on every edit.
    // Settings already carry their conflict timestamp in the serialized payload.
    let dtstamp = ''
    try {
      const payload = JSON.parse(this.extractSettingsFromVEVENT(resource.data) ?? '{}')
      if (typeof payload.syncedAt === 'string')
        dtstamp = utc(payload.syncedAt)
          .replace(/\.\d+Z$/, 'Z')
          .replace(/[-:]/g, '')
    } catch {
      // An invalid payload is handled by the settings consumer, not a fake date.
    }
    return {
      data: resource.data,
      href: resource.url,
      etag: resource.etag,
      dtstamp,
    }
  }
  extractSettingsFromVEVENT(icalData: string): string | null {
    try {
      const calendar = new ICAL.Component(ICAL.parse(icalData))
      const event = calendar
        .getAllSubcomponents('vevent')
        .find((event) => event.getFirstPropertyValue('uid') === SETTINGS_UID)
      const description = event?.getFirstPropertyValue('description')
      if (typeof description !== 'string' || !description.startsWith(SETTINGS_PREFIX)) return null
      return decodeBase64(description.slice(SETTINGS_PREFIX.length))
    } catch {
      return null
    }
  }
  async putSettingsEvent(
    settingsCalendarUrl: string,
    base64Payload: string,
    etag?: string,
    existingEvent?: { href: string; etag: string } | null
  ): Promise<string> {
    if (!/^[A-Za-z0-9+/=]*$/.test(base64Payload))
      throw new Error('Invalid base64 payload for settings sync')
    const data = jscalendarToIcs({
      '@type': 'Event',
      uid: SETTINGS_UID,
      title: SETTINGS_NAME,
      description: SETTINGS_PREFIX + base64Payload,
      start: '1970-01-01T00:00:00',
      timeZone: 'UTC',
      duration: 'PT1S',
      privacy: 'private',
      freeBusyStatus: 'free',
      updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    })
    const existing =
      existingEvent === undefined
        ? await this.fetchSettingsEvent(settingsCalendarUrl)
        : existingEvent
    return (
      existing
        ? await this.updateEvent(settingsCalendarUrl, existing.href, data, etag ?? existing.etag)
        : await this.createEvent(settingsCalendarUrl, data, '')
    ).etag
  }
  async deleteSettingsEvent(settingsCalendarUrl: string): Promise<void> {
    const event = await this.fetchSettingsEvent(settingsCalendarUrl)
    if (event) await this.deleteEvent(event.href, event.etag)
  }
  async deleteSettingsCalendar(settingsCalendarUrl: string): Promise<void> {
    await this.deleteCalendar(settingsCalendarUrl)
  }
  private capability(name: string): boolean {
    return !!(this.client.capabilities[name] || this.client.accountCapabilities[name])
  }
  async supportsScheduling(): Promise<boolean> {
    try {
      if (this.capability(JMAP_PRINCIPALS_AVAILABILITY)) return true
      for (const name of [JMAP_CALENDARS, JMAP_PRINCIPALS]) {
        const capability = this.client.accountCapabilities[name] ?? this.client.capabilities[name]
        if (
          capability?.supportsScheduling === true ||
          capability?.maySendSchedulingMessages === true
        )
          return true
      }
      return list((await this.call('ParticipantIdentity/get', { ids: null })).list).length > 0
    } catch {
      return false
    }
  }
  private async principalForEmail(email: string): Promise<string | null> {
    const result = await this.call(
      'Principal/query',
      { filter: { email: email.replace(/^mailto:/i, '') } },
      [JMAP_CALENDARS, JMAP_PRINCIPALS]
    )
    return strings(result.ids)[0] ?? null
  }
  private async availability(
    principalId: string,
    start: Date,
    end: Date
  ): Promise<FreeBusyPeriod[] | null> {
    const result = await this.call(
      'Principal/getAvailability',
      {
        id: principalId,
        utcStart: utc(start.toISOString()),
        utcEnd: utc(end.toISOString()),
        showDetails: false,
      },
      [JMAP_CALENDARS, JMAP_PRINCIPALS, JMAP_PRINCIPALS_AVAILABILITY]
    )
    if (!Array.isArray(result.list)) return null
    return list(result.list).map((period) => {
      const from = new Date(string(period.utcStart))
      const to = new Date(string(period.utcEnd))
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from)
        throw new Error('Invalid availability period')
      return {
        start: from,
        end: to,
        type:
          period.busyStatus === 'unavailable'
            ? ('BUSY-UNAVAILABLE' as const)
            : period.busyStatus === 'tentative'
              ? ('BUSY-TENTATIVE' as const)
              : period.busyStatus === 'free'
                ? ('FREE' as const)
                : ('BUSY' as const),
      }
    })
  }
  async queryFreeBusy(
    calendarUrl: string,
    start: Date,
    end: Date
  ): Promise<FreeBusyPeriod[] | null> {
    if (!this.capability(JMAP_PRINCIPALS_AVAILABILITY)) return null
    try {
      const { calendarId } = this.parseUrl(calendarUrl)
      const calendar = list((await this.call('Calendar/get', { ids: [calendarId] })).list)[0]
      const principalId =
        typeof calendar?.ownerPrincipalId === 'string'
          ? calendar.ownerPrincipalId
          : await this.principalForEmail(this.client.username)
      return principalId ? await this.availability(principalId, start, end) : null
    } catch {
      return null
    }
  }
  async queryAttendeeFreeBusy(
    _outboxUrl: string,
    _organizerEmail: string,
    attendeeEmails: string[],
    start: Date,
    end: Date
  ): Promise<Map<string, FreeBusyPeriod[] | null> | null> {
    if (!attendeeEmails.length) return new Map()
    if (!this.capability(JMAP_PRINCIPALS_AVAILABILITY)) return null
    const entries = await Promise.all(
      attendeeEmails.map(async (email): Promise<[string, FreeBusyPeriod[] | null]> => {
        try {
          const id = await this.principalForEmail(email)
          return [email.toLowerCase(), id ? await this.availability(id, start, end) : null]
        } catch {
          return [email.toLowerCase(), null]
        }
      })
    )
    return new Map(entries)
  }
  watch(onChange: (change: JmapStateChange) => void): () => void {
    return this.client.openEventSource(['Calendar', 'CalendarEvent'], (change) => {
      if (change.changed[this.client.accountId]) onChange(change)
    })
  }
}
export async function createJmapCalendarBackend(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null = null
): Promise<CalendarBackend> {
  const backend = new JmapCalendarBackend(serverUrl, credentials, proxyUrl)
  await backend.connect()
  return backend
}
