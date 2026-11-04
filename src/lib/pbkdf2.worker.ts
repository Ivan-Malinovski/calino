/**
 * Runs one JavaScript PBKDF2-SHA256 derivation off the main thread. Used only
 * where SubtleCrypto is unavailable; see `deriveJavaScriptKey` in crypto.ts.
 */
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'

export interface Pbkdf2Request {
  password: string
  salt: Uint8Array
  iterations: number
  dkLen: number
}

export type Pbkdf2Response = { key: Uint8Array } | { error: string }

self.onmessage = async (event: MessageEvent<Pbkdf2Request>) => {
  const { password, salt, iterations, dkLen } = event.data
  let response: Pbkdf2Response
  try {
    response = { key: await pbkdf2Async(sha256, password, salt, { c: iterations, dkLen }) }
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
