import { applyJmapPatch, isJsonObject } from '../../convert/jscalendarDiff'
import { JMAP_CALENDARS, JMAP_CORE, type JsonObject } from '../../types'
import type { JmapInvocation, JmapSession } from '../../client/session'

/** Stateful wire-level fake; real JmapClient authentication/batching stays in use. */
export class FakeJmapServer {
  accountId = 'real-account'
  calendars = new Map<string, JsonObject>()
  events = new Map<string, JsonObject>()
  calls: JmapInvocation[] = []
  /** Behave like a server that does not know `sendSchedulingMessages`. */
  rejectSchedulingArg = false
  requests: { using: string[]; methodCalls: JmapInvocation[] }[] = []
  history: { id: string; kind: 'created' | 'updated' | 'destroyed' }[] = []
  calendarState = 0
  queryPageSize = 2
  changesPageSize = 2
  /** Emulates a server that only knows the older `inCalendars` list filter. */
  legacyCalendarFilter = false
  failMethod: { method: string; error: JsonObject } | null = null
  failSet: { type: string; operation: 'create' | 'update' | 'destroy'; error: JsonObject } | null =
    null
  identities: JsonObject[] = []
  principals = new Map<string, string>()
  availability = new Map<string, JsonObject[]>()
  sequence = 0
  session: JmapSession
  constructor() {
    this.session = {
      capabilities: {
        [JMAP_CORE]: { maxCallsInRequest: 4, maxObjectsInGet: 2, maxObjectsInSet: 2 },
        [JMAP_CALENDARS]: {},
      },
      accounts: {
        [this.accountId]: {
          name: 'Fake',
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: { [JMAP_CALENDARS]: {} },
        },
      },
      primaryAccounts: { [JMAP_CALENDARS]: this.accountId },
      username: 'owner@example.test',
      apiUrl: 'https://localhost/jmap/api',
      uploadUrl: '/upload/{accountId}',
      downloadUrl: '/download/{accountId}/{blobId}/{name}?type={type}',
      eventSourceUrl: '/events?types={types}&closeafter={closeafter}&ping={ping}',
      state: 'session-1',
    }
    this.calendars.set('default', {
      id: 'default',
      name: 'Default',
      color: '#aabbccff',
      isVisible: true,
      isSubscribed: true,
      isDefault: true,
      sortOrder: 1,
      myRights: {
        mayReadItems: true,
        mayAddItems: true,
        mayModifyItems: true,
        mayRemoveItems: true,
      },
    })
  }
  state(): string {
    return `event-${this.history.length}`
  }
  change(id: string, kind: 'created' | 'updated' | 'destroyed') {
    this.history.push({ id, kind })
  }
  seed(event: JsonObject): string {
    const id = typeof event.id === 'string' ? event.id : `event${++this.sequence}`
    this.events.set(
      id,
      structuredClone({
        '@type': 'Event',
        uid: id,
        title: 'Seed',
        start: '2026-10-06T10:00:00',
        timeZone: 'UTC',
        duration: 'PT1H',
        calendarIds: { default: true },
        ...event,
        id,
      })
    )
    this.change(id, 'created')
    return id
  }
  fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method !== 'POST')
      return this.json(this.session, 'https://calendar.test/jmap/session')
    const request = JSON.parse(String(init.body)) as {
      using: string[]
      methodCalls: JmapInvocation[]
    }
    this.requests.push(request)
    const methodResponses: JmapInvocation[] = request.methodCalls.map(([method, args, callId]) => {
      this.calls.push([method, args, callId])
      if (args.accountId !== this.accountId) return ['error', { type: 'accountNotFound' }, callId]
      if (
        method === 'CalendarEvent/changes' &&
        (!/^event-\d+$/.test(String(args.sinceState)) ||
          Number(String(args.sinceState).slice(6)) > this.history.length)
      )
        return ['error', { type: 'cannotCalculateChanges' }, callId]
      if (
        this.legacyCalendarFilter &&
        method === 'CalendarEvent/query' &&
        isJsonObject(args.filter) &&
        !Array.isArray(args.filter.inCalendars)
      )
        return ['error', { type: 'unsupportedFilter', description: 'inCalendar' }, callId]
      if (this.failMethod?.method === method) return ['error', this.failMethod.error, callId]
      if (this.rejectSchedulingArg && 'sendSchedulingMessages' in args)
        return ['error', { type: 'invalidArguments' }, callId]
      try {
        return [method, this.invoke(method, args), callId]
      } catch {
        return ['error', { type: 'invalidArguments' }, callId]
      }
    })
    return this.json({ methodResponses, sessionState: this.session.state })
  }
  private json(value: unknown, url?: string): Response {
    const response = new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
    })
    if (url) Object.defineProperty(response, 'url', { value: url })
    return response
  }
  invoke(method: string, args: JsonObject): JsonObject {
    const [type, operation] = method.split('/')
    const store = type === 'Calendar' ? this.calendars : this.events
    if (method === 'ParticipantIdentity/get')
      return { list: this.identities, state: 'identities-1' }
    if (method === 'Principal/query') {
      const filter = isJsonObject(args.filter) ? args.filter : {}
      const id = this.principals.get(String(filter.email).toLowerCase())
      return { ids: id ? [id] : [], queryState: 'principals-1' }
    }
    if (method === 'Principal/getAvailability')
      return { list: this.availability.get(String(args.id)) ?? [] }
    if (operation === 'get') {
      const ids = args.ids === null ? [...store.keys()] : (args.ids as string[])
      return {
        accountId: this.accountId,
        state: type === 'Calendar' ? `calendar-${this.calendarState}` : this.state(),
        list: ids.flatMap((id) => (store.has(id) ? [store.get(id)!] : [])),
        notFound: ids.filter((id) => !store.has(id)),
      }
    }
    if (method === 'CalendarEvent/query') {
      const filter = isJsonObject(args.filter) ? args.filter : {}
      const members = Array.isArray(filter.inCalendars)
        ? (filter.inCalendars as string[])
        : [filter.inCalendar as string]
      const ids = [...this.events]
        .filter(([, event]) => {
          if (
            !isJsonObject(event.calendarIds) ||
            !members.some((id) => isJsonObject(event.calendarIds) && event.calendarIds[id])
          )
            return false
          // Recurring events deliberately stay in range: production relies on server expansion.
          if (event.recurrenceRule) return true
          const start = new Date(String(event.start) + 'Z').getTime()
          const duration = /^PT(\d+)H$/.exec(String(event.duration))
          const end = start + (duration ? Number(duration[1]) * 3600000 : 0)
          return (
            (!filter.after || end > Date.parse(String(filter.after))) &&
            (!filter.before || start < Date.parse(String(filter.before)))
          )
        })
        .map(([id]) => id)
      const position = Number(args.position) || 0
      return {
        ids: ids.slice(position, position + this.queryPageSize),
        position,
        total: ids.length,
        queryState: this.state(),
        canCalculateChanges: true,
      }
    }
    if (method === 'CalendarEvent/changes') {
      const match = /^event-(\d+)$/.exec(String(args.sinceState))
      if (!match || Number(match[1]) > this.history.length) {
        // Method-level errors are generated in the fetch layer below.
        throw new Error('bad state')
      }
      const from = Number(match[1])
      const to = Math.min(from + this.changesPageSize, this.history.length)
      const latest = new Map(this.history.slice(from, to).map((item) => [item.id, item.kind]))
      return {
        oldState: args.sinceState,
        newState: `event-${to}`,
        hasMoreChanges: to < this.history.length,
        created: [...latest].filter(([, kind]) => kind === 'created').map(([id]) => id),
        updated: [...latest].filter(([, kind]) => kind === 'updated').map(([id]) => id),
        destroyed: [...latest].filter(([, kind]) => kind === 'destroyed').map(([id]) => id),
      }
    }
    if (operation === 'set') {
      const result: JsonObject = {
        oldState: type === 'Calendar' ? `calendar-${this.calendarState}` : this.state(),
        created: {},
        updated: {},
        destroyed: [],
        notCreated: {},
        notUpdated: {},
        notDestroyed: {},
      }
      for (const action of ['create', 'update', 'destroy'] as const) {
        const operations =
          action === 'destroy'
            ? ((args.destroy as string[]) ?? []).map((id): [string, JsonObject] => [id, {}])
            : (Object.entries(isJsonObject(args[action]) ? args[action] : {}) as [
                string,
                JsonObject,
              ][])
        for (const [id, data] of operations) {
          const failure =
            this.failSet?.type === type && this.failSet.operation === action
              ? this.failSet.error
              : action !== 'create' && !store.has(id)
                ? { type: 'notFound' }
                : null
          if (failure) {
            ;(
              result[
                { create: 'notCreated', update: 'notUpdated', destroy: 'notDestroyed' }[action]
              ] as JsonObject
            )[id] = failure
            continue
          }
          if (action === 'create') {
            const newId = `${type === 'Calendar' ? 'calendar' : 'event'}${++this.sequence}`
            const defaults: JsonObject =
              type === 'Calendar'
                ? {
                    isVisible: true,
                    isSubscribed: true,
                    myRights: { mayAddItems: true, mayModifyItems: true, mayRemoveItems: true },
                  }
                : { updated: '2026-10-06T09:00:00Z' }
            store.set(newId, { ...defaults, ...data, id: newId })
            ;(result.created as JsonObject)[id] = { id: newId }
            if (type === 'CalendarEvent') this.change(newId, 'created')
          } else if (action === 'update') {
            store.set(id, applyJmapPatch(store.get(id)!, data))
            ;(result.updated as JsonObject)[id] = null
            if (type === 'CalendarEvent') this.change(id, 'updated')
          } else {
            store.delete(id)
            ;(result.destroyed as string[]).push(id)
            if (type === 'CalendarEvent') this.change(id, 'destroyed')
          }
          if (type === 'Calendar') this.calendarState++
        }
      }
      result.newState = type === 'Calendar' ? `calendar-${this.calendarState}` : this.state()
      return result
    }
    throw new Error(`Unsupported fake method ${method}`)
  }
}
