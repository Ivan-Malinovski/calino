import ICAL from 'ical.js'
import type { JsonObject, JsonValue } from '../types'
import { utcTime } from './icsToJscalTime'
import type { IcsZoneContext } from './icsToJscalTime'

export function text(component: ICAL.Component, name: string): string | undefined {
  const value: unknown = component.getFirstPropertyValue(name)
  return typeof value === 'string' ? value : undefined
}

/** FNV-1a over UTF-16: compact, deterministic, valid JSCalendar ids. */
export function stableKey(prefix: string, value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return prefix + (hash >>> 0).toString(16).padStart(8, '0')
}

function values(property: ICAL.Property, parameter: string): string[] {
  const value: unknown = property.getParameter(parameter)
  if (typeof value === 'string') return [value]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function put(object: JsonObject, key: string, value: JsonValue): void {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

export function setMap(component: ICAL.Component, property: string): JsonObject | undefined {
  const result: JsonObject = {}
  for (const prop of component.getAllProperties(property)) {
    for (const value of prop.getValues() as unknown[]) {
      if (typeof value === 'string') put(result, value, true)
    }
  }
  return Object.keys(result).length ? result : undefined
}

export function participants(
  component: ICAL.Component,
  vocabulary: 'draft' | 'rfc8984'
): JsonObject | undefined {
  const result: JsonObject = {}
  const addresses = new Map<string, string>()
  const keyFor = (address: string) => {
    const canonical = address.replace(/^MAILTO:/i, 'mailto:')
    let key = addresses.get(canonical)
    if (!key) {
      const base = stableKey('p', canonical)
      key = base
      let suffix = 1
      while (Object.hasOwn(result, key)) key = `${base}_${suffix++}`
      addresses.set(canonical, key)
    }
    return key
  }
  const ensure = (address: string): JsonObject => {
    const key = keyFor(address)
    if (!result[key]) {
      const uri = address.replace(/^MAILTO:/i, 'mailto:')
      result[key] =
        vocabulary === 'draft'
          ? { '@type': 'Participant', calendarAddress: uri }
          : {
              '@type': 'Participant',
              sendTo: { imip: uri },
              ...(uri.startsWith('mailto:') ? { email: uri.slice(7) } : {}),
            }
    }
    return result[key] as JsonObject
  }
  // Organizer first so an ATTENDEE for the same address adds to its roles.
  for (const property of [
    ...component.getAllProperties('organizer'),
    ...component.getAllProperties('attendee'),
  ]) {
    const address = property.getFirstValue()
    if (typeof address !== 'string') continue
    const participant = ensure(address)
    const name = property.getFirstParameter('cn')
    if (name) participant.name = name
    const roles = (participant.roles ?? {}) as JsonObject
    if (property.name === 'organizer') roles.owner = true
    else {
      const role = property.getFirstParameter('role')?.toUpperCase() ?? 'REQ-PARTICIPANT'
      if (vocabulary === 'draft')
        roles[
          role === 'CHAIR'
            ? 'chair'
            : role === 'NON-PARTICIPANT'
              ? 'informational'
              : role === 'OPT-PARTICIPANT'
                ? 'optional'
                : 'required'
        ] = true
      else {
        roles[
          role === 'CHAIR' ? 'chair' : role === 'NON-PARTICIPANT' ? 'informational' : 'attendee'
        ] = true
        if (role === 'OPT-PARTICIPANT') roles.optional = true
      }
      const partstat = property.getFirstParameter('partstat')
      if (partstat) participant.participationStatus = partstat.toLowerCase()
      const rsvp = property.getFirstParameter('rsvp')
      if (rsvp) participant.expectReply = rsvp.toUpperCase() === 'TRUE'
      const cutype = property.getFirstParameter('cutype')?.toUpperCase()
      const kinds: Record<string, string> = {
        INDIVIDUAL: 'individual',
        GROUP: 'group',
        RESOURCE: 'resource',
        ROOM: 'location',
        UNKNOWN: '',
      }
      if (cutype && kinds[cutype]) participant.kind = kinds[cutype]
      for (const [parameter, field] of [
        ['delegated-to', 'delegatedTo'],
        ['delegated-from', 'delegatedFrom'],
        ['member', 'memberOf'],
      ]) {
        const refs: JsonObject = {}
        for (const target of values(property, parameter)) {
          if (vocabulary === 'rfc8984') ensure(target)
          put(refs, vocabulary === 'draft' ? target : keyFor(target), true)
        }
        if (Object.keys(refs).length) participant[field] = refs
      }
    }
    participant.roles = roles
    const sentBy = property.getFirstParameter('sent-by')
    if (sentBy) participant.sentBy = sentBy.replace(/^mailto:/i, '')
  }
  return Object.keys(result).length ? result : undefined
}

export function alerts(component: ICAL.Component, context: IcsZoneContext): JsonObject | undefined {
  const result: JsonObject = {}
  for (const [index, alarm] of component.getAllSubcomponents('valarm').entries()) {
    const triggerProperty = alarm.getFirstProperty('trigger')
    const triggerValue = triggerProperty?.getFirstValue()
    const action = text(alarm, 'action')?.toLowerCase()
    if (!triggerProperty || (action !== 'display' && action !== 'email')) continue
    let trigger: JsonObject
    if (triggerValue instanceof ICAL.Duration) {
      trigger = {
        '@type': 'OffsetTrigger',
        offset: triggerValue.toString(),
        relativeTo:
          triggerProperty.getFirstParameter('related')?.toUpperCase() === 'END' ? 'end' : 'start',
      }
    } else if (triggerValue instanceof ICAL.Time) {
      trigger = {
        '@type': 'AbsoluteTrigger',
        when: utcTime(triggerValue, triggerProperty, context),
      }
    } else continue
    const uid = text(alarm, 'uid')
    const alert: JsonObject = { '@type': 'Alert', trigger, action }
    const acknowledgedProperty = alarm.getFirstProperty('acknowledged')
    const acknowledgedValue = acknowledgedProperty?.getFirstValue()
    // ical.js 2 does not register RFC 9074 ACKNOWLEDGED by default.
    const acknowledged =
      typeof acknowledgedValue === 'string'
        ? ICAL.Property.fromString(`DTSTAMP:${acknowledgedValue}`).getFirstValue()
        : acknowledgedValue
    if (acknowledged instanceof ICAL.Time)
      alert.acknowledged = utcTime(acknowledged, acknowledgedProperty ?? null, context)
    // Alert has no uid property. RFC 9074 UID is represented by the map id.
    const base = uid
      ? /^[A-Za-z0-9_-]{1,255}$/.test(uid)
        ? uid
        : stableKey('a', uid)
      : `a${index}`
    let key = base
    let suffix = 1
    while (Object.hasOwn(result, key)) key = `${base}_${suffix++}`
    result[key] = alert
  }
  return Object.keys(result).length ? result : undefined
}

export function locations(component: ICAL.Component): JsonObject | undefined {
  const result: JsonObject = {}
  for (const [index, property] of component.getAllProperties('location').entries()) {
    const name = property.getFirstValue()
    if (typeof name === 'string') result[`l${index}`] = { '@type': 'Location', name }
  }
  const geo: unknown = component.getFirstPropertyValue('geo')
  if (Array.isArray(geo) && geo.length === 2) {
    if (!result.l0) result.l0 = { '@type': 'Location' }
    const location = result.l0 as JsonObject
    location.coordinates = `geo:${geo[0]},${geo[1]}`
  }
  return Object.keys(result).length ? result : undefined
}

export function links(component: ICAL.Component): JsonObject | undefined {
  const result: JsonObject = {}
  const url = text(component, 'url')
  if (url) result.url = { '@type': 'Link', href: url, rel: 'describedby' }
  for (const [index, property] of component.getAllProperties('attach').entries()) {
    const value = property.getFirstValue()
    const contentType = property.getFirstParameter('fmttype')
    const binary = value instanceof ICAL.Binary
    if (!binary && typeof value !== 'string') continue
    const href = binary
      ? `data:${contentType || 'application/octet-stream'};base64,${value.toString()}`
      : value
    const link: JsonObject = { '@type': 'Link', href, rel: 'enclosure' }
    if (contentType) link.contentType = contentType
    result[`f${index}`] = link
  }
  return Object.keys(result).length ? result : undefined
}

export function relatedTo(component: ICAL.Component): JsonObject | undefined {
  const result: JsonObject = {}
  for (const property of component.getAllProperties('related-to')) {
    const uid = property.getFirstValue()
    if (typeof uid !== 'string') continue
    const relation = property.getFirstParameter('reltype')?.toLowerCase() ?? 'parent'
    const previous = result[uid] as JsonObject | undefined
    const relations = (previous?.relation ?? {}) as JsonObject
    put(relations, relation, true)
    put(result, uid, { '@type': 'Relation', relation: relations })
  }
  return Object.keys(result).length ? result : undefined
}
