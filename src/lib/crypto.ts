/**
 * CalDAV Password Encryption
 *
 * SECURITY NOTE — please read before relying on this for anything sensitive:
 *
 * This module has TWO modes:
 * 1. **App-level encryption** (`encryptPassword` / `decryptPassword`) — uses
 *    a fixed key (`APP_SECRET` + `APP_SALT`) hardcoded in this JS bundle.
 *    It is OBfuscation, not ENcryption: anyone with the JS bundle and
 *    access to localStorage can derive the same AES key and decrypt stored
 *    CalDAV credentials. It only protects against casual inspection (e.g.
 *    another site reading your localStorage via a typo'd domain).
 *
 * 2. **Master-password encryption** (`encryptWithMasterPassword` /
 *    `decryptWithMasterPassword`) — uses a user-supplied password to
 *    derive the AES key. The key never leaves the device. This is real
 *    encryption. Used for the optional self-hosted config file.
 *
 * For v1 we accept (1) as documented behavior. A future release should
 * stop persisting the master password at all and instead require the user
 * to unlock each session.
 */

import { gcm } from '@noble/ciphers/aes.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'

// ─── App-level encryption (existing) ─────────────────────────────────────────

const APP_SECRET = 'calino-caldav-v1-2024'
const APP_SALT = 'calino-salt-v1-2024'
const PBKDF2_ITERATIONS = 600_000

export interface EncryptedData {
  iv: string
  data: string
}

// ─── Master-password encryption (self-hosted config) ─────────────────────────

export interface MasterEncryptedData {
  ciphertext: string // base64url
  iv: string // base64url
  salt: string // base64url
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

let cachedKey: CryptoKey | null = null

type NativeCrypto = Crypto & { subtle: SubtleCrypto }

/**
 * Some embedded/older WebKit contexts expose getRandomValues() without
 * exposing crypto.subtle. Firefox for iOS is one example: its web content
 * runs in Apple's WebKit even though the browser chrome is Firefox.
 */
function getNativeCrypto(): NativeCrypto | null {
  const cryptoApi = globalThis.crypto
  const subtle = cryptoApi?.subtle

  if (
    !cryptoApi ||
    typeof cryptoApi.getRandomValues !== 'function' ||
    !subtle ||
    typeof subtle.importKey !== 'function' ||
    typeof subtle.deriveKey !== 'function' ||
    typeof subtle.encrypt !== 'function' ||
    typeof subtle.decrypt !== 'function'
  ) {
    return null
  }

  return cryptoApi as NativeCrypto
}

function randomBytes(length: number): Uint8Array {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('This browser does not provide a secure random number generator')
  }

  return cryptoApi.getRandomValues(new Uint8Array(length))
}

async function deriveJavaScriptKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Async(sha256, password, salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  })
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey

  const cryptoApi = getNativeCrypto()
  if (!cryptoApi) {
    throw new Error('Web Crypto is unavailable')
  }

  const encoder = new TextEncoder()
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(APP_SECRET),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  cachedKey = await cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(APP_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  return cachedKey
}

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  // Convert base64url to standard base64
  let stdBase64 = base64.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  const padding = (4 - (stdBase64.length % 4)) % 4
  stdBase64 += '='.repeat(padding)

  const binary = atob(stdBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function encryptPassword(password: string): Promise<EncryptedData> {
  const encoder = new TextEncoder()
  const iv = randomBytes(12)
  const cryptoApi = getNativeCrypto()

  if (!cryptoApi) {
    const key = await deriveJavaScriptKey(APP_SECRET, encoder.encode(APP_SALT))
    const encrypted = gcm(key, iv).encrypt(encoder.encode(password))

    return {
      iv: toBase64(iv),
      data: toBase64(encrypted),
    }
  }

  const key = await getEncryptionKey()

  const encrypted = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoder.encode(password)
  )

  return {
    iv: toBase64(iv),
    data: toBase64(encrypted),
  }
}

export async function decryptPassword(encrypted: EncryptedData): Promise<string> {
  const decoder = new TextDecoder()
  const iv = fromBase64(encrypted.iv)
  const data = fromBase64(encrypted.data)
  const cryptoApi = getNativeCrypto()

  if (!cryptoApi) {
    const key = await deriveJavaScriptKey(APP_SECRET, new TextEncoder().encode(APP_SALT))
    const decrypted = gcm(key, iv).decrypt(data)
    return decoder.decode(decrypted)
  }

  const key = await getEncryptionKey()

  const decrypted = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    new Uint8Array(data)
  )

  return decoder.decode(decrypted)
}

/**
 * Check if a password value is in the new encrypted format.
 */
export function isEncryptedPassword(value: unknown): value is EncryptedData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'iv' in value &&
    'data' in value &&
    typeof (value as EncryptedData).iv === 'string' &&
    typeof (value as EncryptedData).data === 'string'
  )
}

// ─── Master-password encryption (for self-hosted config files) ───────────────

/**
 * Derive an AES-256-GCM key from a user-provided master password.
 * Each password has its own random salt.
 */
async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const cryptoApi = getNativeCrypto()
  if (!cryptoApi) {
    throw new Error('Web Crypto is unavailable')
  }

  const encoder = new TextEncoder()
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt a CalDAV password with a master password.
 * Returns a self-contained blob with ciphertext, iv, and salt.
 */
export async function encryptWithMasterPassword(
  plaintext: string,
  masterPassword: string
): Promise<MasterEncryptedData> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const encoder = new TextEncoder()
  const cryptoApi = getNativeCrypto()

  if (!cryptoApi) {
    const key = await deriveJavaScriptKey(masterPassword, salt)
    const encrypted = gcm(key, iv).encrypt(encoder.encode(plaintext))

    return {
      ciphertext: toBase64(encrypted),
      iv: toBase64(iv),
      salt: toBase64(salt),
    }
  }

  const key = await deriveKeyFromPassword(masterPassword, salt)

  const encrypted = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoder.encode(plaintext)
  )

  return {
    ciphertext: toBase64(encrypted),
    iv: toBase64(iv),
    salt: toBase64(salt),
  }
}

/**
 * Decrypt a CalDAV password with a master password.
 * Throws on wrong password or corrupted data.
 */
export async function decryptWithMasterPassword(
  encrypted: MasterEncryptedData,
  masterPassword: string
): Promise<string> {
  const salt = fromBase64(encrypted.salt)
  const iv = fromBase64(encrypted.iv)
  const ciphertext = fromBase64(encrypted.ciphertext)
  const cryptoApi = getNativeCrypto()

  if (!cryptoApi) {
    const key = await deriveJavaScriptKey(masterPassword, salt)
    const decrypted = gcm(key, iv).decrypt(ciphertext)
    return new TextDecoder().decode(decrypted)
  }

  const key = await deriveKeyFromPassword(masterPassword, salt)

  const decrypted = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext)
  )

  return new TextDecoder().decode(decrypted)
}

/**
 * Check if a value matches the MasterEncryptedData shape.
 */
export function isMasterEncryptedData(value: unknown): value is MasterEncryptedData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ciphertext' in value &&
    'iv' in value &&
    'salt' in value &&
    typeof (value as MasterEncryptedData).ciphertext === 'string' &&
    typeof (value as MasterEncryptedData).iv === 'string' &&
    typeof (value as MasterEncryptedData).salt === 'string'
  )
}
