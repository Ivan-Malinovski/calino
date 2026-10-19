/**
 * A minimal CalDAV server for end-to-end diagnostics tests.
 *
 * It exists because the diagnostics engine's whole job is to reason about CORS,
 * and CORS only exists in a browser. Unit tests stub `fetch`, which means they
 * assert against my own model of what a browser does rather than a browser. The
 * vite mock can't fill the gap either: it's middleware on the app's own origin,
 * so requests to it are same-origin and never preflight at all.
 *
 * So this runs on its own port — a genuinely different origin from the app —
 * and lets each test choose how broken it should be:
 *
 *   /good/      fully configured, ETag exposed
 *   /no-cors/   sends no Access-Control-* at all
 *   /no-etag/   correct CORS, but ETag missing from Expose-Headers
 *   /no-report/ rejects the REPORT method
 *   /401/       rejects the credentials
 *   /sabre/     a SabreDAV server root (Davis, Baïkal, Nextcloud): correct
 *               CORS, but Allow omits MKCALENDAR/MKCOL on existing URLs and
 *               the listing holds only folders, whose GET has no ETag. The
 *               principal, calendar home and one calendar with an event sit
 *               below it, as discovery finds them
 *
 * Zero dependencies, so it runs anywhere `node` does.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.DAV_PORT ?? 8099)

const ALLOW_METHODS =
  'GET, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE'
const ALLOW_HEADERS = 'Authorization, Content-Type, Depth, Prefer, If-Match, If-None-Match'

// What SabreDAV sends for an existing URL: creation methods (MKCALENDAR,
// MKCOL) are only offered on URLs that don't exist yet.
const SABRE_ALLOW = 'OPTIONS, GET, HEAD, DELETE, PROPFIND, PUT, PROPPATCH, COPY, MOVE, REPORT'

/** A server root: the root itself plus principal and home-set folders. */
const sabreRootListing = (href) => `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${['', 'principals/', 'calendars/', 'addressbooks/']
  .map(
    (child) => `  <d:response>
    <d:href>${href}${child}</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`
  )
  .join('\n')}
</d:multistatus>`

/** One <d:response> per entry: [href, inner <d:prop> XML]. */
const responses = (entries) => `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
${entries
  .map(
    ([href, prop]) => `  <d:response>
    <d:href>${href}</d:href>
    <d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>`
  )
  .join('\n')}
</d:multistatus>`

/** The SabreDAV tree under /sabre/, answered the way Davis answers it. */
function sabrePropfind(pathname, body) {
  const root = '/sabre/'
  const home = `${root}calendars/alice/`
  const calendar = `${home}default/`
  const folder = '<d:resourcetype><d:collection/></d:resourcetype>'
  if (body.includes('current-user-principal')) {
    return responses([
      [
        pathname,
        `<d:current-user-principal><d:href>${root}principals/alice/</d:href></d:current-user-principal>`,
      ],
    ])
  }
  if (body.includes('calendar-home-set')) {
    return responses([
      [pathname, `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`],
    ])
  }
  if (pathname === home) {
    return responses([
      [home, folder],
      [calendar, '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>'],
    ])
  }
  if (pathname === calendar) {
    return responses([
      [calendar, '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>'],
      [`${calendar}event-1.ics`, '<d:resourcetype/><d:getetag>"etag-1"</d:getetag>'],
    ])
  }
  return sabreRootListing(pathname)
}

const multistatus = (href, kind) => `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Diagnostics</d:displayname>
        <d:resourcetype><d:collection/>${kind === 'calendar' ? '<c:calendar/>' : ''}</d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>${href}event-1.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"etag-1"</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

/**
 * Which knobs each scenario turns off. Everything defaults to working, so a
 * scenario only has to name its own fault — otherwise an omitted flag quietly
 * breaks a second check and the test reads as a product failure.
 */
function profileFor(pathname) {
  const healthy = {
    cors: true,
    exposeEtag: true,
    report: true,
    unauthorized: false,
    sabreRoot: false,
  }
  if (pathname.startsWith('/no-cors')) return { ...healthy, cors: false }
  if (pathname.startsWith('/no-etag')) return { ...healthy, exposeEtag: false }
  if (pathname.startsWith('/no-report')) return { ...healthy, report: false }
  if (pathname.startsWith('/401')) return { ...healthy, unauthorized: true }
  if (pathname.startsWith('/sabre')) return { ...healthy, sabreRoot: true }
  return healthy
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`)
  const profile = profileFor(pathname)
  const origin = req.headers.origin

  // The point of the /no-cors/ scenario: the browser blocks the response
  // before the page ever sees it, exactly as a misconfigured server would.
  if (profile.cors && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS)
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS)
    res.setHeader(
      'Access-Control-Expose-Headers',
      profile.exposeEtag ? 'ETag, DAV, Allow' : 'DAV, Allow'
    )
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('DAV', '1, 2, 3, calendar-access')
    res.setHeader('Allow', profile.sabreRoot ? SABRE_ALLOW : ALLOW_METHODS)
    res.writeHead(204).end()
    return
  }

  if (profile.unauthorized) {
    res.setHeader('WWW-Authenticate', 'Basic realm="dav"')
    res.writeHead(401).end()
    return
  }

  if (req.method === 'REPORT' && !profile.report) {
    res.writeHead(405).end()
    return
  }

  // Collect the request body; PROPFIND and REPORT both send one.
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    res.setHeader('DAV', '1, 2, 3, calendar-access')

    if (req.method === 'PROPFIND' || req.method === 'REPORT') {
      res.setHeader('Content-Type', 'text/xml; charset=utf-8')
      if (profile.sabreRoot && req.method === 'PROPFIND') {
        res.writeHead(207).end(sabrePropfind(pathname, body))
        return
      }
      res.writeHead(207).end(multistatus(pathname, 'calendar'))
      return
    }

    if (req.method === 'PUT') {
      res.setHeader('ETag', '"etag-new"')
      res.writeHead(201).end()
      return
    }

    if (req.method === 'DELETE') {
      res.writeHead(204).end()
      return
    }

    if (profile.sabreRoot && !pathname.endsWith('.ics')) {
      // A folder: SabreDAV answers GET with an HTML page and no ETag.
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.writeHead(200).end('<!doctype html><title>Index</title>')
      return
    }

    res.setHeader('ETag', '"etag-1"')
    res.writeHead(200).end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
  })
})

server.listen(PORT, () => {
  console.log(`dav-server listening on http://localhost:${PORT}`)
})
