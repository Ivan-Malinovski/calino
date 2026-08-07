# CORS Proxy for Calino

If your CalDAV server doesn't support CORS headers, you can use a proxy to add them.

## First, check whether you need one

Before reaching for a proxy, run **Settings → Sync → Diagnose** on the account. It probes your
server check by check — reachability, preflight, credentials, DAV compliance classes, allowed
methods, collection listing, REPORT queries and ETag exposure — and names the specific header or
method that's missing. "Copy report" gives you a credential-free summary to paste into an issue.

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

**Privacy note:** This proxy sees your IP and CalDAV server URL, but **not** your credentials or calendar data. See Privacy Considerations below.

### 3. Self-Hosted Cloudflare Worker

Deploy your own proxy for maximum privacy:

**`worker.js`**

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Restrict to your own domain only
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || ''
    const allowedOrigins = ['https://calino.io', 'https://www.calino.io']
    const isAllowed = !origin || allowedOrigins.some((allowed) => origin.startsWith(allowed))
    if (!isAllowed) {
      return new Response('Forbidden: This proxy is only for Calino users', { status: 403 })
    }

    const pathParts = url.pathname.split('/').filter(Boolean)

    if (pathParts.length === 0) {
      return new Response('Missing target server in path', { status: 400 })
    }

    const targetBase = decodeURIComponent(pathParts[0])
    // Reconstruct path from raw pathname to preserve trailing slashes
    const rawPath = url.pathname.substring(url.pathname.indexOf('/', 1))
    const targetPath = rawPath || '/'

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods':
            'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE',
          'Access-Control-Allow-Headers':
            'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match',
        },
      })
    }

    const targetUrl = targetBase.replace(/\/$/, '') + targetPath
    const headers = new Headers(request.headers)
    headers.delete('host')

    try {
      // Follow redirects so .well-known discovery works, then expose the
      // final URL via X-Target-URL — Calino reads it to locate the real endpoint.
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'follow',
      })

      const corsHeaders = new Headers(response.headers)
      corsHeaders.set('Access-Control-Allow-Origin', '*')
      corsHeaders.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE'
      )
      corsHeaders.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match'
      )
      // ETag must be exposed or the browser hides it on PUT responses and
      // Calino needs an extra PROPFIND per write to recover it.
      corsHeaders.set('Access-Control-Expose-Headers', 'ETag, Location, X-Target-URL')
      corsHeaders.set('X-Target-URL', response.url)

      return new Response(response.body, {
        status: response.status,
        headers: corsHeaders,
      })
    } catch (e) {
      return new Response('Proxy error: ' + e.message, { status: 502 })
    }
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
docker compose up -d --build
```

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

It does **not** follow redirects (preventing SSRF via 30x-redirect to internal
IPs like cloud metadata services). It exposes `X-Target-URL` (needed for
`.well-known` discovery — Calino reads this header) and advertises the full
set of WebDAV methods — `MKCOL`, `MKCALENDAR`, `COPY`, `MOVE` — so calendar
creation and settings sync work.

> **Tip:** Serve the proxy over HTTPS behind your own reverse proxy (or on the
> same origin as Calino) so browsers don't block it as mixed content.

### 5. Third-Party Proxy Services

You can also use services like:

- [CORS Anywhere](https://github.com/Rob--W/cors-anywhere) (self-hosted)
- Any CORS proxy service you trust

## Privacy Considerations

### Using proxy.calino.io

If you use the Calino-hosted proxy at `proxy.calino.io`:

**We CAN see:**

- Your IP address and country (standard web server logs)
- The URL of your CalDAV server
- Request metadata (HTTP method, timing, response size)

**We CANNOT see:**

- Your username or password (sent in `Authorization` header, not logged)
- Your calendar event data (request/response bodies are not logged)
- The content of your calendars or events

### Using any proxy (including self-hosted)

The same applies to any CORS proxy you use - the operator can see connection metadata but not your credentials or calendar data. For maximum privacy, add CORS headers directly to your CalDAV server instead of using a proxy.
