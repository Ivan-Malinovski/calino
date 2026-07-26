import type { Plugin } from 'vite'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Dev-only Vite plugin that mounts a CalDAV mock at `/mock-caldav/*` on the
 * dev server itself, so the browser sees it as the same origin (CSP allows
 * `connect-src 'self'`).
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
 *   - GET  /.well-known/caldav                → 301 redirect to /mock-caldav/dav/
 *   - PROPFIND /mock-caldav/dav/              → 207 with current-user-principal
 *   - PROPFIND /dav/principals/...            → 207 with calendar-home-set
 *   - PROPFIND /dav/calendars/...             → 207 listing two calendars:
 *                                              Personal + the dedicated
 *                                              `calino-settings` collection
 *                                              used by settings sync.
 *   - PROPFIND /dav/calendars/.../calino-settings/
 *                                            → 207 with settings-calendar
 *                                              props (incl. dead-property
 *                                              marker so Calino recognises
 *                                              it via the PROPFIND branch
 *                                              AND via the displayname+URL
 *                                              branch).
 *   - REPORT /dav/calendars/.../personal/     → 207 with stored events
 *   - REPORT /dav/calendars/.../calino-settings/ → 207 with stored settings
 *                                              VEVENT only (scoped per
 *                                              collection, so the two
 *                                              calendars do not leak).
 *   - PUT /dav/calendars/...                  → 201 Created
 *   - DELETE /dav/calendars/...               → 204 No Content
 */
export function caldavMockPlugin(): Plugin {
  const enabled = process.env.CALINO_E2E_MOCK === '1'
  if (!enabled) {
    return {
      name: 'calino-caldav-mock',
      apply: () => false,
    }
  }

  const eventStore = new Map<string, string>()

  return {
    name: 'calino-caldav-mock',

    configureServer(server) {
      server.middlewares.use('/mock-caldav', (req, res, next) => {
        const url = req.url ?? '/'
        const path = url.split('?')[0]
        const method = req.method ?? 'GET'
        const origin = `http://${req.headers.host}`
        const calendarUrl = `${origin}/mock-caldav/dav/calendars/user/personal/`
        const settingsCalendarUrl = `${origin}/mock-caldav/dav/calendars/user/calino-settings/`

        const esc = (s: string) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')

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
          const body = `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cr="http://calino.app/ns/">\n  ${responses.join('\n  ')}\n</d:multistatus>`
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
          res.end(body)
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
              if (storedPath.startsWith(prefix)) eventStore.delete(storedPath)
            }
          } else {
            eventStore.clear()
          }
          res.writeHead(204)
          res.end()
          return
        }

        // 1) Discovery: well-known redirect.
        if (path === '/.well-known/caldav') {
          res.writeHead(301, { Location: '/mock-caldav/dav/' })
          res.end()
          return
        }

        // 2) PROPFIND on the DAV base or root.
        if ((path === '/dav/' || path === '/' || path === '') && method === 'PROPFIND') {
          return write207([
            responseTag(`${origin}/mock-caldav/dav/`, [
              {
                name: 'DAV:current-user-principal',
                href: `${origin}/mock-caldav/dav/principals/user/`,
              },
              { name: 'DAV:displayname', value: 'Mock CalDAV' },
            ]),
          ])
        }

        // 3) PROPFIND on the principal → calendar-home-set
        if (path === '/dav/principals/user/' && method === 'PROPFIND') {
          return write207([
            responseTag(`${origin}/mock-caldav/dav/principals/user/`, [
              {
                name: 'CAL:calendar-home-set',
                href: `${origin}/mock-caldav/dav/calendars/user/`,
              },
            ]),
          ])
        }

        // 4) PROPFIND on the calendar home — list both `personal/` and the
        // dedicated `calino-settings/` collection so Calino's
        // `discoverSettingsCalendar()` finds the settings calendar by
        // either the dead-property marker or the displayname+URL branch.
        if (path === '/dav/calendars/user/' && method === 'PROPFIND') {
          return write207([
            responseTag(calendarUrl, [
              {
                name: 'DAV:resourcetype',
                value: '<d:collection/><c:calendar/>',
                raw: true,
              },
              { name: 'DAV:displayname', value: 'Personal' },
              { name: 'http://apple.com/ns/ical/calendar-color', value: '#3B82F6' },
              {
                name: 'CAL:supported-calendar-component-set',
                value: '<c:comp name="VEVENT"/><c:comp name="VTODO"/><c:comp name="VJOURNAL"/>',
                raw: true,
              },
            ]),
            responseTag(settingsCalendarUrl, [
              {
                name: 'DAV:resourcetype',
                value: '<d:collection/><c:calendar/>',
                raw: true,
              },
              { name: 'DAV:displayname', value: 'Calino Settings' },
              {
                name: 'CAL:supported-calendar-component-set',
                value: '<c:comp name="VEVENT"/>',
                raw: true,
              },
              // Dead-property marker so Calino's `discoverSettingsCalendar`
              // recognises the collection even when the request includes
              // the `X-CALINO-SETTINGS-CALENDAR` PROPFIND.
              { name: 'cr:X-CALINO-SETTINGS-CALENDAR', value: '1' },
            ]),
          ])
        }

        // 5a) PROPFIND on the personal calendar itself
        if (path === '/dav/calendars/user/personal/' && method === 'PROPFIND') {
          return write207([
            responseTag(calendarUrl, [
              { name: 'DAV:displayname', value: 'Personal' },
              { name: 'http://apple.com/ns/ical/calendar-color', value: '#3B82F6' },
              {
                name: 'CAL:supported-calendar-component-set',
                value: '<c:comp name="VEVENT"/><c:comp name="VTODO"/><c:comp name="VJOURNAL"/>',
                raw: true,
              },
            ]),
          ])
        }

        // 5b) PROPFIND on the settings calendar itself (used by
        // `createSettingsCalendar` and re-discovery flows).
        if (path === '/dav/calendars/user/calino-settings/' && method === 'PROPFIND') {
          return write207([
            responseTag(settingsCalendarUrl, [
              { name: 'DAV:displayname', value: 'Calino Settings' },
              {
                name: 'CAL:supported-calendar-component-set',
                value: '<c:comp name="VEVENT"/>',
                raw: true,
              },
              { name: 'cr:X-CALINO-SETTINGS-CALENDAR', value: '1' },
            ]),
          ])
        }

        // 6) REPORT → events, scoped per collection so the settings calendar
        // and the personal calendar never leak events into each other.
        const collectionPath = (p: string): string | null => {
          if (p === '/dav/calendars/user/personal/') return '/dav/calendars/user/personal/'
          if (p === '/dav/calendars/user/calino-settings/')
            return '/dav/calendars/user/calino-settings/'
          return null
        }
        const collectionHref = (p: string): string => {
          if (p === '/dav/calendars/user/personal/') return calendarUrl
          return settingsCalendarUrl
        }
        const reportCollection = collectionPath(path)
        if (reportCollection !== null && method === 'REPORT') {
          const events: string[] = []
          for (const [storedPath, ics] of eventStore) {
            // Only return events whose stored path is under this collection.
            if (!storedPath.startsWith(reportCollection)) continue
            const filename = storedPath.slice(reportCollection.length)
            events.push(
              responseTag(`${collectionHref(path)}${filename}`, [
                { name: 'DAV:getetag', value: '"mock-etag"' },
                { name: 'DAV:getcontenttype', value: 'text/calendar' },
                { name: 'CAL:calendar-data', value: ics, raw: true },
              ])
            )
          }
          return write207(events)
        }

        // 7) PUT → store
        if (
          (path === '/dav/calendars/user/personal/' ||
            path === '/dav/calendars/user/calino-settings/') &&
          method === 'PUT'
        ) {
          // Paths are appended by the client (e.g. `…/calino-settings.ics`).
          // Fall through to the generic handler below if the path has a
          // filename appended.
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            eventStore.set(path, body)
            res.writeHead(201, { ETag: '"mock-etag"' })
            res.end()
          })
          return
        }
        if (
          (path.startsWith('/dav/calendars/user/personal/') ||
            path.startsWith('/dav/calendars/user/calino-settings/')) &&
          method === 'PUT'
        ) {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            eventStore.set(path, body)
            res.writeHead(201, { ETag: '"mock-etag"' })
            res.end()
          })
          return
        }

        // 8) DELETE
        if (
          path.startsWith('/dav/calendars/user/personal/') ||
          path.startsWith('/dav/calendars/user/calino-settings/')
        ) {
          if (method === 'DELETE') {
            eventStore.delete(path)
            res.writeHead(204)
            res.end()
            return
          }
        }

        // 9) OPTIONS
        if (method === 'OPTIONS') {
          res.writeHead(200, {
            Allow: 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, COPY, MOVE',
            DAV: '1, 2, 3, calendar-access',
          })
          res.end()
          return
        }

        // Fall through.
        next()
      })

       
      console.log('[calino-caldav-mock] mounted at /mock-caldav/* (dev only)')
    },
  }
}

// Silence unused-import warning when the http/AddressInfo imports aren't
// referenced (they were left in for parity with the standalone mock server
// and to make future port-based work easier).
void http
void ({} as AddressInfo)
