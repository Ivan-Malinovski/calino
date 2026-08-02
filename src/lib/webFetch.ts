import { Capacitor, registerPlugin } from '@capacitor/core'
import { getHeadlessBridge, isHeadless } from './headlessBridge'

/**
 * The fetch used for all CalDAV/CardDAV traffic.
 *
 * On the web this is just `fetch`, so DAV requests are subject to CORS and
 * servers need the headers documented in the README (or an account proxy URL).
 *
 * On native neither of Capacitor's built-in paths can carry a DAV request:
 *
 *  - The webview's `fetch` is CORS-bound (origin is `https://localhost`), and
 *    Capacitor additionally patches it — `CapacitorHttp.enabled` in
 *    capacitor.config.ts — to route cross-origin non-GET requests through
 *    `HttpURLConnection`, which throws `ProtocolException` for every verb
 *    outside the JDK's fixed list. That covers PROPFIND, REPORT, PROPPATCH,
 *    MKCALENDAR, MKCOL, COPY and MOVE, i.e. essentially all of CalDAV.
 *  - `CapacitorHttp.request()` has the same HttpURLConnection limitation.
 *
 * So on native this delegates to DavHttpPlugin (OkHttp, no verb whitelist, no
 * CORS) and adapts the result back into a `Response`. GET-only traffic
 * elsewhere in the app — webcal/ICS feeds, update checks — deliberately keeps
 * using the global `fetch` and its native CORS bypass.
 */
interface DavHttpResponse {
  status: number
  statusText: string
  url: string
  headers: Record<string, string>
  body: string
}

interface DavHttpPlugin {
  request(options: {
    url: string
    method: string
    headers: Record<string, string>
    body?: string
  }): Promise<DavHttpResponse>
}

const DavHttp = registerPlugin<DavHttpPlugin>('DavHttp')

/** Capacitor stashes the pre-patch fetch here when CapacitorHttp is enabled. */
function unpatchedFetch(): typeof fetch {
  return (globalThis as { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch ?? fetch
}

function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return Promise.race([
    pending,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true })
    }),
  ])
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError')
}

/** Same shape as DavHttpPlugin.request, whichever side performs it. */
type DavTransport = (options: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}) => Promise<DavHttpResponse>

/**
 * The background sync page has no Capacitor bridge, so DAV traffic goes over
 * the worker's `@JavascriptInterface` instead. Same OkHttp call underneath —
 * both land in `DavHttp.java`.
 */
const headlessTransport: DavTransport = async (options) => {
  const bridge = getHeadlessBridge()!
  const result = JSON.parse(bridge.davRequest(JSON.stringify(options))) as
    | { ok: true; response: DavHttpResponse }
    | { ok: false; error: string }
  if (!result.ok) throw new Error(result.error)
  return result.response
}

async function nativeFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  transport: DavTransport
): Promise<Response> {
  // Normalize through Request so a Request input, a URL, and init overrides all
  // collapse to one representation — same as the platform would.
  const request = new Request(input, init)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()

  const pending = transport({
    url: request.url,
    method: request.method,
    headers,
    ...(body ? { body } : {}),
  })

  // Callers wrap requests in AbortController timeouts. The native call can't be
  // cancelled mid-flight (it has its own timeout), but the caller must still see
  // an AbortError on schedule rather than waiting on the longer native timeout.
  //
  // Except in the background worker, where honouring the signal is worse than
  // useless. That transport is synchronous, so the timer physically cannot fire
  // while a request is in flight — but Android freezes background processes,
  // and a frozen-then-thawed worker fires every elapsed timer at once,
  // aborting requests that were about to succeed. Observed on MIUI: a pass
  // frozen for nine minutes failed every account with "timeout" the instant it
  // resumed. Nothing is waiting on this page, and OkHttp has its own timeout.
  const abortable = init?.signal && !isHeadless()
  const result = await (abortable ? raceAbort(pending, init.signal!) : pending)

  // 204/304 must not carry a body or the Response constructor throws.
  const hasBody = result.status !== 204 && result.status !== 304
  const response = new Response(hasBody ? result.body : null, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  })

  // `url` is read-only on Response, but discovery relies on it to detect a
  // .well-known redirect, so surface the post-redirect URL the plugin reports.
  Object.defineProperty(response, 'url', { value: result.url, configurable: true })
  return response
}

export function webFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Checked before the Capacitor test: the headless page is a plain WebView, so
  // `isNativePlatform()` is false there even though we very much are on device.
  if (isHeadless()) {
    return nativeFetch(input, init, headlessTransport)
  }
  if (Capacitor.isNativePlatform()) {
    return nativeFetch(input, init, (options) => DavHttp.request(options))
  }
  return unpatchedFetch()(input, init)
}
