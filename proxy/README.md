# Calino self-hosted CORS proxy

A tiny, zero-dependency proxy that adds the CORS + WebDAV headers Calino needs
to talk to a CalDAV server from the browser. Use this if your CalDAV server
can't send CORS headers and you'd rather not use Cloudflare or edit your
reverse proxy.

## Run

**Docker Compose:**

```bash
docker compose up -d --build
```

**Plain Node (18+):**

```bash
node server.mjs
```

Listens on port `8081` by default. Then in Calino settings set:

- **Server URL** — your CalDAV server, e.g. `https://cal.example.com`
- **Proxy URL** — where this proxy is reachable, e.g. `http://localhost:8081`

Serve it over HTTPS (behind your own reverse proxy) in production so browsers
don't block it as mixed content.

## Config

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8081` | Port to listen on |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated Calino origins allowed to use the proxy. Empty = open to any origin. |
| `ALLOWED_TARGETS` | *(empty)* | Comma-separated host suffixes the proxy is allowed to fetch. Empty = any `https://` host (loopback, private, and cloud-metadata IPs are always blocked). |
| `MAX_BODY_BYTES` | `10485760` (10 MiB) | Maximum request body size in bytes. |
| `FETCH_TIMEOUT_MS` | `30000` (30 s) | Per-request upstream fetch timeout. |

## Notes

- Credentials (the `Authorization` header) and request/response bodies are
  passed straight through and not logged by this proxy. Note that the proxy
  terminates TLS, so whoever runs it *can* see the credentials and calendar
  data in plaintext — run your own, or enable CORS on your CalDAV server, if
  that matters to you.
- Does **not** follow redirects — preventing SSRF via 30x-redirect to
  internal IPs like cloud metadata services. Calino reads `X-Target-URL`
  for `.well-known` CalDAV discovery.
- Advertises `MKCOL, MKCALENDAR, COPY, MOVE` so calendar creation and Calino
  settings sync work.
- If you expose this proxy to the internet, set `ALLOWED_ORIGINS` (to your
  Calino instance) and ideally `ALLOWED_TARGETS` (to your CalDAV host) so it
  can't be used as an open relay.

When the proxy is enabled from the repository root with
`docker compose --profile proxy up -d`, the equivalent Compose variables are
`CALINO_PROXY_ALLOWED_ORIGINS` and `CALINO_PROXY_ALLOWED_TARGETS` in the root
`.env` file. The standalone `proxy/docker-compose.yml` uses the names in the
table above directly.

See [`../docs/CORS_PROXY.md`](../docs/CORS_PROXY.md) for all proxy options
(hosted, Cloudflare Worker, self-hosted).
