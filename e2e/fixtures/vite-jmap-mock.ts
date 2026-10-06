import type { Plugin, ViteDevServer } from 'vite'

const CORE = 'urn:ietf:params:jmap:core'
const CALENDARS = 'urn:ietf:params:jmap:calendars'
const accountId = 'calendar-account'

/** A small, stateless JMAP server. No backend substitutions: exercises the real transport. */
export function jmapMockResponse(url: string, method: string, body = '') {
  const parsed = new URL(url)
  const base = `${parsed.origin}/mock-jmap`
  const respond = (data: unknown, status = 200) => ({
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (method === 'GET') {
    return respond({
      capabilities: {
        [CORE]: { maxCallsInRequest: 16, maxObjectsInGet: 256, maxObjectsInSet: 256 },
        [CALENDARS]: {},
      },
      accounts: {
        [accountId]: {
          name: 'JMAP fixture',
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: { [CALENDARS]: {} },
        },
      },
      primaryAccounts: { [CALENDARS]: accountId },
      username: 'fixture-user',
      apiUrl: `${base}/api`,
      uploadUrl: `${base}/upload/{accountId}`,
      downloadUrl: `${base}/download/{accountId}/{blobId}/{name}?type={type}`,
      eventSourceUrl: `${base}/events?types={types}&closeafter={closeafter}&ping={ping}`,
      state: 'session-1',
    })
  }
  if (method !== 'POST') return respond({}, 405)
  const request = JSON.parse(body) as { methodCalls: [string, Record<string, unknown>, string][] }
  const methodResponses = request.methodCalls.map(([name, args, callId]) => {
    if (args.accountId !== accountId) return ['error', { type: 'accountNotFound' }, callId]
    if (name === 'Calendar/get')
      return [
        name,
        {
          accountId,
          state: 'calendars-1',
          notFound: [],
          list: [
            {
              id: 'personal',
              name: 'JMAP Personal',
              color: '#336699',
              sortOrder: 0,
              isVisible: true,
              isDefault: true,
              isSubscribed: true,
              myRights: {
                mayReadItems: true,
                mayAddItems: true,
                mayModifyItems: true,
                mayRemoveItems: true,
                mayRename: true,
                mayDelete: true,
                mayAdmin: true,
              },
            },
          ],
        },
        callId,
      ]
    if (name === 'CalendarEvent/query')
      return [
        name,
        {
          accountId,
          queryState: 'events-1',
          canCalculateChanges: false,
          position: 0,
          ids: [],
          total: 0,
        },
        callId,
      ]
    if (name === 'CalendarEvent/get')
      return [name, { accountId, state: 'events-1', list: [], notFound: [] }, callId]
    if (name === 'CalendarEvent/changes')
      return [
        name,
        {
          accountId,
          oldState: args.sinceState,
          newState: 'events-1',
          hasMoreChanges: false,
          created: [],
          updated: [],
          destroyed: [],
        },
        callId,
      ]
    return ['error', { type: 'unknownMethod' }, callId]
  })
  return respond({ sessionState: 'session-1', methodResponses })
}

export function registerJmapMock(server: ViteDevServer): void {
  server.middlewares.use('/mock-jmap', (req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
    })
    req.on('end', () => {
      const reply = jmapMockResponse(
        `http://${req.headers.host}/mock-jmap${req.url}`,
        req.method ?? 'GET',
        body
      )
      res.writeHead(reply.status, reply.headers)
      res.end(reply.body)
    })
  })
}

export function jmapMockPlugin(): Plugin {
  return {
    name: 'calino-jmap-mock',
    configureServer: registerJmapMock,
  }
}
