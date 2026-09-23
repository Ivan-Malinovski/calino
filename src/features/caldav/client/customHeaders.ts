import { webFetch } from '@/lib/webFetch'

export type CustomHeaders = Record<string, string>

const RESERVED = new Set([
  'authorization',
  'host',
  'content-type',
  'content-length',
  'cookie',
  'depth',
  'destination',
  'if-match',
  'if-none-match',
  'origin',
  'referer',
  'prefer',
  'transfer-encoding',
  'connection',
  'accept-encoding',
  'x-follow-redirects',
])
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export function validateCustomHeaders(
  headers: CustomHeaders,
  proxyUrl?: string | null
): CustomHeaders {
  if (proxyUrl && Object.keys(headers).length) {
    throw new Error('Custom headers require a direct DAV connection; remove the proxy URL.')
  }
  const result: CustomHeaders = {}
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(headers)) {
    const key = name.trim()
    const lower = key.toLowerCase()
    if (
      !TOKEN.test(key) ||
      RESERVED.has(lower) ||
      lower.startsWith('sec-') ||
      lower.startsWith('proxy-')
    ) {
      throw new Error(`Invalid or reserved custom header name: ${key}`)
    }
    if (seen.has(lower)) throw new Error(`Duplicate custom header name: ${key}`)
    if (!value || /[\r\n\0]/.test(value)) throw new Error(`Invalid value for custom header: ${key}`)
    seen.add(lower)
    result[key] = value
  }
  return result
}

export function createDirectDavFetch(
  originUrl: string,
  customHeaders: CustomHeaders = {},
  transport: typeof fetch = webFetch
): typeof fetch {
  const headers = validateCustomHeaders(customHeaders)
  const origin = new URL(originUrl).origin
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    if (Object.keys(headers).length && new URL(url).origin !== origin) {
      throw new Error('DAV request changed origin. Enter the final DAV URL directly.')
    }
    if (!Object.keys(headers).length) return transport(input, init)
    const merged = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, name) => merged.set(name, value))
    for (const [name, value] of Object.entries(headers)) merged.set(name, value)
    try {
      return await transport(input, { ...init, headers: merged, redirect: 'error' })
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(
          'DAV request failed or redirected. Enter the final DAV URL directly and check CORS for custom headers.',
          { cause: error }
        )
      }
      throw error
    }
  }
}
