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

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey

  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(APP_SECRET),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  cachedKey = await crypto.subtle.deriveKey(
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

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
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
  const key = await getEncryptionKey()
  const encoder = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(password)
  )

  return {
    iv: toBase64(iv.buffer),
    data: toBase64(encrypted),
  }
}

export async function decryptPassword(encrypted: EncryptedData): Promise<string> {
  const key = await getEncryptionKey()
  const decoder = new TextDecoder()
  const iv = fromBase64(encrypted.iv)
  const data = fromBase64(encrypted.data)

  const decrypted = await crypto.subtle.decrypt(
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
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
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
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKeyFromPassword(masterPassword, salt)
  const encoder = new TextEncoder()

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  )

  return {
    ciphertext: toBase64(encrypted),
    iv: toBase64(iv.buffer),
    salt: toBase64(salt.buffer),
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
  const key = await deriveKeyFromPassword(masterPassword, salt)

  const decrypted = await crypto.subtle.decrypt(
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
