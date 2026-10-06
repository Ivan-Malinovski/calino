import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import {
  getAllAccounts,
  saveAccount,
  updateAccount,
  updateAccountLastSync,
} from '../accountStorage'

const account = {
  name: 'Fixture',
  serverUrl: 'https://calendar.test/jmap/session',
  username: 'fixture-user',
  credentialId: 'fixture-credential',
}

const storage = createLocalStorageMock()
beforeEach(() => {
  storage.reset()
  storage.install()
})

describe('account protocol persistence', () => {
  it('preserves JMAP across create, edit, sync timestamps and serialization', () => {
    const saved = saveAccount({ ...account, protocol: 'jmap' })
    updateAccount(saved.id, { name: 'Renamed', proxyUrl: 'https://proxy.test' })
    updateAccountLastSync(saved.id)
    expect(getAllAccounts()[0]).toMatchObject({
      protocol: 'jmap',
      name: 'Renamed',
      proxyUrl: 'https://proxy.test',
    })
    expect(JSON.parse(localStorage.getItem('calino_caldav_accounts')!)[0].protocol).toBe('jmap')
  })

  it('keeps legacy accounts compatible with the CalDAV default', () => {
    const saved = saveAccount(account)
    updateAccount(saved.id, { name: 'Legacy rename' })
    expect(getAllAccounts()[0].protocol ?? 'caldav').toBe('caldav')
  })
})
