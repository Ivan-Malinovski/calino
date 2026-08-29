import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  encryptPassword,
  decryptPassword,
  isEncryptedPassword,
  encryptWithMasterPassword,
  decryptWithMasterPassword,
  isMasterEncryptedData,
} from '../crypto'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App-level encryption (fixed key)', () => {
  it('encrypts and decrypts a password', async () => {
    const original = 'my-caldav-password-123'
    const encrypted = await encryptPassword(original)

    expect(encrypted.iv).toBeTruthy()
    expect(encrypted.data).toBeTruthy()
    expect(encrypted.data).not.toBe(original)

    const decrypted = await decryptPassword(encrypted)
    expect(decrypted).toBe(original)
  })

  it('produces different ciphertext for same input (random IV)', async () => {
    const password = 'same-password'
    const a = await encryptPassword(password)
    const b = await encryptPassword(password)

    expect(a.data).not.toBe(b.data)
    expect(a.iv).not.toBe(b.iv)
  })

  it('isEncryptedPassword identifies encrypted data', async () => {
    const encrypted = await encryptPassword('test')
    expect(isEncryptedPassword(encrypted)).toBe(true)
    expect(isEncryptedPassword({ iv: 'x', data: 'y' })).toBe(true)
    expect(isEncryptedPassword('string')).toBe(false)
    expect(isEncryptedPassword(null)).toBe(false)
    expect(isEncryptedPassword({ iv: 'x' })).toBe(false)
  })
})

describe('Master-password encryption (self-hosted config)', () => {
  const masterPassword = 'my-master-password-2024'
  const caldavPassword = 'caldav-secret-password'

  it('encrypts and decrypts with master password', async () => {
    const encrypted = await encryptWithMasterPassword(caldavPassword, masterPassword)

    expect(encrypted.ciphertext).toBeTruthy()
    expect(encrypted.iv).toBeTruthy()
    expect(encrypted.salt).toBeTruthy()
    expect(encrypted.ciphertext).not.toBe(caldavPassword)

    const decrypted = await decryptWithMasterPassword(encrypted, masterPassword)
    expect(decrypted).toBe(caldavPassword)
  })

  it('produces different ciphertext for same input (random salt + IV)', async () => {
    const a = await encryptWithMasterPassword(caldavPassword, masterPassword)
    const b = await encryptWithMasterPassword(caldavPassword, masterPassword)

    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })

  it('fails to decrypt with wrong master password', async () => {
    const encrypted = await encryptWithMasterPassword(caldavPassword, masterPassword)

    await expect(decryptWithMasterPassword(encrypted, 'wrong-password')).rejects.toThrow()
  })

  it('fails to decrypt with corrupted ciphertext', async () => {
    const encrypted = await encryptWithMasterPassword(caldavPassword, masterPassword)

    await expect(
      decryptWithMasterPassword(
        { ...encrypted, ciphertext: 'AAAA' + encrypted.ciphertext },
        masterPassword
      )
    ).rejects.toThrow()
  })

  it('isMasterEncryptedData identifies correct shape', async () => {
    const encrypted = await encryptWithMasterPassword(caldavPassword, masterPassword)
    expect(isMasterEncryptedData(encrypted)).toBe(true)
    expect(isMasterEncryptedData({ ciphertext: 'x', iv: 'y', salt: 'z' })).toBe(true)
    expect(isMasterEncryptedData('string')).toBe(false)
    expect(isMasterEncryptedData(null)).toBe(false)
    expect(isMasterEncryptedData({ ciphertext: 'x' })).toBe(false)
  })

  it('handles empty password', async () => {
    const encrypted = await encryptWithMasterPassword('', masterPassword)
    const decrypted = await decryptWithMasterPassword(encrypted, masterPassword)
    expect(decrypted).toBe('')
  })

  it('handles unicode password', async () => {
    const unicodePassword = 'pässwörd-日本語-🔐'
    const encrypted = await encryptWithMasterPassword(unicodePassword, masterPassword)
    const decrypted = await decryptWithMasterPassword(encrypted, masterPassword)
    expect(decrypted).toBe(unicodePassword)
  })
})

describe('Web Crypto compatibility fallback', () => {
  it(
    'round-trips app credentials when crypto.subtle is unavailable',
    async () => {
      const nativeCrypto = globalThis.crypto
      vi.stubGlobal('crypto', {
        getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
      } as Crypto)

      const encrypted = await encryptPassword('fallback-password')
      expect(await decryptPassword(encrypted)).toBe('fallback-password')

      vi.stubGlobal('crypto', nativeCrypto)
      expect(await decryptPassword(encrypted)).toBe('fallback-password')
    },
    30_000
  )

  it(
    'round-trips master-password credentials when crypto.subtle is unavailable',
    async () => {
      const nativeCrypto = globalThis.crypto
      vi.stubGlobal('crypto', {
        getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
      } as Crypto)

      const encrypted = await encryptWithMasterPassword('fallback-password', 'master-password')
      expect(await decryptWithMasterPassword(encrypted, 'master-password')).toBe(
        'fallback-password'
      )
    },
    30_000
  )
})
