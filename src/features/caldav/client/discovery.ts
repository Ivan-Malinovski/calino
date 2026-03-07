import { createDAVClient } from 'tsdav'
import type { ServerInfo } from '../types'

const COMMON_PATHS = [
  '/dav.php',
  '/caldav.php',
  '/caldav',
  '/dav/calendars',
  '/dav/caldav',
  '/calendar/dav',
  '/principals/users',
]

export async function discoverServerUrl(baseUrl: string, proxyUrl?: string): Promise<string> {
  const normalizedUrl = normalizeUrl(baseUrl)

  for (const path of COMMON_PATHS) {
    const tryUrl = new URL(path, normalizedUrl).href
    try {
      let fetchUrl = tryUrl
      if (proxyUrl) {
        const encodedTarget = encodeURIComponent(tryUrl)
        const proxyBase = proxyUrl.replace(/\/$/, '')
        fetchUrl = `${proxyBase}/${encodedTarget}`
      }
      const response = await fetch(fetchUrl, {
        method: 'OPTIONS',
      })
      if (response.ok || response.status === 401) {
        return tryUrl.replace(/\/$/, '')
      }
    } catch {
      continue
    }
  }

  return normalizedUrl.replace(/\/$/, '')
}

export async function getServerInfo(
  serverUrl: string,
  credentials: { username: string; password: string }
): Promise<ServerInfo> {
  try {
    await createDAVClient({
      serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    })

    const productId = 'Calino Client'
    const capabilities: string[] = []

    return {
      url: serverUrl,
      productId,
      capabilities,
    }
  } catch (error) {
    throw new Error(
      `Failed to connect to server: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

export async function testConnection(
  serverUrl: string,
  credentials: { username: string; password: string },
  proxyUrl?: string | null
): Promise<boolean> {
  try {
    const fetchFn = proxyUrl ? createProxyFetch(proxyUrl) : undefined

    const client = await createDAVClient({
      serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
      fetch: fetchFn,
    })

    await client.fetchCalendars()
    return true
  } catch {
    return false
  }
}

function createProxyFetch(proxyUrl: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string
    if (typeof input === 'string') {
      url = input
    } else if (input instanceof Request) {
      url = input.url
    } else {
      url = input.toString()
    }
    const encodedTarget = encodeURIComponent(url)
    const proxyBase = proxyUrl.replace(/\/$/, '')
    const proxiedUrl = `${proxyBase}/${encodedTarget}`
    return fetch(proxiedUrl, init)
  }
}

function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`
  }
  return url
}
