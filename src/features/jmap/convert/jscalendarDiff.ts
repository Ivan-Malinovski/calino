import type { JsonObject, JsonValue, JSCalendarObject, JmapPatch } from '../types'

const serverOwned = new Set(['id', 'isOrigin', 'isDraft', 'updated', 'created'])

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function equalJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equalJson(value, b[index]))
  }
  if (!isJsonObject(a) || !isJsonObject(b)) return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]))
  )
}

function escapePath(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1')
}

/** Null in a PatchObject deletes. Replace the containing object to introduce a literal null. */
function needsReplacement(before: JsonObject, after: JsonObject): boolean {
  return Object.keys(after).some((key) => after[key] === null && before[key] !== null)
}

/** Server-owned metadata stays untouched; calendar membership changes are writable. */
export function diffJscalendar(before: JSCalendarObject, after: JSCalendarObject): JmapPatch {
  return diffObjects(before, after, serverOwned)
}

/** Also used for recurrence patches, whose forbidden properties differ from JMAP updates. */
export function diffObjects(
  before: JsonObject,
  after: JsonObject,
  ignored = new Set<string>()
): JmapPatch {
  const patch: JmapPatch = {}
  function visit(old: JsonObject, next: JsonObject, prefix: string): void {
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (!prefix && ignored.has(key)) continue
      const path = prefix + escapePath(key)
      if (!Object.hasOwn(next, key)) {
        Object.defineProperty(patch, path, {
          value: null,
          enumerable: true,
          configurable: true,
          writable: true,
        })
      } else if (!equalJson(old[key], next[key])) {
        const previous = old[key]
        const value = next[key]
        if (
          isJsonObject(previous) &&
          isJsonObject(value) &&
          key !== 'recurrenceRule' &&
          !needsReplacement(previous, value)
        ) {
          visit(previous, value, path + '/')
        } else {
          Object.defineProperty(patch, path, {
            value: structuredClone(value),
            enumerable: true,
            configurable: true,
            writable: true,
          })
        }
      }
    }
  }
  visit(before, after, '')
  return patch
}

/** Apply a JMAP patch without mutating the input. Invalid paths are rejected. */
export function applyJmapPatch(before: JSCalendarObject, patch: JmapPatch): JSCalendarObject {
  const result = structuredClone(before)
  const paths = Object.keys(patch).map((path) => {
    if (!path || /~(?![01])/.test(path)) throw new Error(`Invalid patch path: ${path}`)
    return {
      path,
      keys: path.split('/').map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~')),
    }
  })
  for (const { path, keys } of paths) {
    if (paths.some((other) => other.path !== path && other.path.startsWith(path + '/'))) {
      throw new Error(`Overlapping patch path: ${path}`)
    }
    let object = result
    for (const key of keys.slice(0, -1)) {
      const value = Object.hasOwn(object, key) ? object[key] : undefined
      if (!isJsonObject(value)) throw new Error(`Missing object in patch path: ${path}`)
      object = value
    }
    const key = keys[keys.length - 1]
    if (patch[path] === null) delete object[key]
    else
      Object.defineProperty(object, key, {
        value: structuredClone(patch[path]),
        enumerable: true,
        configurable: true,
        writable: true,
      })
  }
  return result
}
