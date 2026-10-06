import { buildProxyUrl } from '@/features/caldav/client/CalDAVClient'
import i18n from '@/lib/i18n'

const NETWORK_TIMEOUT_MS = 15_000

/**
 * webcal:// and webcals:// are aliases for https:// (some feed publishers
 * still hand out webcal links, but the scheme just tells the OS "open in
 * your calendar app" — the transport is plain HTTP(S)).
 */
export function normalizeWebcalUrl(url: string): string {
  const trimmed = url.trim()
  if (/^webcals:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcals:\/\//i, 'https://')
  }
  if (/^webcal:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcal:\/\//i, 'https://')
  }
  return trimmed
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch and return the raw iCalendar text for a webcal subscription. Throws
 * a user-facing error message on any failure — callers surface it directly.
 */
export async function fetchWebcalIcs(url: string, proxyUrl?: string | null): Promise<string> {
  const normalized = normalizeWebcalUrl(url)

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(i18n.t('calendar:ui.webcal.invalidUrl'))
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(i18n.t('calendar:ui.webcal.unsupportedScheme'))
  }

  const fetchUrl = proxyUrl ? buildProxyUrl(proxyUrl, normalized) : normalized

  let response: Response
  try {
    response = await fetchWithTimeout(fetchUrl)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : i18n.t('calendar:ui.webcal.unknownError')
    throw new Error(i18n.t('calendar:ui.webcal.unreachable', { message }), { cause: error })
  }

  if (!response.ok) {
    throw new Error(i18n.t('calendar:ui.webcal.badStatus', { status: response.status }))
  }

  const text = await response.text()
  if (!text.trim()) {
    throw new Error(i18n.t('calendar:ui.webcal.emptyResponse'))
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error(i18n.t('calendar:ui.webcal.notIcs'))
  }

  return text
}
