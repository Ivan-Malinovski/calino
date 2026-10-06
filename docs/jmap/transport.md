# JMAP transport

`src/features/jmap/client/JmapClient.ts` implements the browser transport;
calendar/iCalendar conversion and the calendar backend belong to separate layers.
The wire protocol follows [JMAP Core, RFC 8620](https://www.rfc-editor.org/rfc/rfc8620.html).
The calendar capability URN comes from `src/features/jmap/types.ts`.

## Public API and request flow

```ts
const client = new JmapClient({
  serverUrl,
  username,
  password,
  customHeaders,
  proxyUrl,
})
await client.connect()
const response = await client.call([
  ['CalendarEvent/query', { accountId: client.accountId }, 'query'],
  [
    'CalendarEvent/get',
    {
      accountId: client.accountId,
      ...resultReference('ids', 'query', 'CalendarEvent/query', '/ids'),
    },
    'get',
  ],
])
```

`connect()` GETs the session URL with redirects enabled. Bare server URLs use
`/.well-known/jmap`; a typed `/jmap/session` or `/.well-known/jmap` is used
directly. A typed path also supplies a path-local well-known fallback. The
session must advertise core and have the required Session object fields. Public
getters expose `session`, `accountId` (the primary calendar account), `username`,
`capabilities`, `accountCapabilities`, `apiUrl`, `uploadUrl`, `downloadUrl`, and
`eventSourceUrl`. Endpoint URLs are resolved against the final session URL and
prefixed with the account proxy when configured. URI template variables survive
resolution and are percent-encoded individually when expanded.

`call(methodCalls, using?)` accepts typed `[name, arguments, callId]` tuples and
returns `{ methodResponses, sessionState, createdIds }`. The default `using`
contains core and calendars; core is always included. A changed response
`sessionState` refetches the session before the next request. Concurrent refresh
attempts share one promise. A successful write is never automatically replayed
because its session refresh failed.

Core `maxCallsInRequest` limits batch size. Explicit `/get` IDs and the combined
`/set` create/update/destroy operations are partitioned at `maxObjectsInGet` and
`maxObjectsInSet`. Missing limits impose no local bound. Split results are
merged under their original call IDs; get lists/notFound and set success/error
maps are combined. A split get with changing data state fails with
`stateMismatch`/412 so the caller can retry the read. Conditional split sets
advance `ifInState` to each preceding response's `newState`.

`resultReference(argument, resultOf, name, path)` creates a `#argument` property.
References to completed calls are resolved locally, supporting escaped JSON
pointers and array wildcards. Get/set producers are flushed first so referenced
objects can also be split at the session limits; other references remain on the
wire when producer and consumer share a batch. Creation IDs are carried in the
top-level request `createdIds` map between batches.

Split writes are sequential and may partially succeed. There is no rollback or
automatic retry of writes. Sets with `onSuccess…` arguments that require splitting
are rejected before that set is submitted: implicit follow-up operations cannot
be safely partitioned here. Per-object `notCreated`, `notUpdated`, and
`notDestroyed` results stay in successful set responses for the backend to handle.
Method-level `error` results throw and retain the batch responses on the error.

`upload(blob: Blob | ArrayBuffer, type)` returns `{ blobId, size, type }`;
`download(blobId, name, type)` returns a `Blob`. Both use the primary calendar
account and the advertised URL templates, with a 30-second request timeout.

## Authentication, headers, proxy and platforms

Every request sends UTF-8-safe HTTP Basic authentication via `basicAuthHeader`.
JSON API calls use CalDAV's exported `fetchWithTimeout` and `createProxyFetch`;
direct connections use `validateCustomHeaders` and `createDirectDavFetch`.
Reserved/duplicate/invalid headers are rejected, and custom headers cannot be
combined with a proxy. With custom headers, redirects and origin changes are
rejected, matching DAV's protection against leaking gateway credentials. Enter
the final session URL when a gateway requires custom headers.

Proxy URLs use `prefixUrlWithProxy` and are prefixed once. Session GET requests
send `X-Follow-Redirects: 1`; the proxy's `X-Target-URL` supplies the final upstream
URL for relative endpoint resolution. Proxies must expose that header when the
session redirects and contains relative endpoints. Authentication challenges
also need exposed `WWW-Authenticate` for detection; rate limiting needs exposed
`Retry-After` to honor the server's delay.

JSON/session requests use `webFetch`, so native and headless Android retain the
existing DAV bridge. Binary transfers and streams use browser fetch (the
pre-Capacitor-patch `CapacitorWebFetch` when available). The current native DAV
bridge converts bodies to text and buffers whole responses, so it cannot safely
carry binary blobs or an indefinite SSE stream. Browser fetch needs server CORS
or an account proxy; native binary/push support requires device verification.
No Node APIs are used by the transport implementation.

## Error mapping

`JmapError` extends `CalDAVConnectionError`; `code` uses the existing
`SyncErrorCode` vocabulary and the existing UI supplies translated messages.
It retains `status`, `body`, `retryAfter` (seconds), JMAP `type`, method/call ID,
structured `details`, and method responses where available.

| Failure                                                   | Code                         | Status    |
| --------------------------------------------------------- | ---------------------------- | --------- |
| HTTP 401                                                  | auth                         | 401       |
| HTTP 403 / forbidden / accountReadOnly                    | forbidden                    | 403       |
| fetch/network failure                                     | network (cors when explicit) | absent    |
| aborted request                                           | timeout                      | absent    |
| HTTP 429 / rateLimit                                      | rate-limited                 | 429       |
| HTTP 507 / overQuota                                      | quota                        | 507       |
| accountNotFound / notFound                                | not-found                    | 404       |
| stateMismatch                                             | conflict                     | 412       |
| serverFail / serverUnavailable                            | server                       | 500 / 503 |
| invalidArguments / unknownMethod / invalidResultReference | unknown                      | 400       |
| requestTooLarge / tooManyCalls / tooManyObjects / limit   | unknown                      | 413       |

Request-level problem JSON retains its URN (including `notJSON`), body, HTTP
status and Retry-After. Method errors carry equivalent status values so pending
change policies work without JMAP-specific branches. Network failures have no
numeric status and retain `Failed to fetch` wording for uncounted queue retries.
Retry-After accepts delay seconds or an HTTP date, clamped to one hour like DAV.

## Protocol detection

`detectProtocol(options)` returns `{ protocol: 'jmap', session, serverUrl }` or
`{ protocol: 'caldav' }`. Its session is the validated raw session document;
`serverUrl` is the final upstream session URL, suitable for `JmapClient`.

1. Trim the typed URL, add HTTPS for a bare host, and retain explicit HTTP.
2. Probe an explicitly typed session resource directly; otherwise probe the
   origin's `/.well-known/jmap`, then the typed path's `/.well-known/jmap` if
   there is a path. Provider rewriting/subdomain guessing is left to DAV.
3. Follow redirects and parse JSON. Require core, global calendars, and calendar
   capability on the primary calendar account. Servers offering both protocols
   therefore select JMAP.
4. HTML, login pages, 404/405, non-JSON, invalid sessions, missing capabilities,
   CORS/network errors and eight-second probe timeouts fall through to DAV.
5. A JSON-content-type 401 with `WWW-Authenticate` throws an auth error and stops
   discovery, preventing misleading DAV errors for a real JMAP auth failure.

There are at most two application-level probes (one for an explicit session).
Fetch/proxy follows the server's redirect chain; redirect hops are additional
wire requests. Invalid custom header/proxy configuration is an actionable error
and is validated before probing.

## Push and verification

`openEventSource(types, onStateChange)` returns a synchronous cleanup function.
It always uses authenticated fetch streaming because browser `EventSource`
cannot attach Authorization. The incremental SSE parser handles comments, BOM,
multiline data, CR/LF boundaries, event IDs and server retry intervals. Only
validated `StateChange` objects reach the callback; malformed events are ignored.
The connection requests `ping=30` and `closeafter=no`. Server ping intervals
adjust a silence watchdog; missing traffic for twice the interval plus ten
seconds aborts and reconnects. Reconnects back off exponentially to 60 seconds,
honor Retry-After and resume with Last-Event-ID. Auth/permission failures stop
reconnecting. Cleanup aborts the stream and clears reconnect/watchdog timers.

Run `pnpm vitest --run src/features/jmap/client`, `pnpm typecheck`, and
`pnpm exec eslint src/features/jmap/client`. The live spec is skipped unless
`CALINO_TEST_JMAP_URL`, `CALINO_TEST_JMAP_USER` and `CALINO_TEST_JMAP_PASS` are set
for that run. It performs detection, session loading, echo and Calendar/get;
it never writes calendar data or embeds credentials. UI wiring and its required
Playwright coverage belong to the subsequent integration work.

## Advertised loopback URLs

Stalwart advertises `https://localhost/...` for `apiUrl`, `uploadUrl`,
`downloadUrl` and `eventSourceUrl` whenever its hostname is `localhost`, even on
a plain-HTTP dev server reached at another address. `resolveTemplate` rebases an
endpoint whose host is loopback (`localhost`, `127.x`, `::1`) onto the origin the
session was actually fetched from. Non-loopback advertisements are never
rewritten, so a server cannot steer credentials to a third-party host.
The live test (`CALINO_TEST_JMAP_*`) covers this against the dev Stalwart.
