# CORS Proxy for Calino

If your CalDAV or JMAP server doesn't support CORS headers, you can use a proxy to add them.

## First, check whether you need one

Before reaching for a proxy, run **Settings → Sync → Diagnose** on the account. It probes your
server check by check — reachability, preflight, credentials, DAV compliance classes, allowed
methods, collection listing, REPORT queries and ETag exposure (for JMAP servers: the session, the
API endpoint, calendars and live updates) — and names the specific header or method that's missing.
If this page itself refuses the request (an `http://` server from an https page, or a build that
only allows https), it says so first: no server setting can fix that. "Copy report" gives you a credential-free summary to paste into an issue.

A caveat worth knowing: browsers deliberately hide a server's `Access-Control-Allow-*` headers
from JavaScript, so on the web some verdicts are marked **inferred** — deduced from which requests
survived rather than read off the response. Adding `DAV, Allow` to your server's
`Access-Control-Expose-Headers` lets Calino read those two directly. On Android there's no CORS
layer at all, so everything is observed.

Diagnostics run **through** your proxy when one is configured, which means the CORS checks then
describe the proxy rather than your server; those are reported as "not applicable" instead of
passing on irrelevant evidence.

## Quick Options

### 1. Local Development Proxy

For local development, configure your dev server to proxy requests to your CalDAV server.

### 2. Use the Calino Proxy (Easiest)

We host a public CORS proxy at `https://proxy.calino.io` for Calino users who can't add CORS headers to their server:

1. In Calino settings, enter:
   - **Server URL**: Your CalDAV server (e.g., `https://cal.example.com`)
   - **Proxy URL**: `https://proxy.calino.io`

**Important:** This proxy is restricted to Calino users only. It checks the Origin header and will reject requests from outside `calino.io` domains.

**Privacy note:** The proxy necessarily receives the authenticated CalDAV
requests and responses. The hosted service is designed not to log credentials or
calendar bodies, but its operator could technically observe them in memory while
requests are being handled. Use a proxy you operate or configure CORS directly
when that matters. See Privacy Considerations below.

### 3. Self-Hosted Cloudflare Worker

Deploy your own proxy if you trust the Worker operator. This is the same code
that runs `proxy.calino.io`. It follows redirects (so `.well-known` discovery
works), blocks loopback, private, link-local and cloud-metadata addresses, and
supports origin and target allowlists. Set `ALLOWED_ORIGINS` and
`ALLOWED_TARGETS` (Worker settings → Variables) before exposing it publicly.
Because it follows redirects server-side, a hostname that redirects somewhere
internal is not re-checked; `ALLOWED_TARGETS` is the control for that. The
bundled Docker proxy below only follows redirects when Calino asks for it.

**`worker.js`**

```javascript
// Calino CORS proxy — Cloudflare Worker.
//
// Optional env vars (Settings → Variables):
//   ALLOWED_ORIGINS  Comma-separated Calino origins allowed to use this proxy.
//                    Unset = allow any origin (fine for private use; set it for
//                    an internet-exposed deployment).
//   ALLOWED_TARGETS  Comma-separated host suffixes the proxy may fetch
//                    (e.g. "caldav.fastmail.com,dav.mydomain.com"). Unset = any
//                    https host (except the SSRF denylist below).
//   MAX_BODY_BYTES   Max request body (default 10 MiB).
//   FETCH_TIMEOUT_MS Upstream timeout until response headers arrive (default 30000).

const ALLOW_METHODS =
  'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE'
const ALLOW_HEADERS =
  'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match, X-Follow-Redirects'
const EXPOSE_HEADERS = 'Location, X-Target-URL, ETag, WWW-Authenticate, Retry-After'

// Authorization IS forwarded — Calino authenticates to its CalDAV server with
// Basic auth through this proxy. Cookie and other headers are NOT forwarded.
const FORWARDED_HEADERS = new Set([
  'authorization',
  'content-type',
  'depth',
  'prefer',
  'if-none-match',
  'if-match',
  'accept',
  'accept-language',
])

function list(v) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean)
}

function isOriginAllowed(origin, allowed) {
  if (!allowed.length) return true
  if (!origin) return false
  return allowed.some((a) => origin === a || origin.startsWith(a + '/'))
}

function corsAllowOrigin(origin, allowed) {
  if (!allowed.length) return '*'
  return isOriginAllowed(origin, allowed) ? origin : null
}

// Block loopback / private / link-local / metadata hosts, even without an
// allowlist. Hostnames (DNS names) pass — Workers can't reach private IPs
// anyway; this is defense-in-depth against literal-IP targets.
function isBlockedHost(host) {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    const p = bare.split('.').map(Number)
    if (p.some((n) => n > 255)) return true
    const [a, b] = p
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local + cloud metadata
    return false
  }
  // IPv6
  if (bare.includes(':')) {
    if (bare === '::1' || bare === '::') return true
    const first = parseInt(bare.split(':')[0] || '0', 16) || 0
    if (first >= 0xfc00 && first <= 0xfdff) return true // unique-local
    if (first >= 0xfe80 && first <= 0xfebf) return true // link-local
    const mapped = bare.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
    if (mapped) return isBlockedHost(mapped[1])
    return false
  }
  return false
}

export default {
  async fetch(request, env = {}) {
    const allowedOrigins = list(env.ALLOWED_ORIGINS)
    const allowedTargets = list(env.ALLOWED_TARGETS).map((s) => s.toLowerCase())
    const maxBody = Number(env.MAX_BODY_BYTES) || 10 * 1024 * 1024
    const timeoutMs = Number(env.FETCH_TIMEOUT_MS) || 30000

    const origin = request.headers.get('origin')
    const allowOrigin = corsAllowOrigin(origin, allowedOrigins)

    // Origin gate (no CORS headers on reject, so the browser refuses it).
    if (allowedOrigins.length && !isOriginAllowed(origin, allowedOrigins)) {
      return new Response('Forbidden', { status: 403 })
    }

    // CORS preflight.
    if (request.method === 'OPTIONS') {
      if (allowOrigin === null) return new Response('Forbidden', { status: 403 })
      const h = {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': ALLOW_METHODS,
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        'Access-Control-Max-Age': '86400',
      }
      if (allowOrigin !== '*') h['Vary'] = 'Origin'
      return new Response(null, { status: 204, headers: h })
    }

    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('Calino CORS proxy OK', { status: 200 })
    }

    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length === 0) {
      return new Response('Missing target server in path', { status: 400 })
    }

    // First segment is the url-encoded target origin; the rest is the path.
    let targetBase
    try {
      targetBase = decodeURIComponent(pathParts[0])
      new URL(targetBase)
    } catch {
      return new Response('Invalid target URL', { status: 400 })
    }

    const targetParsed = new URL(targetBase)
    if (targetParsed.protocol !== 'https:' && targetParsed.protocol !== 'http:') {
      return new Response('Unsupported target scheme', { status: 400 })
    }
    if (targetParsed.protocol === 'http:' && !allowedTargets.length) {
      return new Response('http targets disabled (set ALLOWED_TARGETS)', { status: 400 })
    }
    const host = targetParsed.hostname.toLowerCase()
    if (isBlockedHost(host)) {
      return new Response('Target host not allowed', { status: 403 })
    }
    if (
      allowedTargets.length &&
      !allowedTargets.some((s) => host === s || host.endsWith('.' + s))
    ) {
      return new Response('Target host not in allowlist', { status: 403 })
    }

    // Reconstruct the path (preserve trailing slash) + query string.
    const rawPath = url.pathname.substring(url.pathname.indexOf('/', 1))
    const targetUrl = targetBase.replace(/\/$/, '') + (rawPath || '/') + url.search

    // Forward only allowlisted headers.
    const headers = new Headers()
    for (const [k, v] of request.headers) {
      if (FORWARDED_HEADERS.has(k.toLowerCase())) headers.set(k, v)
    }

    // Buffer the body (within cap) so redirects can be replayed.
    let body
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const declared = Number(request.headers.get('content-length')) || 0
      if (declared > maxBody) {
        return new Response('Payload too large', { status: 413 })
      }
      const buf = await request.arrayBuffer()
      if (buf.byteLength > maxBody) {
        return new Response('Payload too large', { status: 413 })
      }
      body = buf.byteLength ? buf : undefined
    }

    // The timeout covers the wait for response headers only. It is cleared once
    // they arrive, so a long-lived stream (JMAP push events) is not cut off.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body,
        redirect: 'follow', // so .well-known discovery + trailing-slash redirects work
        signal: controller.signal,
      })
    } catch (e) {
      return new Response('Proxy error: ' + (e?.name || 'fetch failed'), { status: 502 })
    } finally {
      clearTimeout(timer)
    }

    const out = new Headers(response.headers)
    out.delete('content-encoding')
    out.delete('content-length')
    out.delete('transfer-encoding')
    if (allowOrigin !== null) out.set('Access-Control-Allow-Origin', allowOrigin)
    if (allowOrigin && allowOrigin !== '*') out.append('Vary', 'Origin')
    out.set('Access-Control-Allow-Methods', ALLOW_METHODS)
    out.set('Access-Control-Allow-Headers', ALLOW_HEADERS)
    out.set('Access-Control-Expose-Headers', EXPOSE_HEADERS)

    // Expose the final URL (credentials stripped) for Calino's discovery.
    try {
      const clean = new URL(response.url)
      clean.username = ''
      clean.password = ''
      out.set('X-Target-URL', clean.href)
    } catch {
      /* leave unset */
    }

    return new Response(response.body, { status: response.status, headers: out })
  },
}
```

**Usage:**

1. Create a new Worker at [workers.cloudflare.com](https://workers.cloudflare.com)
2. Paste the code above
3. In Calino settings, enter:
   - **Server URL**: Your CalDAV server (e.g., `https://cal.example.com`)
   - **Proxy URL**: Your worker URL (e.g., `https://your-worker.workers.dev`)

### 4. Self-Hosted Docker Proxy (no Cloudflare needed)

If you'd rather not use Cloudflare — or don't want to touch your reverse
proxy config — Calino ships a tiny standalone proxy in [`proxy/`](../proxy).
It's a single zero-dependency Node file (`proxy/server.mjs`, Node 18+) with a
Dockerfile and compose file.

**Easiest — enable it alongside Calino** (uses the profile in the main
`docker-compose.yml`, so the proxy shares Calino's Docker network):

```bash
docker compose --profile proxy up -d
```

**Or run it on its own** from the `proxy/` directory:

```bash
cd proxy
docker compose up -d
```

Compose pulls the published multi-architecture image
`ghcr.io/ivan-malinovski/calino-proxy:latest` and falls back to the local
`Dockerfile` if the image is unavailable. Add `--build` to force a local
rebuild.

Either way it serves the proxy on port `8081`. Then in Calino settings, enter:

- **Server URL**: Your CalDAV server (e.g., `https://cal.example.com`)
- **Proxy URL**: `http://<your-host>:8081` (put it behind HTTPS in production)

**Run without Docker:**

```bash
node proxy/server.mjs   # listens on :8081
```

**Configuration** (environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8081` | Port to listen on |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated Calino origins allowed to use the proxy. Empty = open to any origin (fine for a private deployment). e.g. `https://calendar.example.com` |
| `ALLOWED_TARGETS` | *(empty)* | Comma-separated host suffixes the proxy is allowed to fetch. Empty = only `https://` targets accepted; `http://` is rejected. Setting this further restricts which CalDAV servers can be reached (defense in depth against SSRF). Hostnames are IDN-normalized via `domainToASCII` before comparison. e.g. `dav.example.com,my-other-server.org` |
| `MAX_BODY_BYTES` | `10485760` (10 MiB) | Maximum request body size in bytes. CalDAV iCal objects are tiny — anything bigger is almost certainly abuse. |
| `FETCH_TIMEOUT_MS` | `30000` (30 s) | Per-request upstream fetch timeout. |

By default it does **not** follow redirects (30x responses are relayed as-is),
which keeps a hostile target from bouncing a request to an internal address. It
follows them only when the request carries `X-Follow-Redirects: 1`, which Calino
sends for discovery probes and the JMAP session request, since the browser can't
follow a cross-origin redirect itself. It exposes `X-Target-URL` (the final URL
after any redirect; Calino reads it to locate the real endpoint), `ETag`,
`Location`, and for JMAP `WWW-Authenticate` and `Retry-After`. It advertises the
full set of WebDAV methods — `MKCOL`, `MKCALENDAR`, `COPY`, `MOVE` — so calendar
creation and settings sync work.

> **Tip:** Serve the proxy over HTTPS behind your own reverse proxy (or on the
> same origin as Calino) so browsers don't block it as mixed content.

### 5. Third-Party Proxy Services

You can also use services like:

- [CORS Anywhere](https://github.com/Rob--W/cors-anywhere) (self-hosted)
- Any CORS proxy service you trust

## JMAP servers

Calino also speaks JMAP (calendars and contacts), and the same proxy serves it:
enter the server and the proxy URL as usual, and Calino detects the protocol.
What a JMAP server needs from a proxy:

- `POST` with `Content-Type: application/json` to the API URL.
- `X-Follow-Redirects` allowed in `Access-Control-Allow-Headers`, because the
  session request goes to `/.well-known/jmap`, which servers redirect.
- `X-Target-URL`, `WWW-Authenticate` and `Retry-After` in
  `Access-Control-Expose-Headers`. Without `WWW-Authenticate`, a wrong password
  can't be told apart from "this isn't a JMAP server"; without `Retry-After`
  the server's rate-limit delay is ignored.
- A response timeout that stops once headers arrive, so the live-update
  (EventSource) stream stays open. The Docker proxy and the Worker above do
  this.

The Worker above and `proxy/server.mjs` already do all of this. **If you
deployed a Worker from an older version of this page**, update its
`ALLOW_HEADERS` and `EXPOSE_HEADERS` constants (and the timeout handling) to
match, otherwise JMAP connections through it fail at the first request.
Diagnose (Settings → Sync) reports the missing piece.

A proxy can't reach loopback or private addresses, so a JMAP server on your LAN
needs CORS enabled on the server itself (Stalwart: "Use permissive CORS", see
[`JMAP_TESTING.md`](./JMAP_TESTING.md)) or a proxy running on that network.

## Privacy Considerations

### Using proxy.calino.io

If you use the Calino-hosted proxy at `proxy.calino.io`:

**We CAN see:**

- Your IP address and country (standard web server logs)
- The URL of your CalDAV server
- Request metadata (HTTP method, timing, response size)

**We do not intentionally log:**

- Authorization headers and request/response bodies

The proxy still terminates the browser's connection and forwards the
authenticated request, so the operator could observe credentials and calendar
content in process memory. HTTPS protects the browser-to-proxy hop, not the
proxy operator from seeing what the proxy handles.

### Using any proxy (including self-hosted)

The operator of any proxy can potentially see credentials and calendar data
while forwarding requests, even if the service does not retain or log them. For
maximum privacy, add CORS headers directly to your CalDAV server instead of
using a proxy. If you do run a proxy, restrict both allowed origins and target
hosts, and serve it over HTTPS.
