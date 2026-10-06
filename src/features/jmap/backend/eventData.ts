import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { JsonObject, JsonValue, JSCalendarObject } from '../types'
import { icsToJscalendar, diffJscalendar } from '../convert/icsToJscalendar'
import { equalJson, isJsonObject } from '../convert/jscalendarDiff'
import { jscalendarToIcs } from '../convert/jscalendarToIcs'
import { address } from '../convert/jscalToIcsPeople'

export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isJsonObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function eventEtag(event: JSCalendarObject): string {
  return `"${bytesToHex(sha256(new TextEncoder().encode(canonicalJson(event))))}"`
}

/** Apply changes to the converter's projection, retaining unrepresented data. */
function reconcile(
  server: JsonValue | undefined,
  projected: JsonValue | undefined,
  next: JsonValue
): JsonValue {
  if (equalJson(projected, next) && server !== undefined) return structuredClone(server)
  if (!isJsonObject(server) || !isJsonObject(projected) || !isJsonObject(next))
    return structuredClone(next)
  const result = structuredClone(server)
  for (const key of new Set([...Object.keys(projected), ...Object.keys(next)])) {
    if (equalJson(projected[key], next[key])) continue
    if (!Object.hasOwn(next, key)) delete result[key]
    else
      Object.defineProperty(result, key, {
        value: reconcile(server[key], projected[key], next[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      })
  }
  return result
}
function alignParticipants(
  server: JsonObject,
  projected: JsonObject,
  next: JsonObject
): [JsonObject, JsonObject] {
  const ids = new Map<string, string>()
  for (const [id, participant] of Object.entries(server)) {
    if (isJsonObject(participant)) {
      const value = address(participant)
      if (value) ids.set(value.toLowerCase(), id)
    }
  }
  const align = (map: JsonObject): JsonObject =>
    Object.fromEntries(
      Object.entries(map).map(([id, value]) => {
        const calAddress = isJsonObject(value) ? address(value) : undefined
        return [calAddress ? (ids.get(calAddress.toLowerCase()) ?? id) : id, value]
      })
    )
  return [align(projected), align(next)]
}
/** Converter map ids are synthetic too (a0/l0/f0); map them back to server ids. */
function alignMap(
  event: JSCalendarObject,
  field: string,
  projected: JsonObject,
  next: JsonObject
): [JsonObject, JsonObject] {
  const server = event[field]
  if (!isJsonObject(server)) return [projected, next]
  const ids = new Map<string, string>()
  const used = new Set<string>()
  for (const [projectedId, value] of Object.entries(projected)) {
    for (const id of Object.keys(server).sort()) {
      if (used.has(id)) continue
      const isolated = { ...event, [field]: { [id]: server[id] } }
      if (field === 'links') delete isolated.virtualLocations
      const normalized = icsToJscalendar(jscalendarToIcs(isolated)).event[field]
      if (
        isJsonObject(normalized) &&
        Object.values(normalized).some((candidate) => equalJson(candidate, value))
      ) {
        ids.set(projectedId, id)
        used.add(id)
        break
      }
    }
  }
  const oldMap = Object.fromEntries(
    Object.entries(projected).map(([id, value]) => [ids.get(id) ?? id, value])
  )
  const newMap: JsonObject = {}
  for (const [id, value] of Object.entries(next)) {
    // Removing/reordering alarms or attachments shifts the converter indices.
    const match = Object.entries(projected).find(
      ([oldId, oldValue]) =>
        ids.has(oldId) && !Object.hasOwn(newMap, ids.get(oldId)!) && equalJson(oldValue, value)
    )
    const serverId = (match ? ids.get(match[0]) : ids.get(id)) ?? id
    Object.defineProperty(newMap, serverId, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return [oldMap, newMap]
}
export function eventPatch(previous: JSCalendarObject, next: JSCalendarObject) {
  // Diff represented data first: server defaults and unchanged lossy mappings
  // must not be rewritten merely by opening the editor.
  const projected = icsToJscalendar(jscalendarToIcs(previous)).event
  const desired = structuredClone(previous)
  for (const key of new Set([...Object.keys(projected), ...Object.keys(next)])) {
    if (['id', 'created', 'updated', 'calendarIds'].includes(key)) continue
    if (equalJson(projected[key], next[key])) continue
    if (!Object.hasOwn(next, key)) delete desired[key]
    else if (
      key === 'participants' &&
      isJsonObject(previous[key]) &&
      isJsonObject(projected[key]) &&
      isJsonObject(next[key])
    ) {
      const [oldMap, newMap] = alignParticipants(previous[key], projected[key], next[key])
      desired[key] = reconcile(previous[key], oldMap, newMap)
    } else if (
      ['alerts', 'locations', 'links'].includes(key) &&
      isJsonObject(previous[key]) &&
      isJsonObject(projected[key]) &&
      isJsonObject(next[key])
    ) {
      const [oldMap, newMap] = alignMap(previous, key, projected[key], next[key])
      // Multiple JSCalendar locations collapse to one LOCATION in the read
      // converter. An edit deliberately replaces that lossy representation.
      desired[key] =
        key === 'locations' &&
        Object.keys(oldMap).some((id) => !Object.hasOwn(previous[key] as JsonObject, id))
          ? next[key]
          : reconcile(previous[key], oldMap, newMap)
    } else desired[key] = reconcile(previous[key], projected[key], next[key])
  }
  if (next.calendarIds !== undefined) desired.calendarIds = next.calendarIds
  return diffJscalendar(previous, desired)
}
