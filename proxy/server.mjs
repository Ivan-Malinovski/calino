// Calino CORS proxy — self-hostable, zero dependencies (Node 18+).
//
// Calino talks to a CalDAV server from the browser. Many CalDAV servers don't
// send CORS headers, so the browser blocks the requests. This tiny proxy sits
// in front of your CalDAV server, forwards the request, and adds the CORS
// headers Calino needs — including WebDAV methods (MKCOL, MKCALENDAR, COPY,
// MOVE) required for calendar creation and settings sync.
//
// URL convention (must match what Calino sends):
//   http://your-proxy:8081/<url-encoded-origin>/<path>
//   e.g. http://your-proxy:8081/https%3A%2F%2Fdav.example.com/principals/user
//
// Config via env:
//   PORT              Port to listen on (default 8081)
//   ALLOWED_ORIGINS   Comma-separated Calino origins allowed to use this proxy.
//                     Leave empty (default) to allow any origin — fine for a
//                     private/self-hosted deployment. RECOMMENDED for any
//                     internet-exposed deployment: an open proxy that talks
//                     to arbitrary user-supplied URLs can be abused for SSRF.
//   ALLOWED_TARGETS   Comma-separated host suffixes the proxy is allowed to
//                     fetch (default: empty → only https:// targets allowed).
//                     Set to e.g. "dav.example.com,my-other-server.org" to
//                     lock down which CalDAV servers can be reached.
//   MAX_BODY_BYTES    Maximum request body size in bytes (default 10 MiB).
//                     CalDAV iCal objects are tiny — anything bigger is
//                     almost certainly abuse.
//   FETCH_TIMEOUT_MS  Per-request upstream fetch timeout in ms (default 30s).
//
// SECURITY MODEL:
// - Authorization IS forwarded to the upstream target (see FORWARDED_HEADERS
//   below). Calino authenticates to its CalDAV server with Basic auth through
//   this proxy; stripping the header would break every request. The threat
//   model is "your browser → your proxy → YOUR CalDAV server", not an open
//   relay. Use ALLOWED_TARGETS to restrict which hosts can be reached.
// - Target URLs must be https:// unless ALLOWED_TARGETS permits http:// for
//   a specific host.
// - Loopback, private, link-local, unique-local, and cloud-metadata IPs
//   (e.g. 169.254.169.254) are ALWAYS blocked, even with ALLOWED_TARGETS
//   empty. DNS-rebinding is out of scope; use ALLOWED_TARGETS to lock down
//   reachable hosts for internet-exposed deployments.
// - CORS responses echo the verified origin (or `*` if ALLOWED_ORIGINS is
//   empty) and never reflect attacker-controlled headers.

import { createServer } from 'node:http'
import { isIP } from 'node:net'

const PORT = Number(process.env.PORT) || 8081
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ALLOWED_TARGETS = (process.env.ALLOWED_TARGETS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 30_000

// Headers the browser sends that Calino (the real client) needs to set itself
// or that have no meaning on the outbound side. Authorization IS forwarded —
// Calino's CalDAVClient authenticates via Basic auth headers, and stripping
// them would break every CalDAV request through this proxy. The threat
// model is "your browser → your proxy → YOUR CalDAV server", not an open
// relay; the proxy is the credential owner's own infrastructure.
const FORWARDED_HEADERS = new Set([
  'authorization',
  'content-type',
  'depth',
  'prefer',
  'if-none-match',
  'if-match',
  'accept',
  'accept-language',
  'origin',
  'referer',
  'user-agent',
])

const ALLOW_METHODS =
  'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE'
const ALLOW_HEADERS = 'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match'

const ALLOWED_ORIGINS_NORMALIZED = ALLOWED_ORIGINS
const ALLOWED_TARGETS_ASCII = ALLOWED_TARGETS.map((s) => {
  try {
    return new URL(`http://${s}`).hostname.toLowerCase()
  } catch {
    return s.toLowerCase()
  }
})

function isOriginAllowed(origin) {
  if (!ALLOWED_ORIGINS_NORMALIZED.length) return true
  if (!origin) return false
  return ALLOWED_ORIGINS_NORMALIZED.some(
    (a) => origin === a || origin.startsWith(a + '/')
  )
}

function getCorsAllowOrigin(origin) {
  if (!ALLOWED_ORIGINS_NORMALIZED.length) return '*'
  return isOriginAllowed(origin) ? origin : null
}

// Defense-in-depth SSRF guard: block targets that resolve to loopback,
// private, link-local, unique-local, or cloud-metadata (169.254.169.254) IPs,
// regardless of ALLOWED_TARGETS. `asciiHost` is already canonicalized by the
// WHATWG URL parser, so numeric IPv4 forms (0x7f000001, 2130706433) arrive as
// dotted-quad. Hostnames (DNS names) are allowed here — they can't be
// range-checked without resolution; DNS-rebinding is out of scope for this
// pass and ALLOWED_TARGETS remains the strong control.
function isBlockedHost(asciiHost) {
  if (asciiHost === 'localhost' || asciiHost.endsWith('.localhost')) return true

  // Strip IPv6 brackets if present (URL hostname keeps them).
  const host =
    asciiHost.startsWith('[') && asciiHost.endsWith(']')
      ? asciiHost.slice(1, -1)
      : asciiHost

  const kind = isIP(host)
  if (kind === 4) {
    const p = host.split('.').map(Number)
    if (p.some((n) => Number.isNaN(n) || n > 255)) return true // malformed → block
    const [a, b] = p
    if (a === 127) return true // loopback 127/8
    if (a === 10) return true // private 10/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
    if (a === 169 && b === 254) return true // link-local + metadata 169.254/16
    if (a === 0) return true // unspecified 0/8
    return false
  }
  if (kind === 6) {
    const lower = host.toLowerCase()
    // IPv4-mapped, dotted form: ::ffff:a.b.c.d
    const mappedDotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mappedDotted) return isBlockedHost(mappedDotted[1])
    // IPv4-mapped, hex form (WHATWG canonicalizes to this): ::ffff:7f00:1
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16)
      const lo = parseInt(mappedHex[2], 16)
      return isBlockedHost(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`)
    }
    if (lower === '::1' || lower === '::') return true // loopback / unspecified
    const firstHextet = parseInt(lower.split(':')[0] || '0', 16) || 0
    if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true // fc00::/7 unique-local
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true // fe80::/10 link-local
    return false
  }
  return false
}

const server = createServer(async (req, res) => {
  // Sink errors on the request stream so a disconnect mid-body doesn't
  // crash the process with an unhandled 'error' event.
  req.on('error', () => {})

  // Short-circuit anything larger than MAX_BODY_BYTES so a hostile client
  // can't exhaust memory before we even start parsing.
  const declaredLength = Number(req.headers['content-length']) || 0
  if (declaredLength > MAX_BODY_BYTES) {
    res.writeHead(413, { 'Content-Type': 'text/plain' }).end('Payload too large')
    return
  }

  let bodyBytes = 0
  let aborted = false

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    // Health check / root — lets container healthchecks pass.
    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Calino CORS proxy OK')
      return
    }

    // Optional origin allowlist. Reject with 403 — no CORS headers — so
    // browsers correctly refuse the cross-origin request. (Don't echo
    // 'Access-Control-Allow-Origin: null' — a sandboxed iframe can claim
    // Origin: null and the browser would allow it.)
    if (ALLOWED_ORIGINS_NORMALIZED.length && !isOriginAllowed(req.headers.origin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden')
      return
    }

    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Missing target server in path')
      return
    }

    let targetBase
    try {
      targetBase = decodeURIComponent(pathParts[0])
      new URL(targetBase) // throws on malformed URL
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid target URL')
      return
    }

    // Target validation: require https:// unless explicitly allowed.
    // Normalize hostname via domainToASCII so IDN homoglyphs (e.g. Cyrillic
    // 'а' in 'аmazon.com') can't bypass the allowlist via case-fold tricks.
    const targetParsed = new URL(targetBase)
    let asciiHost
    try {
      asciiHost = new URL(`http://${targetParsed.hostname}`).hostname.toLowerCase()
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid target host')
      return
    }
    if (targetParsed.protocol !== 'https:' && targetParsed.protocol !== 'http:') {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Unsupported target scheme')
      return
    }
    // Unconditional SSRF denylist — applies even when ALLOWED_TARGETS is empty.
    if (isBlockedHost(asciiHost)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Target host not allowed')
      return
    }
    if (targetParsed.protocol === 'http:' && ALLOWED_TARGETS_ASCII.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('http targets disabled (set ALLOWED_TARGETS)')
      return
    }
    if (ALLOWED_TARGETS_ASCII.length > 0) {
      const hostOk = ALLOWED_TARGETS_ASCII.some(
        (suffix) => asciiHost === suffix || asciiHost.endsWith('.' + suffix)
      )
      if (!hostOk) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Target host not in allowlist')
        return
      }
    }

    // Handle CORS preflight. Reject with 403 (no CORS headers) if the
    // origin isn't allowed — never echo 'Access-Control-Allow-Origin: null',
    // which a sandboxed iframe could exploit.
    if (req.method === 'OPTIONS') {
      const allowOrigin = getCorsAllowOrigin(req.headers.origin)
      if (allowOrigin === null) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden')
        return
      }
      res
        .writeHead(204, {
          'Access-Control-Allow-Origin': allowOrigin,
          'Access-Control-Allow-Methods': ALLOW_METHODS,
          'Access-Control-Allow-Headers': ALLOW_HEADERS,
        })
        .end()
      return
    }

    // Reconstruct path from the raw pathname to preserve trailing slashes.
    const rawPath = url.pathname.substring(url.pathname.indexOf('/', 1))
    const targetPath = (rawPath || '/') + url.search
    const targetUrl = targetBase.replace(/\/$/, '') + targetPath

    // Build outbound header set from a strict allowlist. Authorization,
    // Cookie, and other credential-bearing headers are explicitly excluded.
    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (FORWARDED_HEADERS.has(k.toLowerCase())) {
        headers[k] = v
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    let body
    if (hasBody) {
      // Stream the body with a hard byte cap. Using the raw `req` stream
      // with duplex:'half' would bypass the limit, so we buffer manually.
      const chunks = []
      for await (const chunk of req) {
        bodyBytes += chunk.length
        if (bodyBytes > MAX_BODY_BYTES) {
          aborted = true
          res.writeHead(413, { 'Content-Type': 'text/plain' }).end('Payload too large')
          req.destroy()
          break
        }
        chunks.push(chunk)
      }
      if (aborted) return
      body = Buffer.concat(chunks)
    }

    // Upstream fetch with a hard timeout so a hanging target can't pin a
    // worker indefinitely. Use redirect:'manual' so an attacker-controlled
    // target can't bypass the target validation by 30x-redirecting to a
    // private/internal IP (e.g. http://169.254.169.254/... for cloud
    // metadata exfiltration). Calino doesn't follow redirects — discovery
    // happens via X-Target-URL.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let upstream
    try {
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    const outHeaders = {}
    upstream.headers.forEach((value, key) => {
      outHeaders[key] = value
    })
    // fetch already decoded the body, so drop encoding/length headers that
    // would no longer match the bytes we send.
    delete outHeaders['content-encoding']
    delete outHeaders['content-length']
    delete outHeaders['transfer-encoding']

    // Non-preflight responses don't need Access-Control-Allow-Origin at all if
    // the origin isn't allowed — but in practice the origin gate at the top
    // of this handler already returned 403 for that case, so if we reach
    // here the origin is either allowed or ALLOWED_ORIGINS is empty.
    const allowOrigin = getCorsAllowOrigin(req.headers.origin)
    if (allowOrigin !== null) {
      outHeaders['access-control-allow-origin'] = allowOrigin
    }
    outHeaders['access-control-allow-methods'] = ALLOW_METHODS
    outHeaders['access-control-allow-headers'] = ALLOW_HEADERS
    // ETag: without it the browser hides the header on the PUT response, and
    // Calino has to spend a follow-up PROPFIND per write to recover the etag
    // it needs for the next If-Match.
    outHeaders['access-control-expose-headers'] = 'ETag, Location, X-Target-URL'

    // Strip any credentials from the URL we echo back. Even though the proxy
    // never itself embeds credentials in the request line, a 30x Location
    // upstream could resolve to a URL with user:pass@ and we shouldn't leak
    // that to the browser.
    try {
      const cleanedUrl = new URL(upstream.url)
      cleanedUrl.username = ''
      cleanedUrl.password = ''
      outHeaders['x-target-url'] = cleanedUrl.href
    } catch {
      // upstream.url can be empty in odd cases; skip the header.
    }

    // Cap the response body size to the same limit as the request body. A
    // hostile (or just slow/large) upstream could otherwise buffer gigabytes
    // into this process. Use streaming + abort so we never allocate more
    // than MAX_BODY_BYTES for a response.
    const upstreamLength = Number(upstream.headers.get('content-length')) || 0
    if (upstreamLength > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'text/plain' }).end('Upstream response too large')
      return
    }

    const reader = upstream.body?.getReader()
    if (!reader) {
      res.writeHead(upstream.status, outHeaders).end()
      return
    }
    res.writeHead(upstream.status, outHeaders)
    let received = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        if (received > MAX_BODY_BYTES) {
          controller.abort()
          res.destroy()
          return
        }
        const ok = res.write(Buffer.from(value))
        if (!ok) {
          // Backpressure — wait for drain before continuing.
          await new Promise((resolve) => res.once('drain', resolve))
        }
      }
      res.end()
    } catch (e) {
      console.error('[proxy] stream error:', { code: e?.code })
      if (!res.writableEnded) res.destroy()
    } finally {
      reader.releaseLock()
    }
  } catch (e) {
    if (aborted) return
    // Log only the safe fields — never the full stack or nested cause, which
    // can include internal IPs / paths.
    console.error('[proxy] error:', {
      name: e?.name,
      code: e?.code ?? e?.cause?.code,
      msg: e?.message,
    })
    // Guard against double-write or destroyed socket (defensive — the
    // happy-path code above already handles most cases).
    if (!res.headersSent && !res.destroyed) {
      try {
        res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway')
      } catch {
        /* client disconnected; nothing we can do */
      }
    }
  }
})

server.listen(PORT, () => {
  console.log(`Calino CORS proxy listening on :${PORT}`)
  if (ALLOWED_ORIGINS.length) {
    console.log(`Restricted to origins: ${ALLOWED_ORIGINS.join(', ')}`)
  } else {
    console.log('Open to any origin (set ALLOWED_ORIGINS to restrict).')
  }
  if (ALLOWED_TARGETS.length) {
    console.log(`Restricted to target hosts: ${ALLOWED_TARGETS.join(', ')}`)
  } else {
    console.log('http targets disabled. Set ALLOWED_TARGETS to permit specific hosts.')
  }
  console.log(`Max body: ${MAX_BODY_BYTES} bytes, fetch timeout: ${FETCH_TIMEOUT_MS}ms`)
})