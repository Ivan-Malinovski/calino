import { diffObjects, equalJson, isJsonObject } from '../../convert/jscalendarDiff'
import type { JsonObject, JsonValue, JmapPatch } from '../../types'
import { jscontactToVCard } from './jscontactToVCard'
import { vCardToJscontact } from './vCardToJscontact'
import type { JSContactCard } from './values'

export function diffJscontact(before: JSContactCard, after: JSContactCard): JmapPatch {
  return diffObjects(before, after, new Set(['id', 'blobId', 'size', 'created', 'updated']))
}
function reconcile(
  server: JsonValue | undefined,
  before: JsonValue | undefined,
  after: JsonValue
): JsonValue {
  if (equalJson(before, after) && server !== undefined) return structuredClone(server)
  if (!isJsonObject(server) || !isJsonObject(before) || !isJsonObject(after))
    return structuredClone(after)
  const desired = structuredClone(server)
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equalJson(before[key], after[key])) continue
    if (!Object.hasOwn(after, key)) delete desired[key]
    else
      Object.defineProperty(desired, key, {
        value: reconcile(server[key], before[key], after[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      })
  }
  return desired
}
const mapFields = new Set([
  'nicknames',
  'organizations',
  'titles',
  'emails',
  'phones',
  'addresses',
  'links',
  'onlineServices',
  'notes',
  'anniversaries',
  'media',
])

/** Only changes to represented fields are written. Unchanged lossy data survives. */
export function contactPatch(
  previous: JSContactCard,
  next: JSContactCard,
  project: (card: JSContactCard) => JSContactCard = (card) =>
    vCardToJscontact(jscontactToVCard(card))
): JmapPatch {
  const projected = project(previous)
  const desired = structuredClone(previous)
  for (const key of new Set([...Object.keys(projected), ...Object.keys(next)])) {
    if (equalJson(projected[key], next[key])) continue
    if (!Object.hasOwn(next, key)) {
      delete desired[key]
      continue
    }
    let before = projected[key],
      after = next[key]
    const server = previous[key]
    if (mapFields.has(key) && isJsonObject(server) && isJsonObject(before) && isJsonObject(after)) {
      const ids = new Map<string, string>(),
        used = new Set<string>()
      for (const [id, value] of Object.entries(before)) {
        for (const serverId of Object.keys(server)) {
          if (used.has(serverId)) continue
          const isolated = project({ ...previous, [key]: { [serverId]: server[serverId] } })[key]
          if (
            isJsonObject(isolated) &&
            Object.values(isolated).some((entry) => equalJson(entry, value))
          ) {
            ids.set(id, serverId)
            used.add(serverId)
            break
          }
        }
      }
      const aligned: JsonObject = Object.create(null)
      const assigned = new Set<string>()
      const nextIds = new Map<string, string>()
      // Match unchanged values first, so removals/reordering do not rename them.
      for (const [id, value] of Object.entries(after)) {
        const match = Object.entries(before).find(
          ([oldId, oldValue]) =>
            ids.has(oldId) && !assigned.has(ids.get(oldId)!) && equalJson(value, oldValue)
        )
        if (match) {
          nextIds.set(id, ids.get(match[0])!)
          assigned.add(ids.get(match[0])!)
        }
      }
      for (const [id, value] of Object.entries(after)) {
        let target = nextIds.get(id) ?? (!assigned.has(ids.get(id) ?? id) ? ids.get(id) : undefined)
        if (!target) {
          target = id
          while (Object.hasOwn(server, target) || assigned.has(target)) target += '_'
        }
        aligned[target] = value
        assigned.add(target)
      }
      before = Object.fromEntries(
        Object.entries(before).map(([id, value]) => [ids.get(id) ?? id, value])
      )
      after = aligned
    }
    desired[key] = reconcile(server, before, after)
  }
  return diffJscontact(previous, desired)
}
