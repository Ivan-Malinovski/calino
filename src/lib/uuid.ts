/**
 * Validates RFC 4122 UUID format. Thin wrapper over `uuid.validate` from the
 * existing `uuid` dependency, which covers versions 1-7 and the standard
 * variant byte (8/9/a/b).
 */
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'

/**
 * Generate a UUID on browsers that implement crypto.randomUUID(), while
 * retaining support for older WebKit builds where only getRandomValues() is
 * available. The uuid package uses the latter for its v4 implementation.
 */
export function createUuid(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return uuidv4()
}

export function isUUID(value: string): boolean {
  return uuidValidate(value)
}
