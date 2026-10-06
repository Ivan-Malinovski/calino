import type { JsonObject } from '../types'
import { address } from './jscalToIcsPeople'
import { entries, keys, object, parameter, string, text, uri, utc } from './jscalToIcsValues'

function inlineAttachment(href: string, contentType?: string): string {
  const match = /^data:([^,]*),(.*)$/is.exec(href)
  if (!match) throw new Error('Invalid JSCalendar data URI attachment')
  const metadata = match[1].split(';')
  const type = contentType ?? (metadata[0] || 'text/plain')
  let encoded: string
  if (metadata.some((part) => part.toLowerCase() === 'base64')) {
    encoded = decodeURIComponent(match[2]).replace(/\s/g, '')
    // Validate before emitting malformed binary data into an iCalendar resource.
    atob(encoded)
  } else {
    // Percent escapes encode bytes, not necessarily UTF-8 (e.g. image data).
    let binary = ''
    const body = match[2]
    for (let i = 0; i < body.length;) {
      if (body[i] === '%' && /^[\da-f]{2}$/i.test(body.slice(i + 1, i + 3))) {
        binary += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16))
        i += 3
      } else {
        const cp = body.codePointAt(i) ?? 0
        const char = String.fromCodePoint(cp)
        for (const byte of new TextEncoder().encode(char)) binary += String.fromCharCode(byte)
        i += char.length
      }
    }
    encoded = btoa(binary)
  }
  return `ATTACH;VALUE=BINARY;ENCODING=BASE64;FMTTYPE=${parameter(type)}:${encoded}`
}

export function content(event: JsonObject): string[] {
  const lines: string[] = []
  for (const [key, name] of [
    ['title', 'SUMMARY'],
    ['description', 'DESCRIPTION'],
    ['color', 'COLOR'],
  ]) {
    const value = string(event[key])
    if (value !== undefined) lines.push(`${name}:${text(value)}`)
  }
  const locations = entries(event.locations).map(([, value]) => object(value))
  const names = locations.flatMap((location) =>
    string(location.name) ? [string(location.name)!] : []
  )
  if (names.length) lines.push(`LOCATION:${text(names.join(', '))}`)
  for (const location of locations) {
    const coords = string(location.coordinates)
    const match = coords ? /^(?:geo:)?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(coords) : undefined
    if (match) {
      lines.push(`GEO:${match[1]};${match[2]}`)
      break // RFC 5545 allows one GEO property per event.
    }
  }
  const keywords = keys(event.keywords)
  if (keywords.length) lines.push(`CATEGORIES:${keywords.map(text).join(',')}`)
  for (const category of keys(event.categories)) lines.push(`CONCEPT:${uri(category)}`)
  let hasUrl = false
  const addUrl = (value: string) => {
    if (!hasUrl) {
      lines.push(`URL:${uri(value)}`)
      hasUrl = true
    }
  }
  for (const [, value] of entries(event.virtualLocations)) {
    const virtual = object(value)
    const href = string(virtual.uri) ?? string(virtual.href)
    if (!href) continue
    addUrl(href)
    const name = string(virtual.name)
    lines.push(`CONFERENCE;VALUE=URI${name ? `;LABEL=${parameter(name)}` : ''}:${uri(href)}`)
  }
  for (const [, value] of entries(event.links)) {
    const link = object(value)
    const href = string(link.href)
    if (!href) continue
    const type = string(link.contentType)
    if (link.rel === 'enclosure') {
      lines.push(
        href.startsWith('data:')
          ? inlineAttachment(href, type)
          : `ATTACH${type ? `;FMTTYPE=${parameter(type)}` : ''}:${uri(href)}`
      )
    } else if (!link.rel || ['alternate', 'describedby', 'self'].includes(string(link.rel) ?? ''))
      addUrl(href)
  }
  for (const [uid, value] of entries(event.relatedTo)) {
    const relation = object(value)
    const rels = keys(relation.relation)
    if (!rels.length) lines.push(`RELATED-TO:${text(uid)}`)
    for (const rel of rels)
      lines.push(`RELATED-TO;RELTYPE=${parameter(rel.toUpperCase())}:${text(uid)}`)
  }
  return lines
}

export function alarms(event: JsonObject): string[] {
  const lines: string[] = []
  for (const [, value] of entries(event.alerts)) {
    const alert = object(value)
    const trigger = object(alert.trigger)
    const offset = string(trigger.offset)
    const when = string(trigger.when)
    const action = (string(alert.action) ?? 'display').toUpperCase()
    if (!['DISPLAY', 'EMAIL'].includes(action)) continue
    let triggerLine: string
    if (when && (trigger['@type'] === 'AbsoluteTrigger' || !trigger['@type'])) {
      triggerLine = `TRIGGER;VALUE=DATE-TIME:${utc(when)}`
    } else if (offset && (trigger['@type'] === 'OffsetTrigger' || !trigger['@type'])) {
      // iCalendar has second precision, whereas JSCalendar allows fractional seconds.
      const normalized = offset.replace(/(\d+)\.\d+S$/, '$1S')
      if (!/^[+-]?P(?=\d|T\d)(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/.test(normalized))
        throw new Error('Invalid JSCalendar alarm offset')
      triggerLine = `TRIGGER;RELATED=${trigger.relativeTo === 'end' || trigger.rel === 'end' ? 'END' : 'START'}:${normalized}`
    } else continue
    lines.push('BEGIN:VALARM', `ACTION:${action}`, triggerLine)
    const title = string(alert.title) ?? string(event.title) ?? 'Reminder'
    const description = string(alert.description) ?? string(event.description) ?? title
    lines.push(`DESCRIPTION:${text(description)}`)
    if (action === 'EMAIL' || typeof alert.title === 'string') lines.push(`SUMMARY:${text(title)}`)
    if (action === 'EMAIL') {
      // Alert-specific recipients are not standardized by RFC 8984. Prefer them
      // when supplied, otherwise use the event's scheduling participants.
      const recipients = entries(alert.recipients ?? event.participants)
      for (const [, recipient] of recipients) {
        const target = string(recipient) ?? address(object(recipient))
        if (target)
          lines.push(`ATTENDEE:${uri(target.includes(':') ? target : `mailto:${target}`)}`)
      }
      if (!recipients.length && typeof event.organizerCalendarAddress === 'string')
        lines.push(`ATTENDEE:${uri(event.organizerCalendarAddress)}`)
    }
    const acknowledged = string(alert.acknowledged)
    if (acknowledged) lines.push(`ACKNOWLEDGED:${utc(acknowledged)}`)
    lines.push('END:VALARM')
  }
  return lines
}
