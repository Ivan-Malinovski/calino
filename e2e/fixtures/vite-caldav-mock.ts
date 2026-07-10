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
 *   - GET  /.well-known/caldav      → 301 redirect to /mock-caldav/dav/
 *   - PROPFIND /mock-caldav/dav/    → 207 with current-user-principal
 *   - PROPFIND /dav/principals/...  → 207 with calendar-home-set
 *   - PROPFIND /dav/calendars/...   → 207 listing one calendar
 *   - REPORT /dav/calendars/...     → 207 with empty events
 *   - PUT /dav/calendars/...        → 201 Created
 *   - DELETE /dav/calendars/...     → 204 No Content
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

        const esc = (s: string) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')

        const responseTag = (
          href: string,
          props: Array<{ name: string; href?: string; value?: string; raw?: boolean }>
        ): string => {
          const qualifiedName = (name: string): string => {
            if (name.startsWith('DAV:')) return `D:${name.slice(4)}`
            if (name.startsWith('CAL:')) return `C:${name.slice(4)}`
            if (name.startsWith('http://apple.com/ns/ical/')) {
              return `A:${name.slice('http://apple.com/ns/ical/'.length)}`
            }
            return name
          }
          const propTags = props
            .map((p) => {
              const tag = qualifiedName(p.name)
              if (p.href !== undefined) {
                return `<${tag}><D:href>${esc(p.href)}</D:href></${tag}>`
              }
              if (p.value === undefined || p.value === '') {
                return `<${tag}/>`
              }
              return `<${tag}>${p.raw ? p.value : esc(p.value)}</${tag}>`
            })
            .join('')
          return `<D:response><D:href>${esc(href)}</D:href><D:propstat><D:prop>${propTags}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
        }

        const write207 = (responses: string[]) => {
          const body = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">\n  ${responses.join('\n  ')}\n</D:multistatus>`
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
          res.end(body)
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

        // 4) PROPFIND on the calendar home
        if (path === '/dav/calendars/user/' && method === 'PROPFIND') {
          return write207([
            responseTag(calendarUrl, [
              {
                name: 'DAV:resourcetype',
                value: '<D:collection/><C:calendar/>',
                raw: true,
              },
              { name: 'DAV:displayname', value: 'Personal' },
              { name: 'http://apple.com/ns/ical/calendar-color', value: '#3B82F6' },
              {
                name: 'CAL:supported-calendar-component-set',
                value: '<C:comp name="VEVENT"/><C:comp name="VTODO"/><C:comp name="VJOURNAL"/>',
                raw: true,
              },
            ]),
          ])
        }

        // 5) PROPFIND on the calendar itself
        if (path === '/dav/calendars/user/personal/' && method === 'PROPFIND') {
          return write207([
            responseTag(calendarUrl, [
              { name: 'DAV:displayname', value: 'Personal' },
              { name: 'http://apple.com/ns/ical/calendar-color', value: '#3B82F6' },
              {
                name: 'CAL:supported-calendar-component-set',
                value: '<C:comp name="VEVENT"/><C:comp name="VTODO"/><C:comp name="VJOURNAL"/>',
                raw: true,
              },
            ]),
          ])
        }

        // 6) REPORT → events
        if (path.startsWith('/dav/calendars/user/') && method === 'REPORT') {
          const events: string[] = []
          for (const [, ics] of eventStore) {
            events.push(
              responseTag(`${calendarUrl}${Math.random().toString(36).slice(2, 10)}.ics`, [
                { name: 'DAV:getetag', value: '"mock-etag"' },
                { name: 'DAV:getcontenttype', value: 'text/calendar' },
                { name: 'CAL:calendar-data', value: ics, raw: true },
              ])
            )
          }
          return write207(events)
        }

        // 7) PUT → store
        if (path.startsWith('/dav/calendars/user/') && method === 'PUT') {
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
        if (path.startsWith('/dav/calendars/user/') && method === 'DELETE') {
          eventStore.delete(path)
          res.writeHead(204)
          res.end()
          return
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

      // eslint-disable-next-line no-console
      console.log('[calino-caldav-mock] mounted at /mock-caldav/* (dev only)')
    },
  }
}

// Silence unused-import warning when the http/AddressInfo imports aren't
// referenced (they were left in for parity with the standalone mock server
// and to make future port-based work easier).
void http
void ({} as AddressInfo)
