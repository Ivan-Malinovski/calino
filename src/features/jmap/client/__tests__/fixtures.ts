import { JMAP_CALENDARS, JMAP_CORE } from '../../types'
import type { JmapClientOptions, JmapSession } from '../session'

export const options: JmapClientOptions = {
  serverUrl: 'https://calendar.test',
  username: '用户',
  password: 'päss🔑',
}

export function session(overrides: Partial<JmapSession> = {}): JmapSession {
  return {
    capabilities: {
      [JMAP_CORE]: { maxCallsInRequest: 4, maxObjectsInGet: 2, maxObjectsInSet: 2 },
      [JMAP_CALENDARS]: {},
    },
    accounts: {
      a: {
        name: 'Personal',
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { [JMAP_CALENDARS]: {} },
      },
    },
    primaryAccounts: { [JMAP_CALENDARS]: 'a' },
    username: options.username,
    apiUrl: '/jmap/api',
    uploadUrl: '/upload/{accountId}',
    downloadUrl: '/download/{accountId}/{blobId}/{name}?type={type}',
    eventSourceUrl: '/events?types={types}&closeafter={closeafter}&ping={ping}',
    state: 's1',
    ...overrides,
  }
}

export function json(value: unknown, init: ResponseInit = {}, url?: string): Response {
  const response = new Response(JSON.stringify(value), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (url) Object.defineProperty(response, 'url', { value: url })
  return response
}
