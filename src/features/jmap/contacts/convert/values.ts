import type { JsonObject, JsonValue } from '../../types'
import { isJsonObject } from '../../convert/jscalendarDiff'

export type JSContactCard = JsonObject
export { isJsonObject }
export const object = (value: JsonValue | undefined): JsonObject =>
  isJsonObject(value) ? value : {}
export const string = (value: JsonValue | undefined): string =>
  typeof value === 'string' ? value : ''
export const entries = (value: JsonValue | undefined): [string, JsonObject][] =>
  Object.entries(object(value)).filter((entry): entry is [string, JsonObject] =>
    isJsonObject(entry[1])
  )
export const values = (value: JsonValue | undefined): JsonObject[] =>
  entries(value).map(([, item]) => item)
export const escape = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
export const unescape = (value: string): string =>
  value.replace(/\\([nN,;\\])/g, (_, char: string) => (/n/i.test(char) ? '\n' : char))

export function split(value: string, delimiter: string): string[] {
  const result: string[] = []
  let start = 0
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      i++
      continue
    }
    if (value[i] === '"') quoted = !quoted
    if (value[i] === delimiter && !quoted) {
      result.push(value.slice(start, i))
      start = i + 1
    }
  }
  result.push(value.slice(start))
  return result
}
export interface VCardProperty {
  name: string
  params: Record<string, string[]>
  value: string
}
export function parseProperties(vcard: string): VCardProperty[] {
  const lines = vcard.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  if (
    lines.filter((line) => /^BEGIN:VCARD$/i.test(line)).length !== 1 ||
    !lines.some((line) => /^END:VCARD$/i.test(line))
  )
    throw new Error('Expected one complete vCard')
  return lines.filter(Boolean).map((line) => {
    let colon = -1
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted
      if (line[i] === ':' && !quoted) {
        colon = i
        break
      }
    }
    if (colon < 0) throw new Error('Malformed vCard content line')
    const [name, ...parameters] = split(line.slice(0, colon), ';')
    const params: Record<string, string[]> = Object.create(null)
    for (const parameter of parameters) {
      const equals = parameter.indexOf('=')
      const key = equals < 0 ? 'TYPE' : parameter.slice(0, equals).toUpperCase()
      const raw = equals < 0 ? parameter : parameter.slice(equals + 1)
      const decoded = raw
        .replace(/^"(.*)"$/, '$1')
        .replace(/\^(\^|n|')/gi, (_, char: string) =>
          char === '^' ? '^' : char === "'" ? '"' : '\n'
        )
      params[key] = [...(params[key] ?? []), ...split(decoded, ',')]
    }
    return { name: name.split('.').at(-1)!.toUpperCase(), params, value: line.slice(colon + 1) }
  })
}
export function metadata(property: VCardProperty): JsonObject {
  const types = (property.params.TYPE ?? []).map((type) => type.toLowerCase())
  const contexts = Object.fromEntries(
    types
      .filter((type) => ['home', 'work', 'private'].includes(type))
      .map((type) => [type === 'home' ? 'private' : type, true])
  )
  const pref = Number(property.params.PREF?.[0] ?? (types.includes('pref') ? 1 : 0))
  return {
    ...(Object.keys(contexts).length ? { contexts } : {}),
    ...(pref >= 1 && pref <= 100 ? { pref } : {}),
  }
}
export function parameters(
  value: JsonObject,
  version: '3.0' | '4.0',
  types: string[] = []
): string {
  const contexts = object(value.contexts)
  if (contexts.private || contexts.home) types.push('home')
  if (contexts.work) types.push('work')
  const pref =
    typeof value.pref === 'number' && value.pref >= 1 && value.pref <= 100 ? value.pref : undefined
  // Calino's parser understands PREF presence (not its numeric priority).
  if (pref && version === '3.0') types.push('pref')
  return (
    (types.length ? `;TYPE=${types.join(',')}` : '') +
    (pref && version === '4.0' ? `;PREF=${pref}` : '')
  )
}
export function fold(line: string): string {
  const parts: string[] = []
  let part = '',
    bytes = 0
  for (const char of line) {
    const size = new TextEncoder().encode(char).length
    if (bytes + size > 75) {
      parts.push(part)
      part = ' '
      bytes = 1
    }
    part += char
    bytes += size
  }
  parts.push(part)
  return parts.join('\r\n')
}
