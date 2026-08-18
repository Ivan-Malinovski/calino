import type { Plugin } from 'vite'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Dev-only Vite plugin that mounts a CalDAV mock at `/mock-caldav/*` (account
 * A) and `/mock-caldav-b/*` (account B) on the dev server itself, so the
 * browser sees them as the same origin (CSP allows `connect-src 'self'`).
 *
 * Enable by setting `CALINO_E2E_MOCK=1` in the env (the Playwright config
 * does this automatically when starting the dev server). Without the flag
 * the plugin is a no-op and the dev server behaves exactly as before.
 *
 * Implements just enough of RFC 4791 to drive Calino's connection test
 * and sync flow:
 *   - POST /mock-caldav/__test__/reset        → 204, clears all stored
 *                                              events. The mock is a
 *                                              singleton for the whole
 *                                              dev-server process, so
 *                                              tests MUST call this to
 *                                              avoid leaking state between
 *                                              each other.
 *   - GET  /mock-caldav/__test__/dump?prefix= → 200 JSON `{ [storedPath]: ics }`
 *                                              so specs can assert
 *                                              server-side placement
 *                                              directly instead of
 *                                              inferring it from the UI.
 *   - POST /mock-caldav/__test__/fail?method=DELETE&prefix=…&count=N
 *                                            → 204; the next N matching
 *                                              requests return 500 (fault
 *                                              injection for partial-failure
 *                                              tests).
 *   - GET  /.well-known/caldav                → 301 redirect to /mock-caldav/dav/
 *   - PROPFIND /mock-caldav/dav/              → 207 with current-user-principal
 *   - PROPFIND /dav/principals/...            → 207 with calendar-home-set
 *   - PROPFIND /dav/calendars/...             → 207 listing the collections
 *                                              of that account (account A:
 *                                              Personal + Work + the
 *                                              dedicated `calino-settings`
 *                                              collection used by settings
 *                                              sync; account B: Personal).
 *   - PROPFIND /dav/calendars/.../calino-settings/
 *                                            → 207 with settings-calendar
 *                                              props (incl. dead-property
 *                                              marker so Calino recognises
 *                                              it via the PROPFIND branch
 *                                              AND via the displayname+URL
 *                                              branch).
 *   - REPORT /dav/calendars/.../<collection>/ → 207 with stored events,
 *                                              scoped per collection so the
 *                                              collections do not leak.
 *   - PUT /dav/calendars/...                  → 201 Created
 *   - DELETE /dav/calendars/...               → 204 No Content
 *
 * Both mounts share ONE event store. Account B lives under a distinct
 * principal (`/dav/calendars/userb/…`), so stored paths never collide and a
 * single `__test__/dump` call can observe both accounts.
 */

interface MockCollection {
  /** Path of the collection, relative to the mount point. */
  path: string
  displayName: string
  color?: string
  components: string[]
  /** Marks the collection as Calino's settings calendar. */
  isSettings?: boolean
  /**
   * Withhold the `ETag` response header on PUT, forcing Calino's PROPFIND
   * fallback to recover it.
   *
   * This is the *normal* case on the web, not an exotic one: a CalDAV server
   * that doesn't send `Access-Control-Expose-Headers: ETag` is, from the
   * browser's side, indistinguishable from one that omits the header — so
   * every write on a stock server takes the fallback path.
   */
  hideEtagOnPut?: boolean
  /**
   * Advertise a `current-user-privilege-set` granting read but not write, so
   * Calino marks the calendar `readOnly` from discovery alone. Collections
   * without the flag omit the property entirely — which is how most servers
   * behave, and must keep reading as writable.
   */
  readOnly?: boolean
  /**
   * Reject every `sync-collection` REPORT with `400 Bad Request` (RFC 6578
   * §3.2), the way a server does when its token has expired or its change log
   * has been truncated. Drives the full-sync fallback path.
   */
  rejectSyncToken?: boolean
}

interface MockAccount {
  /** Mount point on the dev server, e.g. `/mock-caldav`. */
  mount: string
  principalPath: string
  homePath: string
  displayName: string
  collections: MockCollection[]
}

const ACCOUNTS: MockAccount[] = [
  {
    mount: '/mock-caldav',
    principalPath: '/dav/principals/user/',
    homePath: '/dav/calendars/user/',
    displayName: 'Mock CalDAV',
    collections: [
      {
        path: '/dav/calendars/user/personal/',
        displayName: 'Personal',
        color: '#3B82F6',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Dedicated source collection for `event-move.spec.ts`. It owns
        // this collection outright, so its resets never race the specs
        // that share `personal/` (Playwright runs `fullyParallel`).
        path: '/dav/calendars/user/move-source/',
        displayName: 'Move Source',
        color: '#8B5CF6',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        path: '/dav/calendars/user/work/',
        displayName: 'Work',
        color: '#EF4444',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Dedicated collection for `contacts-birthday.spec.ts`, which asserts
        // exactly how many copies of a birthday sit on the server. It used to
        // write into `personal/`, which `calendar-sync.spec.ts` resets in its
        // beforeEach — under `fullyParallel` that wiped the birthday mid-test
        // and the copy count came back 0.
        path: '/dav/calendars/user/birthdays/',
        displayName: 'Birthdays',
        color: '#10B981',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Dedicated collections for the journal-move test in `journal.spec.ts`
        // (editing an entry's calendar). Owned by that spec outright, like
        // event-move owns move-source/ — its resets never race the specs that
        // share `personal/`.
        path: '/dav/calendars/user/j-work/',
        displayName: 'Journal Work',
        color: '#4285F4',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        path: '/dav/calendars/user/j-personal/',
        displayName: 'Journal Personal',
        color: '#E8710A',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Owned by `journal-timezone.spec.ts` (issue #116), which asserts the
        // exact DTSTART of the single entry it creates — it cannot share a
        // collection with a spec running in parallel.
        path: '/dav/calendars/user/j-tz/',
        displayName: 'Journal TZ',
        color: '#34A853',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Owned by `recurrence-until-timezone.spec.ts`, which asserts the exact
        // RRULE of the single series it creates — same reason as `j-tz/`.
        path: '/dav/calendars/user/r-until/',
        displayName: 'Recurrence Until',
        color: '#7C3AED',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Owned by `ics-fidelity.spec.ts`, which asserts the exact bytes of the
        // single resource it seeds — a spec writing to the same collection in
        // parallel would change the dump it reads back.
        path: '/dav/calendars/user/ics-fid/',
        displayName: 'ICS Fidelity',
        color: '#0F9D58',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Owned by `timezone-correctness.spec.ts`, which asserts the exact
        // DTSTART bytes of the TZID resources it seeds and drags — same
        // reason as `r-until/`: a parallel spec writing to this collection
        // would change the dump it reads back.
        path: '/dav/calendars/user/tz-correct/',
        displayName: 'Timezone Correct',
        color: '#EA4335',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Owned by `delete-sync.spec.ts` (issue #110), which asserts the
        // collection is empty after a delete — it cannot share a collection
        // with a spec running in parallel.
        path: '/dav/calendars/user/del-sync/',
        displayName: 'Del Sync',
        color: '#A142F4',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Same as `del-sync/`, but the server withholds the ETag on PUT so the
        // delete has to rely on the PROPFIND fallback — the path that broke on
        // sabre servers in issue #110.
        path: '/dav/calendars/user/del-sync-noetag/',
        displayName: 'Del Sync No ETag',
        color: '#F59E0B',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
        hideEtagOnPut: true,
      },
      {
        // Owned by `sync-queue.spec.ts` (Phase 3 — queued-edit
        // resilience), which asserts the exact bytes of the resources it
        // seeds and replays — same reason as `r-until/`: a parallel
        // spec writing to this collection would change the dump it reads.
        path: '/dav/calendars/user/sync-queue/',
        displayName: 'Sync Queue',
        color: '#4285F4',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        path: '/dav/calendars/user/calino-settings/',
        displayName: 'Calino Settings',
        components: ['VEVENT'],
        isSettings: true,
      },
    ],
  },
  {
    mount: '/mock-caldav-b',
    principalPath: '/dav/principals/userb/',
    homePath: '/dav/calendars/userb/',
    displayName: 'Mock CalDAV B',
    collections: [
      {
        path: '/dav/calendars/userb/personal/',
        displayName: 'Personal',
        color: '#10B981',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
    ],
  },
  {
    // A third account, existing solely for `incremental-sync.spec.ts`. That
    // spec asserts on exact request counts per sync, so it cannot afford a
    // calendar home full of collections other specs are writing to — and every
    // sync walks the *whole* home, not just the calendars it cares about.
    mount: '/mock-caldav-inc',
    principalPath: '/dav/principals/userc/',
    homePath: '/dav/calendars/userc/',
    displayName: 'Mock CalDAV Incremental',
    collections: [
      {
        path: '/dav/calendars/userc/inc-sync/',
        displayName: 'Inc Sync',
        color: '#2563EB',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        // Refuses every sync-collection REPORT, the way a server does once its
        // change log can no longer answer for the token the client holds. The
        // client must notice and fall back to a full sync.
        path: '/dav/calendars/userc/inc-notoken/',
        displayName: 'Inc No Token',
        color: '#DB2777',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
        rejectSyncToken: true,
      },
      {
        path: '/dav/calendars/userc/inc-readonly/',
        displayName: 'Inc Read Only',
        color: '#059669',
        components: ['VEVENT', 'VTODO', 'VJOURNAL'],
        readOnly: true,
      },
    ],
  },
]

interface FaultRule {
  method: string
  prefix: string
  remaining: number
}

export function caldavMockPlugin(): Plugin {
  const enabled = process.env.CALINO_E2E_MOCK === '1'
  if (!enabled) {
    return {
      name: 'calino-caldav-mock',
      apply: () => false,
    }
  }

  // Shared by every mount: account B uses a distinct principal, so stored
  // paths are globally unique and `__test__/dump` sees the whole world.
  const eventStore = new Map<string, string>()
  // Real per-resource ETags, changing on every write. A constant `"mock-etag"`
  // made every If-Match match, so the mock could never reproduce the
  // stale-etag 412s that real servers (Baikal, Radicale) return — issue #110.
  const etagStore = new Map<string, string>()
  let etagCounter = 0
  const nextEtag = () => `"mock-etag-${++etagCounter}"`
  const faults: FaultRule[] = []

  // RFC 6578 change log. `collectionRev` is a per-collection monotonic
  // counter; every write or delete bumps it and stamps the affected resource
  // with the new value. A sync-collection REPORT carrying token N therefore
  // answers "everything stamped above N", which is exactly the semantics a
  // real server's change log provides — without one, the mock could only ever
  // report "everything", and an incremental-sync spec would pass against a
  // client that ignored the token entirely.
  const collectionRev = new Map<string, number>()
  const resourceRev = new Map<string, number>()
  const tombstoneRev = new Map<string, number>()
  // Every request the mock handled, so a spec can assert that an unchanged
  // collection was NOT re-fetched. Absence of a request is the whole point of
  // incremental sync and cannot be observed from the UI.
  const requestLog: Array<{ method: string; path: string }> = []

  const TOKEN_PREFIX = 'http://calino.test/ns/sync/'
  const bumpRev = (collectionPath: string): number => {
    const next = (collectionRev.get(collectionPath) ?? 0) + 1
    collectionRev.set(collectionPath, next)
    return next
  }
  const currentRev = (collectionPath: string): number => collectionRev.get(collectionPath) ?? 0
  const syncTokenFor = (collectionPath: string) => `${TOKEN_PREFIX}${currentRev(collectionPath)}`
  const ctagFor = (collectionPath: string) => `"ctag-${currentRev(collectionPath)}"`
  const recordWrite = (collectionPath: string, resourcePath: string): void => {
    resourceRev.set(resourcePath, bumpRev(collectionPath))
    tombstoneRev.delete(resourcePath)
  }
  const recordDelete = (collectionPath: string, resourcePath: string): void => {
    resourceRev.delete(resourcePath)
    tombstoneRev.set(resourcePath, bumpRev(collectionPath))
  }

  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')

  const makeHandler =
    (account: MockAccount) =>
    (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
      const url = req.url ?? '/'
      const path = url.split('?')[0]
      const method = req.method ?? 'GET'
      const origin = `http://${req.headers.host}`
      const absolute = (p: string) => `${origin}${account.mount}${p}`

      const COLLECTIONS = account.collections

      // Log real DAV traffic only — the `__test__` control endpoints are the
      // spec talking to the mock, not the app talking to a server.
      if (!path.startsWith('/__test__/')) requestLog.push({ method, path })

      // Namespace prefixes are lowercase (`d:`, `c:`, `a:`, `cr:`) to match
      // what real CalDAV servers (and Calino's own regex-based
      // `discoverSettingsCalendar` parser, which hardcodes lowercase
      // prefixes) expect — XML namespace prefixes are technically
      // arbitrary, but Calino's client-side parsing is not prefix-agnostic.
      const responseTag = (
        href: string,
        props: Array<{ name: string; href?: string; value?: string; raw?: boolean }>
      ): string => {
        const qualifiedName = (name: string): string => {
          if (name.startsWith('DAV:')) return `d:${name.slice(4)}`
          if (name.startsWith('CAL:')) return `c:${name.slice(4)}`
          if (name.startsWith('http://apple.com/ns/ical/')) {
            return `a:${name.slice('http://apple.com/ns/ical/'.length)}`
          }
          if (name.startsWith('http://calendarserver.org/ns/')) {
            return `cs:${name.slice('http://calendarserver.org/ns/'.length)}`
          }
          return name
        }
        const propTags = props
          .map((p) => {
            const tag = qualifiedName(p.name)
            if (p.href !== undefined) {
              return `<${tag}><d:href>${esc(p.href)}</d:href></${tag}>`
            }
            if (p.value === undefined || p.value === '') {
              return `<${tag}/>`
            }
            return `<${tag}>${p.raw ? p.value : esc(p.value)}</${tag}>`
          })
          .join('')
        return `<d:response><d:href>${esc(href)}</d:href><d:propstat><d:prop>${propTags}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      }

      const write207 = (responses: string[]) => {
        const body = `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/" xmlns:cr="http://calino.app/ns/">\n  ${responses.join('\n  ')}\n</d:multistatus>`
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
        res.end(body)
      }

      const collectionProps = (c: MockCollection) => {
        const props: Array<{ name: string; href?: string; value?: string; raw?: boolean }> = [
          { name: 'DAV:displayname', value: c.displayName },
        ]
        if (c.color) {
          props.push({ name: 'http://apple.com/ns/ical/calendar-color', value: c.color })
        }
        props.push({
          name: 'CAL:supported-calendar-component-set',
          value: c.components.map((comp) => `<c:comp name="${comp}"/>`).join(''),
          raw: true,
        })
        // The change cursors Calino stores and later replays. `getctag` is a
        // change *hint*; `sync-token` is the cursor the REPORT consumes. Both
        // move together here because both derive from the same revision.
        props.push({ name: 'http://calendarserver.org/ns/getctag', value: ctagFor(c.path) })
        props.push({ name: 'DAV:sync-token', value: syncTokenFor(c.path) })
        if (c.readOnly) {
          props.push({
            name: 'DAV:current-user-privilege-set',
            value: '<d:privilege><d:read/></d:privilege>',
            raw: true,
          })
        }
        if (c.isSettings) {
          // Dead-property marker so Calino's `discoverSettingsCalendar`
          // recognises the collection even when the request includes
          // the `X-CALINO-SETTINGS-CALENDAR` PROPFIND.
          props.push({ name: 'cr:X-CALINO-SETTINGS-CALENDAR', value: '1' })
        }
        return props
      }

      // 0) Test isolation: the mock's eventStore is a single Map shared
      // by the whole dev-server process for the entire Playwright run —
      // it does NOT reset between tests. Since the settings-sync UID is
      // a fixed literal (`calino-settings`, by design — see R1.22), any
      // two tests that exercise settings sync write to the exact same
      // stored path. Tests must call this before seeding state.
      //
      // `?prefix=` restricts the clear to one collection. Playwright runs
      // `fullyParallel`, so an unscoped clear will happily delete a
      // concurrently-running spec's fixtures out from under it — pass the
      // prefix unless you genuinely mean "wipe everything".
      if (path === '/__test__/reset' && method === 'POST') {
        const prefix = new URL(req.url ?? '', 'http://localhost').searchParams.get('prefix')
        if (prefix) {
          for (const storedPath of [...eventStore.keys()]) {
            if (storedPath.startsWith(prefix)) {
              eventStore.delete(storedPath)
              etagStore.delete(storedPath)
            }
          }
          for (const key of [...resourceRev.keys()]) {
            if (key.startsWith(prefix)) resourceRev.delete(key)
          }
          for (const key of [...tombstoneRev.keys()]) {
            if (key.startsWith(prefix)) tombstoneRev.delete(key)
          }
          // The revision counter is deliberately NOT reset to 0: a spec that
          // reset a collection and re-seeded it would otherwise hand out a
          // token the previous test's client already holds, and the sync would
          // look like "nothing changed" instead of "everything is new".
          bumpRev(prefix)
          for (let i = requestLog.length - 1; i >= 0; i--) {
            if (requestLog[i].path.startsWith(prefix)) requestLog.splice(i, 1)
          }
          for (let i = faults.length - 1; i >= 0; i--) {
            if (faults[i].prefix.startsWith(prefix) || prefix.startsWith(faults[i].prefix)) {
              faults.splice(i, 1)
            }
          }
        } else {
          eventStore.clear()
          etagStore.clear()
          faults.length = 0
          resourceRev.clear()
          tombstoneRev.clear()
          requestLog.length = 0
          for (const key of [...collectionRev.keys()]) bumpRev(key)
        }
        res.writeHead(204)
        res.end()
        return
      }

      // 0b) Server-side inspection: `{ [storedPath]: ics }`. Specs assert
      // placement here instead of guessing from what the UI renders.
      if (path === '/__test__/dump' && method === 'GET') {
        const prefix = new URL(req.url ?? '', 'http://localhost').searchParams.get('prefix') ?? ''
        const dump: Record<string, string> = {}
        for (const [storedPath, ics] of eventStore) {
          if (storedPath.startsWith(prefix)) dump[storedPath] = ics
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(dump))
        return
      }

      // 0c) Fault injection: the next `count` requests matching
      // method+prefix fail with 500.
      if (path === '/__test__/fail' && method === 'POST') {
        const params = new URL(req.url ?? '', 'http://localhost').searchParams
        faults.push({
          method: (params.get('method') ?? 'DELETE').toUpperCase(),
          prefix: params.get('prefix') ?? '/dav/',
          remaining: Number(params.get('count') ?? '1'),
        })
        res.writeHead(204)
        res.end()
        return
      }

      // 0d) Request log: `[{ method, path }]`, optionally scoped by prefix.
      // Incremental sync is defined by the requests it does NOT make, and a
      // request that never happened leaves no trace in the UI or the store.
      if (path === '/__test__/requests' && method === 'GET') {
        const prefix = new URL(req.url ?? '', 'http://localhost').searchParams.get('prefix') ?? ''
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(requestLog.filter((entry) => entry.path.startsWith(prefix))))
        return
      }

      // 0e) Out-of-band server-side mutation. A spec needs to change or remove
      // a resource the way another client would — without going through
      // Calino's own PUT/DELETE, which would mark the change as locally
      // originated and defeat the point.
      //
      //   POST /__test__/mutate?path=/dav/…/x.ics   body = ICS  → upsert
      //   POST /__test__/mutate?path=/dav/…/x.ics&remove=1      → tombstone
      if (path === '/__test__/mutate' && method === 'POST') {
        const params = new URL(req.url ?? '', 'http://localhost').searchParams
        const target = params.get('path') ?? ''
        const collection = COLLECTIONS.find((c) => target.startsWith(c.path))
        if (!collection) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('no such collection')
          return
        }
        if (params.get('remove') === '1') {
          eventStore.delete(target)
          etagStore.delete(target)
          recordDelete(collection.path, target)
          res.writeHead(204)
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          eventStore.set(target, body)
          etagStore.set(target, nextEtag())
          recordWrite(collection.path, target)
          res.writeHead(204)
          res.end()
        })
        return
      }

      // Fault check — runs before any real handling below.
      const fault = faults.find(
        (f) => f.method === method && path.startsWith(f.prefix) && f.remaining > 0
      )
      if (fault) {
        fault.remaining -= 1
        if (fault.remaining <= 0) faults.splice(faults.indexOf(fault), 1)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('injected failure')
        return
      }

      // 1) Discovery: well-known redirect.
      if (path === '/.well-known/caldav') {
        res.writeHead(301, { Location: `${account.mount}/dav/` })
        res.end()
        return
      }

      // 2) PROPFIND on the DAV base or root.
      if ((path === '/dav/' || path === '/' || path === '') && method === 'PROPFIND') {
        return write207([
          responseTag(absolute('/dav/'), [
            {
              name: 'DAV:current-user-principal',
              href: absolute(account.principalPath),
            },
            { name: 'DAV:displayname', value: account.displayName },
          ]),
        ])
      }

      // 3) PROPFIND on the principal → calendar-home-set
      if (path === account.principalPath && method === 'PROPFIND') {
        return write207([
          responseTag(absolute(account.principalPath), [
            {
              name: 'CAL:calendar-home-set',
              href: absolute(account.homePath),
            },
          ]),
        ])
      }

      // 4) PROPFIND on the calendar home — list every collection of this
      // account, including the dedicated `calino-settings/` one so Calino's
      // `discoverSettingsCalendar()` finds the settings calendar by either
      // the dead-property marker or the displayname+URL branch.
      if (path === account.homePath && method === 'PROPFIND') {
        return write207(
          COLLECTIONS.map((c) =>
            responseTag(absolute(c.path), [
              {
                name: 'DAV:resourcetype',
                value: '<d:collection/><c:calendar/>',
                raw: true,
              },
              ...collectionProps(c),
            ])
          )
        )
      }

      // 5) PROPFIND on an individual collection (used by
      // `createSettingsCalendar` and re-discovery flows).
      const propfindCollection = COLLECTIONS.find((c) => c.path === path)
      if (propfindCollection && method === 'PROPFIND') {
        return write207([
          responseTag(absolute(propfindCollection.path), collectionProps(propfindCollection)),
        ])
      }

      // The single source of truth for "which collection does this path
      // belong to" — used by REPORT, both PUT branches and DELETE.
      const owningCollection = COLLECTIONS.find((c) => path.startsWith(c.path))

      // 5b) PROPFIND on an individual stored resource — how Calino recovers an
      // ETag the server didn't expose on PUT. Quotes are XML-escaped by
      // `esc()`, exactly as sabre serializes them
      // (`<d:getetag>&quot;…&quot;</d:getetag>`); a client that scrapes the raw
      // text instead of parsing it gets an unusable etag (issue #110).
      if (method === 'PROPFIND' && eventStore.has(path)) {
        return write207([
          responseTag(absolute(path), [
            { name: 'DAV:getetag', value: etagStore.get(path) ?? '"mock-etag"' },
          ]),
        ])
      }

      /**
       * Honour the `<c:time-range>` upper bound of a calendar-query.
       *
       * Only the upper bound, and only against a literal DTSTART — enough to
       * make "this resource is outside the window a calendar-query would
       * return" a real property of the mock rather than an assumption. Without
       * it, a full sync would happily return a resource dated years out and
       * the out-of-window incremental case would prove nothing. Resources with
       * no parsable DTSTART (a VTODO with only a DUE, say) are always
       * included: excluding them would be a stricter filter than any real
       * server applies.
       */
      const withinTimeRange = (ics: string, rangeEnd: string | null): boolean => {
        if (!rangeEnd) return true
        const dtstart = /^DTSTART[^:\r\n]*:(\d{8})/m.exec(ics)?.[1]
        if (!dtstart) return true
        return dtstart <= rangeEnd.slice(0, 8)
      }

      const calendarQueryReport = (prefix: string, body: string): void => {
        const rangeEnd = /<[^>]*time-range[^>]*\bend="([^"]+)"/.exec(body)?.[1] ?? null
        const events: string[] = []
        for (const [storedPath, ics] of eventStore) {
          // Only return events whose stored path is under this collection.
          if (!storedPath.startsWith(prefix)) continue
          if (!withinTimeRange(ics, rangeEnd)) continue
          const filename = storedPath.slice(prefix.length)
          events.push(
            responseTag(`${absolute(prefix)}${filename}`, [
              { name: 'DAV:getetag', value: etagStore.get(storedPath) ?? '"mock-etag"' },
              { name: 'DAV:getcontenttype', value: 'text/calendar' },
              // Escaped, not raw: iCalendar is text and may legitimately
              // contain `<`, `>` or `&` (an X-ALT-DESC carrying HTML, an
              // ampersand in a SUMMARY). Injecting it raw produced a malformed
              // XML document that clients silently failed to parse — real
              // servers escape it, and Calino's XML parsing unescapes on read.
              { name: 'CAL:calendar-data', value: ics },
            ])
          )
        }
        write207(events)
      }

      // 6) REPORT. Two different reports arrive on the same URL and method,
      // so the body decides: `sync-collection` (RFC 6578) is the incremental
      // one, anything else is a time-windowed `calendar-query`.
      if (owningCollection && method === 'REPORT') {
        const prefix = owningCollection.path
        let reportBody = ''
        req.on('data', (chunk) => {
          reportBody += chunk
        })
        req.on('end', () => {
          if (!reportBody.includes('sync-collection')) return calendarQueryReport(prefix, reportBody)

          if (owningCollection.rejectSyncToken) {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('invalid sync token')
            return
          }

          // An absent or empty `<sync-token/>` is the initial sync: report
          // every current member and no tombstones. A token we cannot make
          // sense of — or one from the future, which is what a client holding
          // a token across a change-log truncation looks like — is a 400.
          const tokenMatch = /<[^>]*sync-token[^>]*>([^<]*)</.exec(reportBody)
          const rawToken = tokenMatch?.[1]?.trim() ?? ''
          let since = 0
          if (rawToken) {
            if (!rawToken.startsWith(TOKEN_PREFIX)) {
              res.writeHead(400, { 'Content-Type': 'text/plain' })
              res.end('unrecognised sync token')
              return
            }
            const parsed = Number(rawToken.slice(TOKEN_PREFIX.length))
            if (!Number.isFinite(parsed) || parsed > currentRev(prefix)) {
              res.writeHead(400, { 'Content-Type': 'text/plain' })
              res.end('stale sync token')
              return
            }
            since = parsed
          }

          const responses: string[] = []
          for (const [storedPath] of eventStore) {
            if (!storedPath.startsWith(prefix)) continue
            if ((resourceRev.get(storedPath) ?? 0) <= since) continue
            responses.push(
              responseTag(absolute(storedPath), [
                { name: 'DAV:getetag', value: etagStore.get(storedPath) ?? '"mock-etag"' },
              ])
            )
          }
          if (rawToken) {
            for (const [storedPath, rev] of tombstoneRev) {
              if (!storedPath.startsWith(prefix) || rev <= since) continue
              // A removal reports its status directly on <response>, with no
              // <propstat> — the shape RFC 6578 §3.4 mandates and the one a
              // parser that only looks inside propstat silently drops.
              responses.push(
                `<d:response><d:href>${esc(absolute(storedPath))}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
              )
            }
          }
          responses.push(`<d:sync-token>${esc(syncTokenFor(prefix))}</d:sync-token>`)
          write207(responses)
        })
        return
      }

      // 6b) GET on a stored resource — how incremental sync fetches a changed
      // resource by href, bypassing the time window a calendar-query imposes.
      if (owningCollection && method === 'GET' && eventStore.has(path)) {
        res.writeHead(200, {
          'Content-Type': 'text/calendar; charset=utf-8',
          ETag: etagStore.get(path) ?? '"mock-etag"',
        })
        res.end(eventStore.get(path))
        return
      }

      // A GET for a resource that is gone is a 404, which the client treats as
      // a tombstone rather than an error.
      if (owningCollection && method === 'GET' && path.endsWith('.ics')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
        return
      }

      // 7) PUT → store. Covers both the bare-collection path (used by
      // settings sync, which PUTs to `…/calino-settings.ics`) and any
      // resource path underneath a collection.
      if (owningCollection && method === 'PUT') {
        const ifMatch = req.headers['if-match']
        const ifNoneMatch = req.headers['if-none-match']
        const exists = eventStore.has(path)
        // Sabre/Radicale semantics: a conditional write whose precondition
        // doesn't hold is a 412, and an If-Match against a resource that
        // isn't there fails too.
        if (typeof ifMatch === 'string' && ifMatch !== '*') {
          if (!exists || etagStore.get(path) !== ifMatch) {
            res.writeHead(412, { 'Content-Type': 'text/plain' })
            res.end('If-Match precondition failed')
            return
          }
        }
        if (ifNoneMatch === '*' && exists) {
          res.writeHead(412, { 'Content-Type': 'text/plain' })
          res.end('If-None-Match precondition failed')
          return
        }
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          eventStore.set(path, body)
          const etag = nextEtag()
          etagStore.set(path, etag)
          recordWrite(owningCollection.path, path)
          res.writeHead(201, owningCollection.hideEtagOnPut ? {} : { ETag: etag })
          res.end()
        })
        return
      }

      // 8) DELETE
      if (owningCollection && method === 'DELETE') {
        const ifMatch = req.headers['if-match']
        if (typeof ifMatch === 'string' && ifMatch !== '*') {
          if (!eventStore.has(path) || etagStore.get(path) !== ifMatch) {
            res.writeHead(412, { 'Content-Type': 'text/plain' })
            res.end('If-Match precondition failed')
            return
          }
        }
        eventStore.delete(path)
        etagStore.delete(path)
        recordDelete(owningCollection.path, path)
        res.writeHead(204)
        res.end()
        return
      }

      // 9) OPTIONS
      if (method === 'OPTIONS') {
        res.writeHead(200, {
          Allow:
            'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, COPY, MOVE',
          DAV: '1, 2, 3, calendar-access',
        })
        res.end()
        return
      }

      // Fall through.
      next()
    }

  return {
    name: 'calino-caldav-mock',

    configureServer(server) {
      for (const account of ACCOUNTS) {
        server.middlewares.use(account.mount, makeHandler(account))
      }

      console.log(
        `[calino-caldav-mock] mounted at ${ACCOUNTS.map((a) => `${a.mount}/*`).join(', ')} (dev only)`
      )
    },
  }
}

// Silence unused-import warning when the http/AddressInfo imports aren't
// referenced (they were left in for parity with the standalone mock server
// and to make future port-based work easier).
void ({} as AddressInfo)
