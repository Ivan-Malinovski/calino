/**
 * Server diagnostics for CalDAV/CardDAV accounts.
 *
 * `probeConnection` answers "did it work?"; this answers "which part of your
 * server is misconfigured?". The failure that dominates support traffic isn't a
 * wrong password — it's a server that never sent the CORS headers a browser
 * needs, and the user has no way to see which one is missing.
 *
 * ## Why some checks say "inferred"
 *
 * A browser will not let JavaScript read `Access-Control-Allow-*` off a
 * response: the CORS layer consumes those headers and enforces them itself.
 * So on the web we cannot print the server's actual configuration; we can only
 * observe which requests survive and work backwards. Two paths do better:
 *
 *  - **native** (Capacitor/headless), where `webFetch` runs through OkHttp with
 *    no CORS layer at all and hands us the full header map;
 *  - a **proxy**, which does read those headers — but then replaces them with
 *    its own before we see the response, so the CORS checks there describe the
 *    proxy, not the server. Those checks are reported as `skipped` rather than
 *    passing on evidence that isn't about the target.
 *
 * Every check therefore carries an `evidence` field so the UI never implies we
 * read something off the wire when we only deduced it.
 */

import { Capacitor } from '@capacitor/core'
import { webFetch } from '@/lib/webFetch'
import { isHeadless } from '@/lib/headlessBridge'
import {
  discoverServerUrl,
  isDavStatus,
  proxyFetch,
  suggestAuthHint,
  suggestCalDAVUrl,
} from './discovery'
import { CORS_HEADER_SNIPPET } from './errorMessages'

const CHECK_TIMEOUT_MS = 15_000

export type CheckId =
  | 'reachable'
  | 'preflight'
  | 'auth'
  | 'dav-class'
  | 'allow-methods'
  | 'propfind-depth1'
  | 'report-query'
  | 'expose-etag'
  | 'write-roundtrip'

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skipped' | 'unknown'

/** Whether a check's verdict came off the wire or was deduced from behaviour. */
export type CheckEvidence = 'observed' | 'inferred'

export interface DiagnosticCheck {
  id: CheckId
  label: string
  status: CheckStatus
  evidence: CheckEvidence
  /** One-line, user-facing explanation of the verdict. */
  detail: string
  /** What to change on the server, when we know. */
  fix?: string
  /** Status code or header value, for the copyable report. */
  raw?: string
}

export interface DiagnosticsReport {
  /** The URL that actually answered, or the one we gave up on. */
  target: string
  viaProxy: boolean
  platform: 'web' | 'native'
  kind: DavKind
  checks: DiagnosticCheck[]
  /** `broken` = something failed, `degraded` = only warnings, `ok` = clean. */
  summary: 'ok' | 'degraded' | 'broken'
}

export type DavKind = 'caldav' | 'carddav'

export interface DiagnosticsOptions {
  serverUrl: string
  username: string
  password: string
  proxyUrl?: string | null
  /** The URL the user typed, before `expandProviderUrl` rewrote it. */
  originalUrl?: string
  kind?: DavKind
  /** Run the create/delete round-trip. Writes a temporary event to the server. */
  includeWriteTest?: boolean
  /** Called as each check resolves, so the UI can stream results. */
  onProgress?: (check: DiagnosticCheck) => void
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const LABELS: Record<CheckId, string> = {
  reachable: 'Server reachable',
  preflight: 'Cross-origin requests allowed',
  auth: 'Credentials accepted',
  'dav-class': 'Speaks DAV',
  'allow-methods': 'DAV methods allowed',
  'propfind-depth1': 'Collection listing (PROPFIND Depth: 1)',
  'report-query': 'Queries (REPORT)',
  'expose-etag': 'ETag readable by the browser',
  'write-roundtrip': 'Write round-trip',
}

const PROXY_NOT_APPLICABLE =
  'Not applicable — traffic goes through your proxy, which supplies its own CORS headers. This check would describe the proxy, not your server.'

/** Namespace-aware lookup, so `d:href` and `D:href` both resolve. */
function davText(scope: Document | Element, localName: string): string | null {
  const el = scope.getElementsByTagNameNS('DAV:', localName)[0]
  return el?.textContent ?? null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** `isDavStatus`, lifted to the response we may or may not have got. */
function isDavResponse(response: Response | null): boolean {
  return response !== null && isDavStatus(response.status)
}

// ─── The run ──────────────────────────────────────────────────────────────────

export async function runDiagnostics(options: DiagnosticsOptions): Promise<DiagnosticsReport> {
  const {
    serverUrl,
    username,
    password,
    proxyUrl,
    originalUrl,
    kind = 'caldav',
    includeWriteTest = false,
    onProgress,
  } = options

  const viaProxy = Boolean(proxyUrl)
  const native = Capacitor.isNativePlatform() || isHeadless()
  const platform: 'web' | 'native' = native ? 'native' : 'web'
  const hintUrl = originalUrl || serverUrl

  // On native and behind a proxy there is no CORS layer between us and the
  // response, so header reads are real observations rather than deductions.
  const canReadHeaders = native

  const checks: DiagnosticCheck[] = []
  const emit = (check: DiagnosticCheck): DiagnosticCheck => {
    checks.push(check)
    onProgress?.(check)
    return check
  }

  const request = async (url: string, init: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    try {
      const withSignal = { ...init, signal: controller.signal }
      return proxyUrl
        ? await proxyFetch(proxyUrl, url, withSignal)
        : await webFetch(url, withSignal)
    } finally {
      clearTimeout(timer)
    }
  }

  const authHeader = `Basic ${btoa(`${username}:${password}`)}`
  const davHeaders = (depth: '0' | '1'): Record<string, string> => ({
    Authorization: authHeader,
    'Content-Type': 'application/xml; charset=utf-8',
    Depth: depth,
  })

  let base: string
  try {
    base = await discoverServerUrl(serverUrl, proxyUrl ?? undefined)
  } catch {
    base = serverUrl.replace(/\/$/, '')
  }

  // ── 1. Reachable ───────────────────────────────────────────────────────────
  // `mode: 'no-cors'` is the one request a browser will make without applying
  // CORS: we get back an opaque response we cannot read, but the *absence of a
  // throw* proves the host resolved and answered. That's what separates "your
  // server is down" from "your server is up and refusing us", which every
  // later check depends on. Not available (or needed) through the proxy or on
  // native, where an ordinary request already tells us.
  let reachable = false
  try {
    if (viaProxy || native) {
      await request(base, { method: 'GET', headers: { Authorization: authHeader } })
    } else {
      await webFetch(base, { method: 'GET', mode: 'no-cors' })
    }
    reachable = true
    emit({
      id: 'reachable',
      label: LABELS.reachable,
      status: 'pass',
      evidence: 'observed',
      detail: `${base} responded.`,
      raw: base,
    })
  } catch (error) {
    emit({
      id: 'reachable',
      label: LABELS.reachable,
      status: 'fail',
      evidence: 'observed',
      detail: isAbort(error)
        ? `${base} did not respond within ${CHECK_TIMEOUT_MS / 1000}s.`
        : `Could not connect to ${base}: ${errorMessage(error)}`,
      fix:
        suggestCalDAVUrl(hintUrl) ??
        'Check the server URL, that the server is running, and that its TLS certificate is valid.',
      raw: base,
    })
  }

  if (!reachable) {
    for (const id of [
      'preflight',
      'auth',
      'dav-class',
      'allow-methods',
      'propfind-depth1',
      'report-query',
      'expose-etag',
    ] as const) {
      emit(skipped(id, 'Skipped — the server never answered.'))
    }
    if (includeWriteTest) emit(skipped('write-roundtrip', 'Skipped — the server never answered.'))
    return finish()
  }

  // ── 2. OPTIONS: DAV compliance classes and allowed methods ─────────────────
  // Fired before the authenticated PROPFIND because its `DAV` and `Allow`
  // headers are what the next two checks read. It may legitimately 401 on
  // servers that require auth for OPTIONS, which is not a failure here.
  let optionsResponse: Response | null = null
  try {
    optionsResponse = await request(base, {
      method: 'OPTIONS',
      headers: { Authorization: authHeader },
    })
  } catch {
    // Swallowed: the preflight check below reports the same wall with better
    // wording, and OPTIONS is only a source of headers for us.
  }

  // ── 3. Preflight + auth: an authenticated PROPFIND Depth: 0 ────────────────
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`

  let propfind: Response | null = null
  let propfindError: unknown = null
  try {
    propfind = await request(base, {
      method: 'PROPFIND',
      headers: davHeaders('0'),
      body: propfindBody,
    })
  } catch (error) {
    propfindError = error
  }

  // Discovery follows the whole redirect chain, which on some servers runs past
  // the DAV endpoint and lands on a web UI — Radicale sends
  // /.well-known/caldav → / → /.web, and /.web refuses DAV methods with 403.
  // `probeConnection` already retries the base URL for exactly this reason; do
  // the same here, or every check below reports on the UI and the 403 gets
  // misread as "your credentials were rejected".
  const normalizedBase = serverUrl.replace(/\/$/, '')
  if (base !== normalizedBase && !isDavResponse(propfind)) {
    try {
      const retry = await request(normalizedBase, {
        method: 'PROPFIND',
        headers: davHeaders('0'),
        body: propfindBody,
      })
      if (isDavResponse(retry)) {
        base = normalizedBase
        propfind = retry
        propfindError = null
        // The OPTIONS headers we collected describe the UI, not the endpoint.
        optionsResponse = await request(base, {
          method: 'OPTIONS',
          headers: { Authorization: authHeader },
        }).catch(() => null)
      }
    } catch {
      // Keep the original result: the discovered URL is still our best guess.
    }
  }

  if (propfind) {
    emit({
      id: 'preflight',
      label: LABELS.preflight,
      status: 'pass',
      evidence: viaProxy ? 'inferred' : 'observed',
      detail: viaProxy
        ? 'Your proxy accepted a PROPFIND. Your server itself may still block direct browser access.'
        : 'The browser was allowed to send a PROPFIND, so the CORS headers cover this request.',
      raw: `PROPFIND → ${propfind.status}`,
    })
  } else if (isAbort(propfindError)) {
    emit({
      id: 'preflight',
      label: LABELS.preflight,
      status: 'fail',
      evidence: 'observed',
      detail: `The server accepted the connection but did not answer a PROPFIND within ${CHECK_TIMEOUT_MS / 1000}s.`,
      fix: 'Check the server logs — this usually means the DAV backend is hanging, not a CORS problem.',
    })
  } else {
    // Reachable, yet the request never completed. In a browser that is the
    // signature of a rejected preflight: the network error is deliberately
    // opaque, so this is inferred, not read.
    emit({
      id: 'preflight',
      label: LABELS.preflight,
      status: 'fail',
      evidence: native ? 'observed' : 'inferred',
      detail: native
        ? `The PROPFIND request failed: ${errorMessage(propfindError)}`
        : `The server is up but the browser blocked the request (${errorMessage(propfindError)}). That means the OPTIONS preflight was rejected or answered without the required CORS headers.`,
      fix: native
        ? undefined
        : `Add these response headers on your DAV endpoint, and make sure it answers OPTIONS with 200/204:\n${CORS_HEADER_SNIPPET}`,
    })
  }

  if (!propfind) {
    for (const id of [
      'auth',
      'dav-class',
      'allow-methods',
      'propfind-depth1',
      'report-query',
      'expose-etag',
    ] as const) {
      emit(skipped(id, 'Skipped — no DAV request completed.'))
    }
    if (includeWriteTest) emit(skipped('write-roundtrip', 'Skipped — no DAV request completed.'))
    return finish()
  }

  // ── 4. Auth ────────────────────────────────────────────────────────────────
  const authOk = propfind.status !== 401 && propfind.status !== 403
  emit({
    id: 'auth',
    label: LABELS.auth,
    status: authOk ? 'pass' : 'fail',
    evidence: 'observed',
    detail: authOk
      ? 'The server accepted these credentials.'
      : `The server rejected these credentials (HTTP ${propfind.status}).`,
    fix: authOk
      ? undefined
      : (suggestAuthHint(hintUrl) ??
        'Check the username and password. Many providers require an app-specific password rather than your account password.'),
    raw: `HTTP ${propfind.status}`,
  })

  // ── 5. DAV compliance classes ──────────────────────────────────────────────
  const davHeader = optionsResponse?.headers.get('dav') ?? propfind.headers.get('dav')
  const wantedClass = kind === 'caldav' ? 'calendar-access' : 'addressbook'
  if (viaProxy && !davHeader) {
    emit(skipped('dav-class', PROXY_NOT_APPLICABLE))
  } else if (davHeader) {
    const has = davHeader.toLowerCase().includes(wantedClass)
    emit({
      id: 'dav-class',
      label: LABELS['dav-class'],
      status: has ? 'pass' : 'fail',
      evidence: 'observed',
      detail: has
        ? `The server advertises ${wantedClass}.`
        : `The server answers DAV but does not advertise ${wantedClass}, so this URL is probably not a ${kind === 'caldav' ? 'calendar' : 'address book'} endpoint.`,
      fix: has ? undefined : (suggestCalDAVUrl(hintUrl) ?? undefined),
      raw: `DAV: ${davHeader}`,
    })
  } else {
    // No readable DAV header. A 207 still proves DAV is spoken; on the web the
    // header is simply hidden unless the server exposes it.
    const spokeDav = propfind.status === 207
    emit({
      id: 'dav-class',
      label: LABELS['dav-class'],
      status: spokeDav ? 'pass' : 'unknown',
      evidence: 'inferred',
      detail: spokeDav
        ? 'The server returned 207 Multi-Status, so it speaks DAV. The exact compliance classes are hidden from the browser.'
        : `The server answered HTTP ${propfind.status} instead of 207, and the DAV header is not readable here.`,
      fix: canReadHeaders
        ? undefined
        : 'Add `DAV` to Access-Control-Expose-Headers to let Calino read the compliance classes directly.',
    })
  }

  // ── 6. Allowed methods ─────────────────────────────────────────────────────
  const allowHeader = optionsResponse?.headers.get('allow')
  const requiredMethods =
    kind === 'caldav'
      ? ['PROPFIND', 'REPORT', 'PROPPATCH', 'PUT', 'DELETE', 'MKCALENDAR']
      : ['PROPFIND', 'REPORT', 'PROPPATCH', 'PUT', 'DELETE', 'MKCOL']

  if (viaProxy && !allowHeader) {
    emit(skipped('allow-methods', PROXY_NOT_APPLICABLE))
  } else if (allowHeader) {
    const advertised = allowHeader.toUpperCase()
    const missing = requiredMethods.filter((m) => !advertised.includes(m))
    emit({
      id: 'allow-methods',
      label: LABELS['allow-methods'],
      status: missing.length === 0 ? 'pass' : 'warn',
      evidence: 'observed',
      detail:
        missing.length === 0
          ? 'The server advertises every method Calino uses.'
          : `The server does not advertise: ${missing.join(', ')}. Some servers under-report here, so this may still work.`,
      fix:
        missing.length === 0
          ? undefined
          : `Make sure these methods are routed to your DAV backend and listed in Access-Control-Allow-Methods:\n${missing.join(', ')}`,
      raw: `Allow: ${allowHeader}`,
    })
  } else {
    emit({
      id: 'allow-methods',
      label: LABELS['allow-methods'],
      status: 'unknown',
      evidence: 'inferred',
      detail:
        'The Allow header is not readable here. The checks below exercise the methods directly instead.',
      fix: 'Add `Allow` to Access-Control-Expose-Headers to see the advertised method list.',
    })
  }

  // ── 7. PROPFIND Depth: 1 ───────────────────────────────────────────────────
  // Depth: 1 is a separate check from Depth: 0 because both need the `Depth`
  // request header through Access-Control-Allow-Headers, but only Depth: 1
  // actually enumerates a collection — the operation every sync starts with.
  let firstResourceHref: string | null = null
  // Whether `base` is itself a calendar/addressbook, as opposed to a principal
  // or home set that merely contains them. Only the former accepts a PUT.
  let baseIsWritableCollection = false
  try {
    const listing = await request(base, {
      method: 'PROPFIND',
      headers: davHeaders('1'),
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>`,
    })
    const ok = listing.status === 207
    if (ok) {
      const doc = new DOMParser().parseFromString(await listing.clone().text(), 'application/xml')
      const responses = Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))
      // The first entry describes the collection itself, so its resourcetype
      // tells us whether a write test can target this URL at all.
      if (responses[0]) {
        const ns =
          kind === 'carddav' ? 'urn:ietf:params:xml:ns:carddav' : 'urn:ietf:params:xml:ns:caldav'
        const localName = kind === 'carddav' ? 'addressbook' : 'calendar'
        baseIsWritableCollection = responses[0].getElementsByTagNameNS(ns, localName).length > 0
      }
      // Skip the first entry: PROPFIND Depth: 1 always reports the collection
      // itself before its children.
      for (const responseEl of responses.slice(1)) {
        const href = davText(responseEl, 'href')
        if (href) {
          firstResourceHref = new URL(href, base).href
          break
        }
      }
      emit({
        id: 'propfind-depth1',
        label: LABELS['propfind-depth1'],
        status: 'pass',
        evidence: 'observed',
        detail: `Listed ${Math.max(responses.length - 1, 0)} child resource(s).`,
        raw: `HTTP 207, ${responses.length} responses`,
      })
    } else {
      emit({
        id: 'propfind-depth1',
        label: LABELS['propfind-depth1'],
        status: 'fail',
        evidence: 'observed',
        detail: `Listing the collection returned HTTP ${listing.status} instead of 207 Multi-Status.`,
        raw: `HTTP ${listing.status}`,
      })
    }
  } catch (error) {
    emit({
      id: 'propfind-depth1',
      label: LABELS['propfind-depth1'],
      status: 'fail',
      evidence: native ? 'observed' : 'inferred',
      detail: `Depth: 1 listing failed (${errorMessage(error)}) even though Depth: 0 succeeded.`,
      fix: native
        ? undefined
        : 'Include `Depth` in Access-Control-Allow-Headers — a server that allows the request but not the header fails exactly like this.',
    })
  }

  // ── 8. REPORT ──────────────────────────────────────────────────────────────
  // The verb sync uses to fetch a time window (or the whole address book).
  // Proxies and reverse proxies frequently forget it while passing PROPFIND.
  const reportBody =
    kind === 'caldav'
      ? `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter>
</c:calendar-query>`
      : `<?xml version="1.0" encoding="UTF-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/></d:prop>
</card:addressbook-query>`

  try {
    const report = await request(base, {
      method: 'REPORT',
      headers: davHeaders('1'),
      body: reportBody,
    })
    // 403/409 here means "this URL isn't a calendar collection" — true when the
    // user pointed at their principal rather than a calendar, which is normal
    // and not a transport problem.
    const ok = report.status === 207
    const notACollection = report.status === 403 || report.status === 409
    emit({
      id: 'report-query',
      label: LABELS['report-query'],
      status: ok ? 'pass' : notACollection ? 'warn' : 'fail',
      evidence: 'observed',
      detail: ok
        ? 'The server answered a REPORT query.'
        : notACollection
          ? `The server answered HTTP ${report.status}, which usually means this URL is a principal or home set rather than a single ${kind === 'caldav' ? 'calendar' : 'address book'}. That is fine — Calino runs REPORT against the individual collections it discovers.`
          : `REPORT returned HTTP ${report.status} instead of 207.`,
      raw: `HTTP ${report.status}`,
    })
  } catch (error) {
    emit({
      id: 'report-query',
      label: LABELS['report-query'],
      status: 'fail',
      evidence: native ? 'observed' : 'inferred',
      detail: `The REPORT request failed: ${errorMessage(error)}`,
      fix: native
        ? undefined
        : 'Add REPORT to Access-Control-Allow-Methods, and make sure your reverse proxy forwards the verb.',
    })
  }

  // ── 9. ETag exposure ───────────────────────────────────────────────────────
  // Not cosmetic: when ETag isn't readable, every create and update pays a
  // follow-up PROPFIND to recover the etag (see CalDAVClient.fetchEtag). Sync
  // still works, so this is only ever a warning.
  if (viaProxy) {
    emit({
      id: 'expose-etag',
      label: LABELS['expose-etag'],
      status: 'skipped',
      evidence: 'inferred',
      detail:
        'Not applicable — your proxy exposes ETag on its own responses, so this tells you nothing about the server.',
    })
  } else if (firstResourceHref) {
    try {
      const resource = await request(firstResourceHref, {
        method: 'GET',
        headers: { Authorization: authHeader },
      })
      const etag = resource.headers.get('etag')
      emit({
        id: 'expose-etag',
        label: LABELS['expose-etag'],
        status: etag ? 'pass' : 'warn',
        evidence: 'observed',
        detail: etag
          ? 'ETag is readable, so writes skip the extra round-trip.'
          : 'ETag is not readable. Sync still works, but every create and update costs an extra PROPFIND to recover the etag.',
        fix: etag ? undefined : 'Add `ETag` to Access-Control-Expose-Headers.',
        raw: etag ? `ETag: ${etag}` : 'ETag: (not readable)',
      })
    } catch (error) {
      emit({
        id: 'expose-etag',
        label: LABELS['expose-etag'],
        status: 'unknown',
        evidence: 'inferred',
        detail: `Could not read a resource to check ETag exposure: ${errorMessage(error)}`,
      })
    }
  } else {
    emit({
      id: 'expose-etag',
      label: LABELS['expose-etag'],
      status: 'unknown',
      evidence: 'inferred',
      detail:
        'No existing resource was found to read an ETag from. Run the write test for a definitive answer.',
    })
  }

  // ── 10. Write round-trip (opt-in) ──────────────────────────────────────────
  if (includeWriteTest) {
    if (baseIsWritableCollection) {
      await runWriteTest({ base, kind, authHeader, request, emit, native })
    } else {
      // PUTting into a principal or home set is a guaranteed 403 that says
      // nothing about the server's health — the same distinction report-query
      // already draws. Don't dress it up as a failure.
      emit(
        skipped(
          'write-roundtrip',
          `Skipped — this URL is a principal or home set, not a single ${
            kind === 'carddav' ? 'address book' : 'calendar'
          }. Run diagnostics against one of its collections to test writes.`
        )
      )
    }
  }

  return finish()

  function skipped(id: CheckId, detail: string): DiagnosticCheck {
    return { id, label: LABELS[id], status: 'skipped', evidence: 'inferred', detail }
  }

  function finish(): DiagnosticsReport {
    const broken = checks.some((c) => c.status === 'fail')
    const degraded = checks.some((c) => c.status === 'warn')
    return {
      target: base,
      viaProxy,
      platform,
      kind,
      checks,
      summary: broken ? 'broken' : degraded ? 'degraded' : 'ok',
    }
  }
}

// ─── Write round-trip ─────────────────────────────────────────────────────────

/**
 * PUT a throwaway resource, read the ETag off the response, then DELETE it.
 *
 * This is the only way to be certain about ETag exposure on the write path,
 * and it also proves PUT/DELETE survive the round trip. It writes to the user's
 * real server, which is why it's opt-in and behind its own button.
 *
 * The resource is dated far in the past and named so it's obvious if cleanup
 * ever fails; the DELETE runs in a `finally` so it happens even if the checks
 * throw.
 */
async function runWriteTest(ctx: {
  base: string
  kind: DavKind
  authHeader: string
  request: (url: string, init: RequestInit) => Promise<Response>
  emit: (check: DiagnosticCheck) => DiagnosticCheck
  native: boolean
}): Promise<void> {
  const { base, kind, authHeader, request, emit, native } = ctx
  const uid = `calino-diagnostics-${crypto.randomUUID()}`
  const extension = kind === 'caldav' ? '.ics' : '.vcf'
  const targetUrl = `${base.replace(/\/$/, '')}/${uid}${extension}`
  const contentType =
    kind === 'caldav' ? 'text/calendar; charset=utf-8' : 'text/vcard; charset=utf-8'

  const body =
    kind === 'caldav'
      ? [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Calino//Diagnostics//EN',
          'BEGIN:VEVENT',
          `UID:${uid}`,
          'DTSTAMP:19700101T000000Z',
          'DTSTART:19700101T000000Z',
          'DTEND:19700101T010000Z',
          'SUMMARY:Calino diagnostics (safe to delete)',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')
      : [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `UID:${uid}`,
          'FN:Calino diagnostics (safe to delete)',
          'N:diagnostics;Calino;;;',
          'END:VCARD',
        ].join('\r\n')

  let created = false
  try {
    const put = await request(targetUrl, {
      method: 'PUT',
      headers: {
        Authorization: authHeader,
        'Content-Type': contentType,
        'If-None-Match': '*',
      },
      body,
    })

    created = put.status === 201 || put.status === 204 || put.ok
    if (!created) {
      emit({
        id: 'write-roundtrip',
        label: LABELS['write-roundtrip'],
        status: 'fail',
        evidence: 'observed',
        detail: `Creating a test resource returned HTTP ${put.status}. The account may be read-only, or this URL may not be a writable collection.`,
        raw: `PUT → HTTP ${put.status}`,
      })
      return
    }

    const etag = put.headers.get('etag')
    emit({
      id: 'write-roundtrip',
      label: LABELS['write-roundtrip'],
      status: etag ? 'pass' : 'warn',
      evidence: 'observed',
      detail: etag
        ? 'Created and removed a test resource, and the ETag came back on the write itself.'
        : 'Created and removed a test resource, but the server did not return a readable ETag on the write, so every save costs an extra request.',
      fix: etag ? undefined : 'Add `ETag` to Access-Control-Expose-Headers.',
      raw: `PUT → HTTP ${put.status}${etag ? `, ETag: ${etag}` : ', ETag: (not readable)'}`,
    })
  } catch (error) {
    emit({
      id: 'write-roundtrip',
      label: LABELS['write-roundtrip'],
      status: 'fail',
      evidence: native ? 'observed' : 'inferred',
      detail: `The write test failed: ${errorMessage(error)}`,
      fix: native
        ? undefined
        : 'Check that PUT and DELETE are in Access-Control-Allow-Methods and that `If-None-Match` is in Access-Control-Allow-Headers.',
    })
  } finally {
    if (created) {
      try {
        await request(targetUrl, { method: 'DELETE', headers: { Authorization: authHeader } })
      } catch {
        emit({
          id: 'write-roundtrip',
          label: 'Test resource cleanup',
          status: 'warn',
          evidence: 'observed',
          detail: `Could not remove the test resource. Delete "Calino diagnostics" manually: ${targetUrl}`,
          raw: targetUrl,
        })
      }
    }
  }
}

// ─── Report formatting ────────────────────────────────────────────────────────

const STATUS_MARK: Record<CheckStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  warn: 'WARN',
  skipped: 'SKIP',
  unknown: '????',
}

/**
 * Render a report as plain text for pasting into a bug report.
 *
 * Deliberately drops the username, password and proxy URL: this text is meant
 * to be pasted into a public issue tracker. The hostname is kept because
 * without it the report says almost nothing.
 */
export function formatReportForClipboard(report: DiagnosticsReport): string {
  let host = report.target
  try {
    host = new URL(report.target).host
  } catch {
    /* not a URL — fall back to the raw string */
  }

  const lines = [
    `Calino diagnostics — ${report.summary.toUpperCase()}`,
    `Server: ${host} (${report.kind})`,
    `Platform: ${report.platform}${report.viaProxy ? ', via proxy' : ''}`,
    '',
  ]

  for (const check of report.checks) {
    lines.push(`[${STATUS_MARK[check.status]}] ${check.label} (${check.evidence})`)
    lines.push(`       ${check.detail}`)
    if (check.raw) lines.push(`       ${check.raw}`)
    if (check.fix) {
      for (const fixLine of check.fix.split('\n')) lines.push(`       fix: ${fixLine}`)
    }
  }

  return lines.join('\n')
}
