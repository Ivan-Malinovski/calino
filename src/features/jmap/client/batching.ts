import type { JsonObject, JsonValue } from '../types'
import { JmapError } from './errors'
import { isObject, type JmapInvocation } from './session'

export interface JmapResultReference {
  resultOf: string
  name: string
  path: string
}

/** Spread into arguments: { accountId, ...resultReference('ids', 'query', 'CalendarEvent/query', '/ids') }. */
export function resultReference(
  argument: string,
  resultOf: string,
  name: string,
  path: string
): JsonObject {
  return { [`#${argument}`]: { resultOf, name, path } }
}

function pointer(value: JsonValue, path: string): JsonValue {
  if (path === '') return value
  if (!path.startsWith('/'))
    throw new JmapError('Invalid result-reference path', { type: 'invalidResultReference' })
  const parts = path
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  const visit = (current: JsonValue, index: number): JsonValue => {
    if (index === parts.length) return current
    const key = parts[index]
    if (key === '*') {
      if (!Array.isArray(current))
        throw new JmapError('Result-reference wildcard requires an array', {
          type: 'invalidResultReference',
        })
      return current.flatMap((item) => {
        const value = visit(item, index + 1)
        return Array.isArray(value) ? value : [value]
      })
    }
    const next = Array.isArray(current)
      ? /^(0|[1-9]\d*)$/.test(key)
        ? current[Number(key)]
        : undefined
      : isObject(current) && Object.hasOwn(current, key)
        ? current[key]
        : undefined
    if (next === undefined)
      throw new JmapError('Result-reference path not found', { type: 'invalidResultReference' })
    return visit(next, index + 1)
  }
  return visit(value, 0)
}

/** References whose producer remains in the same batch are left on the wire. */
export function resolveReferences(args: JsonObject, previous: JmapInvocation[]): JsonObject {
  const resolved = { ...args }
  for (const [key, ref] of Object.entries(args)) {
    if (!key.startsWith('#')) continue
    if (
      !isObject(ref) ||
      typeof ref.resultOf !== 'string' ||
      typeof ref.name !== 'string' ||
      typeof ref.path !== 'string'
    ) {
      throw new JmapError('Invalid JMAP result reference', { type: 'invalidResultReference' })
    }
    const response = previous.find(([name, , id]) => id === ref.resultOf && name === ref.name)
    if (!response) continue
    if (Object.hasOwn(args, key.slice(1)))
      throw new JmapError('Duplicate result-reference argument', { type: 'invalidArguments' })
    resolved[key.slice(1)] = pointer(response[1], ref.path)
    delete resolved[key]
  }
  return resolved
}

export function positiveLimit(value: JsonValue | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : Number.MAX_SAFE_INTEGER
}

export function splitArguments(
  name: string,
  args: JsonObject,
  getLimit: number,
  setLimit: number
): JsonObject[] {
  if (name.endsWith('/get') && Array.isArray(args.ids) && args.ids.length > getLimit) {
    const parts: JsonObject[] = []
    for (let i = 0; i < args.ids.length; i += getLimit)
      parts.push({ ...args, ids: args.ids.slice(i, i + getLimit) })
    return parts
  }
  if (!name.endsWith('/set')) return [args]
  const operations: [string, string, JsonValue][] = []
  for (const field of ['create', 'update']) {
    if (isObject(args[field])) {
      for (const [id, value] of Object.entries(args[field])) operations.push([field, id, value])
    }
  }
  if (Array.isArray(args.destroy)) {
    for (const id of args.destroy) {
      if (typeof id !== 'string')
        throw new JmapError('Invalid destroy id', { type: 'invalidArguments' })
      operations.push(['destroy', id, id])
    }
  }
  if (operations.length <= setLimit) return [args]
  // An implicit update may generate a second set; its references/limits cannot be safely partitioned here.
  if (Object.keys(args).some((key) => key.startsWith('onSuccess'))) {
    throw new JmapError('Cannot split /set with onSuccess arguments safely', {
      type: 'limit',
      status: 413,
    })
  }
  const parts: JsonObject[] = []
  for (let i = 0; i < operations.length; i += setLimit) {
    const part = { ...args }
    delete part.create
    delete part.update
    delete part.destroy
    for (const [field, id, value] of operations.slice(i, i + setLimit)) {
      if (field === 'destroy') {
        const ids = Array.isArray(part.destroy) ? part.destroy : []
        ids.push(id)
        part.destroy = ids
      } else {
        const map = isObject(part[field]) ? part[field] : {}
        map[id] = value
        part[field] = map
      }
    }
    parts.push(part)
  }
  return parts
}

export function mergeResponses(name: string, args: JsonObject, parts: JsonObject[]): JsonObject {
  const merged: JsonObject = { ...parts[0] }
  for (const part of parts.slice(1)) {
    if (name.endsWith('/get') && part.state !== merged.state) {
      throw new JmapError('JMAP state changed while splitting /get; retry the read', {
        type: 'stateMismatch',
        status: 412,
      })
    }
    for (const [key, value] of Object.entries(part)) {
      if (
        value === null &&
        ['created', 'updated', 'destroyed', 'notCreated', 'notUpdated', 'notDestroyed'].includes(
          key
        )
      )
        continue
      if (Array.isArray(value) && Array.isArray(merged[key]))
        merged[key] = [...merged[key], ...value]
      else if (isObject(value) && isObject(merged[key])) merged[key] = { ...merged[key], ...value }
      else if (key !== 'oldState') merged[key] = value
    }
  }
  // Servers may omit null success maps; preserve the final newState and first oldState.
  if (name.endsWith('/set') && typeof args.accountId === 'string') merged.accountId = args.accountId
  return merged
}
