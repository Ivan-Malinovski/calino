import { describe, expect, it } from 'vitest'
import { runDiagnostics } from '@/features/caldav/client/diagnostics'

const serverUrl = globalThis.process.env.CALINO_TEST_JMAP_URL
const username = globalThis.process.env.CALINO_TEST_JMAP_USER
const password = globalThis.process.env.CALINO_TEST_JMAP_PASS

describe.skipIf(!serverUrl || !username || !password)('live JMAP diagnostics', () => {
  it('passes every check, including the write round-trip, and finds JMAP automatically', async () => {
    const report = await runDiagnostics({
      serverUrl: serverUrl!,
      username: username!,
      password: password!,
      protocol: 'auto',
      includeWriteTest: true,
    })
    const failing = report.checks.filter((c) => c.status === 'fail')
    expect(failing, JSON.stringify(failing, null, 1)).toEqual([])
    expect(report.kind).toBe('jmap')
    expect(report.checks.find((c) => c.id === 'write-roundtrip')?.status).toBe('pass')
  }, 60000)

  it('reports rejected credentials as the cause', async () => {
    const report = await runDiagnostics({
      serverUrl: serverUrl!,
      username: username!,
      password: `${password}-wrong`,
      protocol: 'jmap',
    })
    expect(report.blame).toBe('credentials')
  }, 60000)
})
