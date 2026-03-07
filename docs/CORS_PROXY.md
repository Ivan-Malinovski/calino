# CORS Proxy for Calino

If your CalDAV server doesn't support CORS headers, you can use a proxy to add them.

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
    let targetPath = '/' + pathParts.slice(1).join('/')

    // Redirect .well-known/caldav to dav.php
    if (targetPath === '/.well-known/caldav') {
      targetPath = '/dav.php'
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods':
            'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS',
          'Access-Control-Allow-Headers':
            'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match',
        },
      })
    }

    const targetUrl = targetBase.replace(/\/$/, '') + targetPath
    const headers = new Headers(request.headers)
    headers.delete('host')

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.body,
      })

      const corsHeaders = new Headers(response.headers)
      corsHeaders.set('Access-Control-Allow-Origin', '*')
      corsHeaders.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS'
      )
      corsHeaders.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match'
      )

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

### 4. Third-Party Proxy Services

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
