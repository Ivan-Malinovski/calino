import { describe, expect, it } from 'vitest'
import { JMAP_CORE } from '../../types'
import { JmapClient } from '../JmapClient'
import { detectProtocol } from '../detect'

const serverUrl = globalThis.process.env.CALINO_TEST_JMAP_URL
const username = globalThis.process.env.CALINO_TEST_JMAP_USER
const password = globalThis.process.env.CALINO_TEST_JMAP_PASS

describe.skipIf(!serverUrl || !username || !password)('live JMAP transport (read-only)', () => {
  it('detects JMAP, follows session redirects and batches echo/calendar reads', async () => {
    const opts = { serverUrl: serverUrl!, username: username!, password: password! }
    expect((await detectProtocol(opts)).protocol).toBe('jmap')
    const client = new JmapClient(opts)
    await client.connect()
    expect(client.capabilities[JMAP_CORE]).toBeDefined()
    const result = await client.call([
      ['Core/echo', { message: 'Calino transport test' }, 'echo'],
      ['Calendar/get', { accountId: client.accountId, ids: null }, 'calendars'],
    ])
    expect(result.methodResponses[0]).toEqual([
      'Core/echo',
      { message: 'Calino transport test' },
      'echo',
    ])
    expect(result.methodResponses[1][0]).toBe('Calendar/get')
  }, 30000)
})
