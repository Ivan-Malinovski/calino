import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runDiagnostics, formatReportForClipboard, type CheckId } from '../diagnostics'

const BASE = 'https://dav.example.com'

// The first <response> is the collection itself; its resourcetype is what marks
// the URL as a calendar the write test may PUT into (a principal or home set
// would only 403).
const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/event-1.ics</d:href><d:propstat><d:prop><d:getetag>"abc"</d:getetag></d:prop></d:propstat></d:response>
</d:multistatus>`

interface StubbedResponse {
  status?: number
  headers?: Record<string, string>
  body?: string
  /** Throw instead of responding — the shape of a browser CORS rejection. */
  throws?: Error
}

/**
 * Route each request by method, so a test only has to describe the parts it
 * cares about. Unmatched requests get a bare 207 so a test that means to
 * exercise one check doesn't accidentally fail three others.
 */
function stubFetch(routes: Record<string, StubbedResponse>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const route = routes[method] ?? { status: 207, body: MULTISTATUS }
    if (route.throws) throw route.throws
    return new Response(route.body ?? MULTISTATUS, {
      status: route.status ?? 207,
      headers: route.headers ?? {},
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function statusOf(checks: { id: CheckId; status: string }[], id: CheckId): string | undefined {
  return checks.find((c) => c.id === id)?.status
}

const OPTS = { serverUrl: BASE, username: 'alice', password: 'hunter2' }

describe('runDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports a healthy server as ok', async () => {
    stubFetch({
      OPTIONS: {
        status: 200,
        headers: {
          DAV: '1, 2, 3, calendar-access',
          Allow: 'GET, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR',
        },
      },
      GET: { status: 200, headers: { ETag: '"abc"' }, body: 'BEGIN:VCALENDAR' },
    })

    const report = await runDiagnostics(OPTS)

    expect(report.summary).toBe('ok')
    expect(statusOf(report.checks, 'reachable')).toBe('pass')
    expect(statusOf(report.checks, 'preflight')).toBe('pass')
    expect(statusOf(report.checks, 'auth')).toBe('pass')
    expect(statusOf(report.checks, 'dav-class')).toBe('pass')
    expect(statusOf(report.checks, 'expose-etag')).toBe('pass')
  })

  it('blames the preflight when the server is up but PROPFIND throws', async () => {
    // GET succeeds (mode:'no-cors' would too), PROPFIND does not — exactly what
    // a browser does when the preflight is rejected.
    stubFetch({
      PROPFIND: { throws: new TypeError('Failed to fetch') },
    })

    const report = await runDiagnostics(OPTS)

    expect(statusOf(report.checks, 'reachable')).toBe('pass')

    const preflight = report.checks.find((c) => c.id === 'preflight')!
    expect(preflight.status).toBe('fail')
    expect(preflight.evidence).toBe('inferred')
    expect(preflight.fix).toContain('Access-Control-Allow-Origin')

    // Nothing downstream can be judged once no DAV request completes.
    expect(statusOf(report.checks, 'auth')).toBe('skipped')
    expect(statusOf(report.checks, 'report-query')).toBe('skipped')
    expect(report.summary).toBe('broken')
  })

  it('skips every check when the server never answers', async () => {
    stubFetch({ GET: { throws: new TypeError('Failed to fetch') } })

    const report = await runDiagnostics(OPTS)

    expect(statusOf(report.checks, 'reachable')).toBe('fail')
    expect(statusOf(report.checks, 'preflight')).toBe('skipped')
    expect(report.summary).toBe('broken')
  })

  it('reports rejected credentials as an auth failure, not a transport one', async () => {
    stubFetch({ PROPFIND: { status: 401, body: '' } })

    const report = await runDiagnostics(OPTS)

    expect(statusOf(report.checks, 'preflight')).toBe('pass')
    expect(statusOf(report.checks, 'auth')).toBe('fail')
  })

  it('warns rather than fails when ETag is not readable', async () => {
    // No ETag header on the resource GET — the browser-hides-it case.
    stubFetch({ GET: { status: 200, body: 'BEGIN:VCALENDAR' } })

    const report = await runDiagnostics(OPTS)

    const etag = report.checks.find((c) => c.id === 'expose-etag')!
    expect(etag.status).toBe('warn')
    expect(etag.fix).toContain('Access-Control-Expose-Headers')
    // A warning must never read as a broken server.
    expect(report.summary).toBe('degraded')
  })

  it('infers DAV support from a 207 when the DAV header is hidden', async () => {
    stubFetch({ OPTIONS: { status: 200 }, GET: { status: 200, headers: { ETag: '"a"' } } })

    const report = await runDiagnostics(OPTS)

    const davClass = report.checks.find((c) => c.id === 'dav-class')!
    expect(davClass.status).toBe('pass')
    expect(davClass.evidence).toBe('inferred')
  })

  it('marks CORS checks not-applicable behind a proxy', async () => {
    stubFetch({ GET: { status: 200, headers: { ETag: '"a"' } } })

    const report = await runDiagnostics({ ...OPTS, proxyUrl: 'https://proxy.calino.io' })

    expect(report.viaProxy).toBe(true)
    expect(statusOf(report.checks, 'dav-class')).toBe('skipped')
    expect(statusOf(report.checks, 'allow-methods')).toBe('skipped')
    expect(statusOf(report.checks, 'expose-etag')).toBe('skipped')
  })

  it('treats 403 on REPORT as a warning — the URL is probably a principal', async () => {
    stubFetch({ REPORT: { status: 403, body: '' }, GET: { status: 200, headers: { ETag: '"a"' } } })

    const report = await runDiagnostics(OPTS)

    expect(statusOf(report.checks, 'report-query')).toBe('warn')
    expect(report.summary).toBe('degraded')
  })

  it('queries addressbook-query for carddav accounts', async () => {
    const fetchMock = stubFetch({ GET: { status: 200, headers: { ETag: '"a"' } } })

    await runDiagnostics({ ...OPTS, kind: 'carddav' })

    const reportCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'REPORT'
    )
    expect(String((reportCall?.[1] as RequestInit).body)).toContain('addressbook-query')
  })

  it('deletes the temporary resource after a write test', async () => {
    const fetchMock = stubFetch({
      PUT: { status: 201, headers: { ETag: '"new"' }, body: '' },
      DELETE: { status: 204, body: '' },
      GET: { status: 200, headers: { ETag: '"a"' } },
    })

    const report = await runDiagnostics({ ...OPTS, includeWriteTest: true })

    expect(statusOf(report.checks, 'write-roundtrip')).toBe('pass')
    const deletes = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
    )
    expect(deletes).toHaveLength(1)
  })

  it('still deletes the temporary resource when the ETag is missing', async () => {
    const fetchMock = stubFetch({
      PUT: { status: 201, body: '' },
      DELETE: { status: 204, body: '' },
      GET: { status: 200, headers: { ETag: '"a"' } },
    })

    const report = await runDiagnostics({ ...OPTS, includeWriteTest: true })

    expect(statusOf(report.checks, 'write-roundtrip')).toBe('warn')
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
      )
    ).toBe(true)
  })

  it('skips the write test on a principal rather than reporting a 403 as failure', async () => {
    // A home set: a collection, but not a calendar. Radicale's /ivan/ looks
    // exactly like this, and PUTting into it always 403s.
    const principal = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/ivan/</d:href><d:propstat><d:prop><d:resourcetype><d:principal/><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/ivan/work/</d:href></d:response>
</d:multistatus>`
    const fetchMock = stubFetch({
      PROPFIND: { status: 207, body: principal },
      GET: { status: 200, headers: { ETag: '"a"' } },
    })

    const report = await runDiagnostics({ ...OPTS, includeWriteTest: true })

    expect(statusOf(report.checks, 'write-roundtrip')).toBe('skipped')
    // Nothing may be written to a URL that cannot accept it.
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    ).toBe(false)
    expect(report.summary).not.toBe('broken')
  })

  it('retries the base URL when discovery lands past the DAV endpoint', async () => {
    // Radicale redirects /.well-known/caldav → / → /.web, and /.web refuses DAV
    // methods with 403. Judging the server on that URL blames the credentials.
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const href = String(url)
      if (method === 'PROPFIND' && href.includes('/.web')) {
        return new Response('', { status: 403 })
      }
      if (method === 'GET' && href.includes('/.well-known/')) {
        return Object.defineProperty(new Response('', { status: 200 }), 'url', {
          value: `${BASE}/.web`,
        })
      }
      return new Response(MULTISTATUS, { status: 207 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const report = await runDiagnostics(OPTS)

    expect(statusOf(report.checks, 'auth')).toBe('pass')
    expect(statusOf(report.checks, 'propfind-depth1')).toBe('pass')
    expect(report.summary).not.toBe('broken')
  })

  it('streams checks through onProgress in order', async () => {
    stubFetch({ GET: { status: 200, headers: { ETag: '"a"' } } })
    const seen: CheckId[] = []

    const report = await runDiagnostics({ ...OPTS, onProgress: (c) => seen.push(c.id) })

    expect(seen[0]).toBe('reachable')
    expect(seen).toEqual(report.checks.map((c) => c.id))
  })
})

describe('formatReportForClipboard', () => {
  it('keeps the hostname but never the credentials', async () => {
    stubFetch({ GET: { status: 200, headers: { ETag: '"a"' } } })

    const report = await runDiagnostics({
      ...OPTS,
      password: 'sup3rs3cret',
      proxyUrl: 'https://proxy.calino.io',
    })
    const text = formatReportForClipboard(report)

    expect(text).toContain('dav.example.com')
    expect(text).not.toContain('sup3rs3cret')
    expect(text).not.toContain('alice')
    expect(text).not.toContain('proxy.calino.io')
  })
})

describe('page policy', () => {
  afterEach(() => {
    document.head.querySelectorAll('meta[http-equiv]').forEach((meta) => meta.remove())
  })

  it('names mixed content, without contacting the server, for an http server from https', async () => {
    // The browser blocks this before a request is made, so it is indistinguishable
    // from a dead server unless we say so.
    vi.stubGlobal('location', { protocol: 'https:', href: 'https://app.example.com/' })
    const fetchMock = stubFetch({ GET: { throws: new TypeError('Failed to fetch') } })

    const report = await runDiagnostics({ ...OPTS, serverUrl: 'http://dav.local:5232' })

    const policy = report.checks.find((c) => c.id === 'page-policy')!
    expect(policy.status).toBe('fail')
    expect(policy.detail).toMatch(/mixed content/i)
    expect(policy.fix).toMatch(/https/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(statusOf(report.checks, 'reachable')).toBe('skipped')
    expect(report.summary).toBe('broken')
    expect(report.blame).toBe('page')
  })

  it('names the Content Security Policy when this build only allows https', async () => {
    vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost:5173/' })
    const meta = document.createElement('meta')
    meta.httpEquiv = 'Content-Security-Policy'
    meta.content = "default-src 'self'; connect-src 'self' https:"
    document.head.append(meta)
    stubFetch({})

    const report = await runDiagnostics({ ...OPTS, serverUrl: 'http://192.168.1.50:8080' })

    const policy = report.checks.find((c) => c.id === 'page-policy')!
    expect(policy.status).toBe('fail')
    expect(policy.detail).toMatch(/Content Security Policy/)
    expect(policy.fix).toMatch(/CALINO_SELF_HOSTED/)
    expect(report.blame).toBe('page')
  })

  it('does not block http when the policy allows it', async () => {
    vi.stubGlobal('location', { protocol: 'http:', href: 'http://localhost:5173/' })
    const meta = document.createElement('meta')
    meta.httpEquiv = 'Content-Security-Policy'
    meta.content = "default-src 'self'; connect-src 'self' http: https:"
    document.head.append(meta)
    stubFetch({ GET: { throws: new TypeError('Failed to fetch') } })

    const report = await runDiagnostics({ ...OPTS, serverUrl: 'http://dav.local:5232' })

    expect(report.checks.find((c) => c.id === 'page-policy')).toBeUndefined()
    expect(report.checks.find((c) => c.id === 'reachable')!.fix).not.toMatch(/mixed content/i)
  })

  it('does not blame the server when only the credentials failed', async () => {
    stubFetch({ PROPFIND: { status: 401, body: '' } })

    const report = await runDiagnostics(OPTS)

    expect(report.blame).toBe('credentials')
  })
})

describe('JMAP diagnostics', () => {
  const JMAP_BASE = 'https://mail.example.com'
  const session = {
    capabilities: {
      'urn:ietf:params:jmap:core': {},
      'urn:ietf:params:jmap:calendars': {},
      'urn:ietf:params:jmap:contacts': {},
    },
    accounts: {
      a: {
        name: 'Alice',
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} },
      },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:calendars': 'a' },
    username: 'alice',
    apiUrl: `${JMAP_BASE}/jmap/`,
    uploadUrl: `${JMAP_BASE}/upload/{accountId}`,
    downloadUrl: `${JMAP_BASE}/download/{accountId}/{blobId}/{name}`,
    eventSourceUrl: `${JMAP_BASE}/events`,
    state: 's',
  }
  const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  interface Stub {
    session?: () => Response
    api?: (body: { methodCalls: [string, Record<string, unknown>, string][] }) => Response
  }

  function stubJmap(stub: Stub = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      if (target.endsWith('/.well-known/jmap')) return stub.session ? stub.session() : json(session)
      if (target === `${JMAP_BASE}/jmap/`) {
        const body = JSON.parse(String(init?.body))
        if (stub.api) return stub.api(body)
        const [name, args, id] = body.methodCalls[0]
        if (name === 'Calendar/get') {
          return json({
            methodResponses: [
              [name, { list: [{ id: 'c1', name: 'Home', myRights: { mayWrite: true } }] }, id],
            ],
          })
        }
        if (name === 'CalendarEvent/set' && args.create) {
          return json({ methodResponses: [[name, { created: { t: { id: 'e1' } } }, id]] })
        }
        return json({ methodResponses: [[name, { destroyed: ['e1'] }, id]] })
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const JMAP_OPTS = {
    serverUrl: JMAP_BASE,
    username: 'alice',
    password: 'pw',
    protocol: 'jmap',
  } as const

  it('reports a healthy JMAP server as ok, without any DAV requests', async () => {
    const fetchMock = stubJmap()

    const report = await runDiagnostics(JMAP_OPTS)

    expect(report.kind).toBe('jmap')
    expect(report.summary).toBe('ok')
    for (const id of [
      'jmap-session',
      'jmap-api',
      'jmap-calendars',
      'jmap-contacts',
      'jmap-push',
    ] as const) {
      expect(statusOf(report.checks, id)).toBe('pass')
    }
    expect(report.checks.find((c) => c.id === 'jmap-calendars')!.detail).toBe(
      '1 calendar, 1 writable.'
    )
    expect(report.checks.some((c) => c.id === 'dav-class')).toBe(false)
    const methods = fetchMock.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method)
    expect(methods).not.toContain('PROPFIND')
    expect(methods).not.toContain('OPTIONS')
  })

  it('blames the API endpoint when only the session answers cross-origin', async () => {
    // Stalwart answers CORS on /.well-known/jmap only, by default.
    const fetchMock = stubJmap()
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/.well-known/jmap')) return json(session)
      if (String(url) === `${JMAP_BASE}/jmap/`) throw new TypeError('Failed to fetch')
      return new Response('', { status: 200 })
    })

    const report = await runDiagnostics(JMAP_OPTS)

    expect(statusOf(report.checks, 'jmap-session')).toBe('pass')
    const api = report.checks.find((c) => c.id === 'jmap-api')!
    expect(api.status).toBe('fail')
    expect(api.detail).toMatch(/session loaded/)
    expect(api.fix).toMatch(/API URL/)
    expect(statusOf(report.checks, 'jmap-calendars')).toBe('skipped')
    expect(report.blame).toBe('server')
  })

  it('reports rejected credentials on the session request', async () => {
    stubJmap({ session: () => json({ type: 'unauthorized' }, 401) })

    const report = await runDiagnostics(JMAP_OPTS)

    expect(statusOf(report.checks, 'auth')).toBe('fail')
    expect(statusOf(report.checks, 'jmap-session')).toBe('skipped')
    expect(report.blame).toBe('credentials')
  })

  it('says so when the address is not a JMAP server', async () => {
    stubJmap({ session: () => new Response('<html></html>', { status: 200 }) })

    const report = await runDiagnostics(JMAP_OPTS)

    const found = report.checks.find((c) => c.id === 'jmap-session')!
    expect(found.status).toBe('fail')
    expect(found.fix).toMatch(/Use CalDAV/)
  })

  it('fails when the server is JMAP but offers no calendars', async () => {
    stubJmap({
      session: () =>
        json({
          ...session,
          capabilities: { 'urn:ietf:params:jmap:core': {} },
          primaryAccounts: {},
        }),
    })

    const report = await runDiagnostics(JMAP_OPTS)

    expect(report.checks.find((c) => c.id === 'jmap-session')!.detail).toMatch(
      /does not offer calendars/
    )
  })

  it('warns, rather than fails, when the server does not advertise push', async () => {
    stubJmap({ session: () => json({ ...session, eventSourceUrl: '' }) })

    const report = await runDiagnostics(JMAP_OPTS)

    expect(statusOf(report.checks, 'jmap-push')).toBe('warn')
    expect(report.summary).toBe('degraded')
  })

  it('creates and destroys a test event in a writable calendar', async () => {
    const fetchMock = stubJmap()

    const report = await runDiagnostics({ ...JMAP_OPTS, includeWriteTest: true })

    expect(statusOf(report.checks, 'write-roundtrip')).toBe('pass')
    const bodies = fetchMock.mock.calls
      .filter((call) => String(call[0]) === `${JMAP_BASE}/jmap/`)
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)).methodCalls[0])
    const create = bodies.find((call) => call[1].create)
    expect(create[1].create.t.calendarIds).toEqual({ c1: true })
    expect(bodies.some((call) => call[1].destroy?.[0] === 'e1')).toBe(true)
  })

  it('auto-detects JMAP before falling back to DAV', async () => {
    stubJmap()
    const jmap = await runDiagnostics({ ...JMAP_OPTS, protocol: 'auto' })
    expect(jmap.kind).toBe('jmap')

    stubFetch({
      OPTIONS: { status: 200, headers: { DAV: '1, calendar-access' } },
    })
    const dav = await runDiagnostics({ ...OPTS, protocol: 'auto' })
    expect(dav.kind).toBe('caldav')
    expect(dav.checks.some((c) => c.id === 'dav-class')).toBe(true)
  })
})
