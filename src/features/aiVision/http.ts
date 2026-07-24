import { CapacitorHttp } from '@capacitor/core'

export interface HttpResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

/**
 * Thin fetch-like shim over CapacitorHttp so provider adapters (and their
 * tests) don't need to know about Capacitor. Native-only: bypasses WebView
 * CORS, which matters because providers like OpenAI reject browser-origin
 * requests entirely.
 */
export async function httpRequest(options: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  data?: unknown
}): Promise<HttpResponse> {
  const response = await CapacitorHttp.request({
    url: options.url,
    method: options.method ?? 'GET',
    headers: options.headers,
    data: options.data,
    connectTimeout: 20000,
    readTimeout: 60000,
  })

  const status = response.status
  const ok = status >= 200 && status < 300

  return {
    ok,
    status,
    json: async () => {
      if (typeof response.data === 'string') {
        return JSON.parse(response.data)
      }
      return response.data
    },
    text: async () => {
      if (typeof response.data === 'string') return response.data
      return JSON.stringify(response.data)
    },
  }
}
