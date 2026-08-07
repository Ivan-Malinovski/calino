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
 *
 * Zero dependencies, so it runs anywhere `node` does.
 */
import { createServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TLS, because Calino's CSP is `connect-src 'self' https:` — a plain-http
 * origin is blocked by the browser before a request is ever made, which would
 * make every scenario here look like an unreachable server.
 */
function selfSignedCert() {
  const dir = process.env.DAV_CERT_DIR ?? mkdtempSync(join(tmpdir(), 'calino-dav-'))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  if (!existsSync(key) || !existsSync(cert)) {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '3650',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' }
    )
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

const PORT = Number(process.env.DAV_PORT ?? 8099)

const ALLOW_METHODS =
  'GET, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE'
const ALLOW_HEADERS = 'Authorization, Content-Type, Depth, Prefer, If-Match, If-None-Match'

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
  const healthy = { cors: true, exposeEtag: true, report: true, unauthorized: false }
  if (pathname.startsWith('/no-cors')) return { ...healthy, cors: false }
  if (pathname.startsWith('/no-etag')) return { ...healthy, exposeEtag: false }
  if (pathname.startsWith('/no-report')) return { ...healthy, report: false }
  if (pathname.startsWith('/401')) return { ...healthy, unauthorized: true }
  return healthy
}

const server = createServer(selfSignedCert(), (req, res) => {
  const { pathname } = new URL(req.url, `https://localhost:${PORT}`)
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
    res.setHeader('Allow', ALLOW_METHODS)
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

  // Drain the request body; PROPFIND and REPORT both send one.
  req.resume()
  req.on('end', () => {
    res.setHeader('DAV', '1, 2, 3, calendar-access')

    if (req.method === 'PROPFIND' || req.method === 'REPORT') {
      res.setHeader('Content-Type', 'text/xml; charset=utf-8')
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

    res.setHeader('ETag', '"etag-1"')
    res.writeHead(200).end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
  })
})

server.listen(PORT, () => {
  console.log(`dav-server listening on https://localhost:${PORT}`)
})
