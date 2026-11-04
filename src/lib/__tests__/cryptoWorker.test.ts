import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Pbkdf2Request } from '../pbkdf2.worker'

// crypto.ts keeps module state (worker availability, the cached app key), so
// each test loads a fresh copy.
async function loadCrypto() {
  vi.resetModules()
  return import('../crypto')
}

const nativeCrypto = globalThis.crypto

function hideSubtleCrypto() {
  vi.stubGlobal('crypto', {
    getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
  } as Crypto)
}

interface FakeWorkerStats {
  created: URL[]
  alive: number
  maxAlive: number
}

/** A Worker stand-in that answers each request the way pbkdf2.worker.ts does. */
function stubWorker(
  answer: (request: Pbkdf2Request) => Promise<Uint8Array> | 'fail-to-start'
): FakeWorkerStats {
  const stats: FakeWorkerStats = { created: [], alive: 0, maxAlive: 0 }
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null
    onmessageerror: (() => void) | null = null
    private terminated = false
    constructor(url: URL) {
      stats.created.push(url)
      stats.alive++
      stats.maxAlive = Math.max(stats.maxAlive, stats.alive)
    }
    postMessage(request: Pbkdf2Request) {
      setTimeout(async () => {
        const result = answer(request)
        if (result === 'fail-to-start') {
          this.onerror?.({ message: 'blocked by CSP', preventDefault: () => {} })
          return
        }
        this.onmessage?.({ data: { key: await result } })
      })
    }
    terminate() {
      if (!this.terminated) stats.alive--
      this.terminated = true
    }
  }
  vi.stubGlobal('Worker', FakeWorker)
  return stats
}

const realDerivation = (request: Pbkdf2Request) =>
  pbkdf2Async(sha256, request.password, request.salt, { c: request.iterations, dkLen: request.dkLen })

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('JavaScript PBKDF2 in a worker', () => {
  it(
    'derives master-password keys in workers, compatible with native Web Crypto',
    async () => {
      hideSubtleCrypto()
      const stats = stubWorker(realDerivation)
      const crypto = await loadCrypto()

      const encrypted = await crypto.encryptWithMasterPassword('secret', 'master')
      expect(await crypto.decryptWithMasterPassword(encrypted, 'master')).toBe('secret')
      expect(stats.created).toHaveLength(2)
      expect(stats.created[0].pathname).toMatch(/pbkdf2\.worker\.ts$/)
      expect(stats.alive).toBe(0)

      // The worker's key is the same one SubtleCrypto derives.
      vi.stubGlobal('crypto', nativeCrypto)
      expect(await crypto.decryptWithMasterPassword(encrypted, 'master')).toBe('secret')
    },
    30_000
  )

  it(
    'falls back to the main thread once a worker cannot start',
    async () => {
      hideSubtleCrypto()
      const stats = stubWorker(() => 'fail-to-start')
      const crypto = await loadCrypto()

      const encrypted = await crypto.encryptWithMasterPassword('secret', 'master')
      expect(await crypto.decryptWithMasterPassword(encrypted, 'master')).toBe('secret')
      // Only the first attempt tries a worker; later derivations skip it.
      expect(stats.created).toHaveLength(1)
      expect(stats.alive).toBe(0)
    },
    30_000
  )

  it('runs at most four derivations at once and finishes them all', async () => {
    hideSubtleCrypto()
    const stats = stubWorker(
      () => new Promise((resolve) => setTimeout(() => resolve(new Uint8Array(32)), 20))
    )
    const crypto = await loadCrypto()

    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) => crypto.encryptWithMasterPassword(`field-${i}`, 'master'))
    )
    expect(results).toHaveLength(9)
    expect(stats.created).toHaveLength(9)
    expect(stats.maxAlive).toBeLessThanOrEqual(4)
    expect(stats.alive).toBe(0)
  })

  it(
    'derives the fixed app key once and reuses it',
    async () => {
      hideSubtleCrypto()
      const stats = stubWorker(realDerivation)
      const crypto = await loadCrypto()

      const first = await crypto.encryptPassword('one')
      const second = await crypto.encryptPassword('two')
      expect(await crypto.decryptPassword(first)).toBe('one')
      expect(await crypto.decryptPassword(second)).toBe('two')
      expect(stats.created).toHaveLength(1)
    },
    30_000
  )
})
