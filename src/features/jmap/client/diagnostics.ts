/**
 * The JMAP half of the connection diagnostics (`caldav/client/diagnostics.ts`
 * owns the run, the report and the evidence model; read its header first).
 *
 * The questions are the same ones the DAV checks answer, in JMAP's shape:
 *
 *  1. Can the browser reach and talk to the session resource (CORS)?
 *  2. Does the server accept the credentials?
 *  3. Is there a session that offers calendars?
 *  4. Does the *API endpoint* answer too? It is a different URL from the
 *     session, and servers differ on which one they put CORS headers on:
 *     Stalwart does it only for `/.well-known/jmap` unless told otherwise, so
 *     "the session loads" and "Calino can work" are not the same statement.
 *  5. Which calendars, address books and live-update support are on offer?
 */

import { createUuid } from '@/lib/uuid'
import type {
  CheckId,
  DiagnosticCheck,
  DiagnosticsOptions,
} from '@/features/caldav/client/diagnostics'
import { JmapError } from './errors'
import {
  calendarAccountId,
  isObject,
  parseSession,
  resolveTemplate,
  sessionCandidates,
  type JmapSession,
} from './session'
import { JMAP_CALENDARS, JMAP_CONTACTS, JMAP_CORE, type JsonObject } from '../types'

const CORS_SNIPPET = `Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 86400`

/** Applies to the session URL and the API URL alike. */
const CORS_FIX = `Add these response headers to the JMAP session URL *and* the API URL, and make sure both answer OPTIONS with 200/204:\n${CORS_SNIPPET}\nStalwart: turn on "Use permissive CORS" in the HTTP settings.`

export interface JmapChecksContext {
  options: DiagnosticsOptions
  authHeader: string
  viaProxy: boolean
  native: boolean
  timeoutMs: number
  request: (url: string, init: RequestInit) => Promise<Response>
  emit: (check: DiagnosticCheck) => DiagnosticCheck
  skipped: (id: CheckId, detail: string) => DiagnosticCheck
  labels: Record<CheckId, string>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function hasWriteRight(calendar: JsonObject): boolean {
  const rights = calendar.myRights
  return (
    isObject(rights) &&
    (rights.mayWrite === true || rights.mayWriteAll === true || rights.mayWriteOwn === true)
  )
}

/** Everything after `reachable`. Returns the URL the session was read from. */
export async function runJmapChecks(ctx: JmapChecksContext): Promise<string> {
  const { options, authHeader, viaProxy, native, timeoutMs, request, emit, skipped, labels } = ctx
  const candidates = sessionCandidates(options.serverUrl)
  const remaining: CheckId[] = [
    'auth',
    'jmap-session',
    'jmap-api',
    'jmap-calendars',
    'jmap-contacts',
    'jmap-push',
  ]
  const skipRest = (from: CheckId, why: string): void => {
    for (const id of remaining.slice(remaining.indexOf(from))) emit(skipped(id, why))
    if (options.includeWriteTest) emit(skipped('write-roundtrip', why))
  }

  // ── Session request: the first thing a browser sends, so the first CORS test ──
  let response: Response | null = null
  let failure: unknown = null
  let sessionUrl = candidates[0]!
  for (const url of candidates) {
    try {
      const attempt = await request(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          ...(viaProxy ? { 'X-Follow-Redirects': '1' } : {}),
        },
      })
      // A 200 that is not JSON is a web UI answering for a missing endpoint, so
      // keep looking, but remember it as the thing to report if nothing better turns up.
      const conclusive =
        (attempt.ok && /json/i.test(attempt.headers.get('Content-Type') ?? '')) ||
        attempt.status === 401 ||
        attempt.status === 403
      if (!response || conclusive) {
        response = attempt
        sessionUrl = url
        failure = null
      }
      if (conclusive) break
    } catch (error) {
      failure ??= error
    }
  }

  if (!response) {
    if (isAbort(failure)) {
      emit({
        id: 'preflight',
        label: labels.preflight,
        status: 'fail',
        evidence: 'observed',
        detail: `The server accepted the connection but did not answer within ${timeoutMs / 1000}s.`,
        fix: 'Check the server logs: this usually means the server is hanging, not a CORS problem.',
      })
    } else {
      emit({
        id: 'preflight',
        label: labels.preflight,
        status: 'fail',
        evidence: native ? 'observed' : 'inferred',
        detail: native
          ? `The request failed: ${errorMessage(failure)}`
          : `The server is up but the browser blocked the request (${errorMessage(failure)}). The server most likely answers without the CORS headers a browser needs, or rejects the OPTIONS preflight.`,
        fix: native ? undefined : CORS_FIX,
      })
    }
    skipRest('auth', 'Skipped — no request to the server completed.')
    return sessionUrl
  }

  emit({
    id: 'preflight',
    label: labels.preflight,
    status: 'pass',
    evidence: viaProxy ? 'inferred' : 'observed',
    detail: viaProxy
      ? 'Your proxy answered. Your server itself may still block direct browser access.'
      : 'The browser was allowed to make this request, so the CORS headers cover it.',
    raw: `GET ${sessionUrl} → ${response.status}`,
  })

  // ── Auth ────────────────────────────────────────────────────────────────────
  const authOk = response.status !== 401 && response.status !== 403
  emit({
    id: 'auth',
    label: labels.auth,
    status: authOk ? 'pass' : 'fail',
    evidence: 'observed',
    detail: authOk
      ? 'The server accepted these credentials.'
      : `The server rejected these credentials (HTTP ${response.status}).`,
    fix: authOk
      ? undefined
      : 'Check the username and password. Many providers require an app-specific password rather than your account password.',
    raw: `HTTP ${response.status}`,
  })
  if (!authOk) {
    skipRest('jmap-session', 'Skipped — the credentials were rejected.')
    return sessionUrl
  }

  // ── Session document ────────────────────────────────────────────────────────
  const notJmapFix =
    'Enter the server’s base address (Calino looks for /.well-known/jmap). If this server only speaks CalDAV, tick “Use CalDAV instead of auto-detect” under Connection settings.'
  let session: JmapSession
  let finalSessionUrl: string
  try {
    if (!response.ok) {
      throw new JmapError(`The server answered HTTP ${response.status} instead of a JMAP session.`)
    }
    session = parseSession(await response.json())
    finalSessionUrl = response.headers.get('X-Target-URL') || response.url || sessionUrl
  } catch (error) {
    emit({
      id: 'jmap-session',
      label: labels['jmap-session'],
      status: 'fail',
      evidence: 'observed',
      detail:
        error instanceof JmapError && error.message.startsWith('The server answered')
          ? `${error.message} This address does not look like a JMAP server.`
          : 'The server answered, but not with a JMAP session document. This address does not look like a JMAP server.',
      fix: notJmapFix,
      raw: `GET ${sessionUrl} → ${response.status}`,
    })
    skipRest('jmap-api', 'Skipped — no JMAP session was found.')
    return sessionUrl
  }

  const accountId = calendarAccountId(session)
  if (!accountId) {
    emit({
      id: 'jmap-session',
      label: labels['jmap-session'],
      status: 'fail',
      evidence: 'observed',
      detail: `This is a JMAP server (signed in as ${session.username}) but it does not offer calendars to this account.`,
      fix: 'Enable the calendar service for this account on the server. JMAP Calendars is still a draft, so some servers do not support it yet; in that case use CalDAV instead.',
      raw: `Capabilities: ${Object.keys(session.capabilities).join(', ')}`,
    })
    skipRest('jmap-api', 'Skipped — the server offers no calendars.')
    return sessionUrl
  }
  emit({
    id: 'jmap-session',
    label: labels['jmap-session'],
    status: 'pass',
    evidence: 'observed',
    detail: `Found a JMAP session for ${session.username}, with calendars.`,
    raw: `Session: ${finalSessionUrl}`,
  })

  // ── The API endpoint ────────────────────────────────────────────────────────
  let apiUrl: string
  try {
    apiUrl = resolveTemplate(session.apiUrl, finalSessionUrl)
  } catch (error) {
    emit({
      id: 'jmap-api',
      label: labels['jmap-api'],
      status: 'fail',
      evidence: 'observed',
      detail: `The server advertised an unusable API address (${session.apiUrl}): ${errorMessage(error)}`,
      fix: 'Set the server’s public hostname, so the session document advertises a reachable API URL.',
    })
    skipRest('jmap-calendars', 'Skipped — the API address is unusable.')
    return finalSessionUrl
  }

  const call = async (methodCalls: unknown[], using: string[]): Promise<Response> =>
    request(apiUrl, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ using, methodCalls }),
    })

  let calendars: JsonObject[] | null = null
  try {
    const api = await call(
      [['Calendar/get', { accountId, ids: null, properties: ['id', 'name', 'myRights'] }, '0']],
      [JMAP_CORE, JMAP_CALENDARS]
    )
    if (api.status === 401 || api.status === 403) {
      emit({
        id: 'jmap-api',
        label: labels['jmap-api'],
        status: 'fail',
        evidence: 'observed',
        detail: `The session loaded, but the API endpoint rejected the same credentials (HTTP ${api.status}).`,
        fix: 'Check that the API URL is not behind a different authentication layer than the session URL.',
        raw: `POST ${apiUrl} → ${api.status}`,
      })
      skipRest('jmap-calendars', 'Skipped — the API endpoint rejected the credentials.')
      return finalSessionUrl
    }
    const body: unknown = api.ok ? await api.json().catch(() => null) : null
    const first =
      isObject(body) && Array.isArray(body.methodResponses) ? body.methodResponses[0] : undefined
    if (!Array.isArray(first) || !isObject(first[1])) {
      emit({
        id: 'jmap-api',
        label: labels['jmap-api'],
        status: 'fail',
        evidence: 'observed',
        detail: api.ok
          ? 'The API endpoint answered, but not with a JMAP response.'
          : `The API endpoint answered HTTP ${api.status}.`,
        fix: 'Check that the API URL in the session document points at the JMAP API.',
        raw: `POST ${apiUrl} → ${api.status}`,
      })
      skipRest('jmap-calendars', 'Skipped — the API did not answer.')
      return finalSessionUrl
    }
    emit({
      id: 'jmap-api',
      label: labels['jmap-api'],
      status: 'pass',
      evidence: viaProxy ? 'inferred' : 'observed',
      detail: 'The browser could send a JMAP request to the API endpoint and read the answer.',
      raw: `POST ${apiUrl} → ${api.status}`,
    })
    if (first[0] === 'error') {
      emit({
        id: 'jmap-calendars',
        label: labels['jmap-calendars'],
        status: 'fail',
        evidence: 'observed',
        detail: `The server refused to list calendars: ${String(first[1].type ?? 'unknown error')}${first[1].description ? ` — ${String(first[1].description)}` : ''}.`,
        raw: JSON.stringify(first[1]),
      })
    } else {
      calendars = Array.isArray(first[1].list) ? first[1].list.filter(isObject) : []
      const writable = calendars.filter(hasWriteRight).length
      emit({
        id: 'jmap-calendars',
        label: labels['jmap-calendars'],
        status: calendars.length === 0 ? 'warn' : 'pass',
        evidence: 'observed',
        detail:
          calendars.length === 0
            ? 'The account has no calendars yet. Create one in your server, or add one from Calino after connecting.'
            : `${calendars.length} calendar${calendars.length === 1 ? '' : 's'}, ${writable} writable.`,
      })
    }
  } catch (error) {
    emit({
      id: 'jmap-api',
      label: labels['jmap-api'],
      status: 'fail',
      evidence: native ? 'observed' : 'inferred',
      detail: isAbort(error)
        ? `The API endpoint did not answer within ${timeoutMs / 1000}s.`
        : native
          ? `The API request failed: ${errorMessage(error)}`
          : `The session loaded, but the browser blocked the request to the API endpoint (${errorMessage(error)}). Servers often add CORS headers to the session URL only.`,
      fix: native || isAbort(error) ? undefined : `${CORS_FIX}\nAPI endpoint: ${apiUrl}`,
      raw: `POST ${apiUrl}`,
    })
    skipRest('jmap-calendars', 'Skipped — the API endpoint could not be reached.')
    return finalSessionUrl
  }

  // ── Optional capabilities ───────────────────────────────────────────────────
  const contacts = session.capabilities[JMAP_CONTACTS]
  emit(
    contacts
      ? {
          id: 'jmap-contacts',
          label: labels['jmap-contacts'],
          status: 'pass',
          evidence: 'observed',
          detail: 'The server offers contacts over JMAP.',
        }
      : skipped(
          'jmap-contacts',
          'This server does not offer contacts over JMAP. Calendars still work.'
        )
  )
  emit(
    session.eventSourceUrl
      ? {
          id: 'jmap-push',
          label: labels['jmap-push'],
          status: 'pass',
          evidence: 'observed',
          detail:
            'The server can push changes, so Calino can refresh as soon as something changes.',
        }
      : {
          id: 'jmap-push',
          label: labels['jmap-push'],
          status: 'warn',
          evidence: 'observed',
          detail:
            'The server does not advertise live updates. Calino will check for changes periodically instead.',
        }
  )

  // ── Write round-trip (opt-in) ───────────────────────────────────────────────
  if (options.includeWriteTest) {
    const target = calendars?.find(hasWriteRight)
    if (!target || typeof target.id !== 'string') {
      emit(
        skipped('write-roundtrip', 'Skipped — this account has no writable calendar to test with.')
      )
    } else {
      await runJmapWriteTest({ ctx, call, accountId, calendarId: target.id })
    }
  }
  return finalSessionUrl
}

/**
 * Create a throwaway event, then destroy it. Mirrors the DAV write test: it
 * proves the account can write and that the response is readable, on the
 * user's real server, which is why it is opt-in.
 */
async function runJmapWriteTest(args: {
  ctx: JmapChecksContext
  call: (methodCalls: unknown[], using: string[]) => Promise<Response>
  accountId: string
  calendarId: string
}): Promise<void> {
  const { ctx, call, accountId, calendarId } = args
  const { emit, labels, native } = ctx
  const using = [JMAP_CORE, JMAP_CALENDARS]
  let eventId: string | null = null
  const fail = (detail: string, raw?: string): void => {
    emit({
      id: 'write-roundtrip',
      label: labels['write-roundtrip'],
      status: 'fail',
      evidence: native ? 'observed' : 'inferred',
      detail,
      raw,
    })
  }
  try {
    const created = await call(
      [
        [
          'CalendarEvent/set',
          {
            accountId,
            create: {
              t: {
                '@type': 'Event',
                uid: `calino-diagnostics-${createUuid()}`,
                title: 'Calino diagnostics (safe to delete)',
                start: '1970-01-01T00:00:00',
                timeZone: 'UTC',
                duration: 'PT1H',
                calendarIds: { [calendarId]: true },
              },
            },
          },
          '0',
        ],
      ],
      using
    )
    const body: unknown = created.ok ? await created.json().catch(() => null) : null
    const result =
      isObject(body) && Array.isArray(body.methodResponses) ? body.methodResponses[0] : undefined
    const made = Array.isArray(result) && isObject(result[1]) ? result[1] : null
    const createdObject = made && isObject(made.created) ? made.created.t : undefined
    if (isObject(createdObject) && typeof createdObject.id === 'string') {
      eventId = createdObject.id
    } else {
      const reason =
        made && isObject(made.notCreated) && isObject(made.notCreated.t)
          ? `${String(made.notCreated.t.type ?? 'error')}${made.notCreated.t.description ? `: ${String(made.notCreated.t.description)}` : ''}`
          : `HTTP ${created.status}`
      fail(
        `Creating a test event failed (${reason}). The account may be read-only, or the server rejected the event.`,
        `CalendarEvent/set → ${reason}`
      )
      return
    }
    emit({
      id: 'write-roundtrip',
      label: labels['write-roundtrip'],
      status: 'pass',
      evidence: 'observed',
      detail: 'Created and removed a test event.',
      raw: `CalendarEvent/set → created ${eventId}`,
    })
  } catch (error) {
    fail(`The write test failed: ${errorMessage(error)}`)
  } finally {
    if (eventId) {
      try {
        await call([['CalendarEvent/set', { accountId, destroy: [eventId] }, '0']], using)
      } catch {
        emit({
          id: 'write-roundtrip',
          label: 'Test event cleanup',
          status: 'warn',
          evidence: 'observed',
          detail:
            'Could not remove the test event. Delete the event titled “Calino diagnostics” manually.',
          raw: eventId,
        })
      }
    }
  }
}
