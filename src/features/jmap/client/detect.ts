import { JmapError, assertJmapResponse } from './errors'
import {
  calendarAccountId,
  createJmapTransport,
  parseSession,
  sessionCandidates,
  type JmapClientOptions,
  type JmapSession,
} from './session'

export type ProtocolDetection =
  { protocol: 'jmap'; session: JmapSession; serverUrl: string } | { protocol: 'caldav' }

export async function detectProtocol(opts: JmapClientOptions): Promise<ProtocolDetection> {
  // Invalid header configuration is an actionable error, not a failed JMAP probe.
  const transport = createJmapTransport(opts)
  for (const url of sessionCandidates(opts.serverUrl)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await transport.rawRequest(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      const contentType = response.headers.get('Content-Type') ?? ''
      if (
        response.status === 401 &&
        /(?:application\/json|\+json)/i.test(contentType) &&
        response.headers.has('WWW-Authenticate')
      )
        await assertJmapResponse(response)
      if (!response.ok) continue
      const session = parseSession(await response.json())
      if (!calendarAccountId(session)) continue
      return { protocol: 'jmap', session, serverUrl: transport.responseUrl(response, url) }
    } catch (error) {
      if (error instanceof JmapError && error.code === 'auth') throw error
      // HTML, login redirects, missing capabilities, network/CORS and timeout mean no JMAP.
    } finally {
      clearTimeout(timer)
    }
  }
  return { protocol: 'caldav' }
}
