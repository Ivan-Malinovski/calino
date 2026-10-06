import { Capacitor } from '@capacitor/core'
import { isHeadless } from '@/lib/headlessBridge'

/**
 * Reasons the browser refuses to contact a server before the server is
 * involved at all. Both surface as a bare "Failed to fetch", identical to a
 * server that is switched off or missing CORS headers, so they are worth
 * naming: no server-side change fixes either one.
 *
 *  - `mixed-content`: Calino is served over https and the server is plain http.
 *  - `csp`: this build's Content Security Policy only allows https servers.
 *    Self-hosted builds add `http:` (see `contentSecurityPolicy.ts`).
 */
export type PagePolicyBlock = 'mixed-content' | 'csp'

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i

function connectSources(policy: string): string[] {
  const directives = policy.split(';').map((part) => part.trim().split(/\s+/))
  const found =
    directives.find(([name]) => name?.toLowerCase() === 'connect-src') ??
    directives.find(([name]) => name?.toLowerCase() === 'default-src')
  return found ? found.slice(1) : []
}

export function pagePolicyBlock(target: string): PagePolicyBlock | null {
  if (typeof document === 'undefined' || typeof location === 'undefined') return null
  // The native app and the headless sync entry do not go through the page's policy.
  if (Capacitor.isNativePlatform() || isHeadless()) return null
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null
  // Browsers exempt loopback addresses from mixed-content blocking; the CSP still applies.
  if (location.protocol === 'https:' && !LOOPBACK.test(url.hostname)) return 'mixed-content'
  const policy = document
    .querySelector('meta[http-equiv="Content-Security-Policy" i]')
    ?.getAttribute('content')
  if (!policy) return null
  const sources = connectSources(policy)
  if (!sources.length) return null
  const allowed = sources.some(
    (source) => source === 'http:' || source === '*' || source === url.origin
  )
  return allowed || url.origin === location.origin ? null : 'csp'
}
