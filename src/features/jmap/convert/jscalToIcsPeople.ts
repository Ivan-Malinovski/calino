import type { JsonObject } from '../types'
import { entries, keys, object, parameter, string, uri } from './jscalToIcsValues'

export function address(participant: JsonObject): string | undefined {
  const explicit =
    string(participant.calendarAddress) ??
    string(object(participant.sendTo).imip) ??
    string(object(participant.sendTo).other)
  const email = string(participant.email)
  return explicit ?? (email ? (email.startsWith('mailto:') ? email : `mailto:${email}`) : undefined)
}

export function people(event: JsonObject): string[] {
  const participants = entries(event.participants).map(([id, value]) => ({
    id,
    data: object(value),
  }))
  const owner = participants.find((p) => object(p.data.roles).owner === true && address(p.data))
  const organizerAddress =
    string(event.organizerCalendarAddress) ??
    string(object(event.replyTo).imip) ??
    string(object(event.replyTo).other) ??
    (owner ? address(owner.data) : undefined)
  const organizer = participants.find((p) => address(p.data) === organizerAddress)
  const lines: string[] = []
  if (organizerAddress) {
    const name = string(organizer?.data.name)
    lines.push(`ORGANIZER${name ? `;CN=${parameter(name)}` : ''}:${uri(organizerAddress)}`)
  }
  for (const { data: p } of participants) {
    const calAddress = address(p)
    if (!calAddress) continue
    const roles = object(p.roles)
    if (
      roles.owner === true &&
      !['attendee', 'required', 'optional', 'chair', 'informational'].some(
        (role) => roles[role] === true
      )
    )
      continue
    const params: string[] = []
    const name = string(p.name)
    if (name) params.push(`CN=${parameter(name)}`)
    const role =
      roles.chair === true
        ? 'CHAIR'
        : roles.optional === true
          ? 'OPT-PARTICIPANT'
          : roles.informational === true && roles.attendee !== true && roles.required !== true
            ? 'NON-PARTICIPANT'
            : 'REQ-PARTICIPANT'
    params.push(`ROLE=${role}`)
    const status = string(p.participationStatus)?.toUpperCase()
    if (
      status &&
      [
        'NEEDS-ACTION',
        'ACCEPTED',
        'DECLINED',
        'TENTATIVE',
        'DELEGATED',
        'COMPLETED',
        'IN-PROCESS',
      ].includes(status)
    )
      params.push(`PARTSTAT=${status}`)
    if (typeof p.expectReply === 'boolean') params.push(`RSVP=${p.expectReply ? 'TRUE' : 'FALSE'}`)
    const kind = string(p.kind)
    const cutype = kind === 'location' ? 'ROOM' : kind?.toUpperCase()
    if (cutype && ['INDIVIDUAL', 'GROUP', 'RESOURCE', 'ROOM', 'UNKNOWN'].includes(cutype))
      params.push(`CUTYPE=${cutype}`)
    for (const [field, param] of [
      ['delegatedTo', 'DELEGATED-TO'],
      ['delegatedFrom', 'DELEGATED-FROM'],
    ]) {
      // RFC 8984 keys a map by participant id; Stalwart sends the calendar
      // address itself, either as a plain string or as the key of a map.
      const raw = p[field]
      const refs = typeof raw === 'string' ? [raw] : keys(raw)
      const delegates = refs.flatMap((ref) => {
        const target = participants.find((other) => other.id === ref)
        const value = target
          ? address(target.data)
          : /^[a-z][a-z0-9+.-]*:|@/i.test(ref)
            ? ref
            : undefined
        if (!value) return []
        const calAddress = value.includes(':') ? value : `mailto:${value}`
        return [`"${uri(calAddress).replace(/"/g, '%22')}"`]
      })
      if (delegates.length) params.push(`${param}=${delegates.join(',')}`)
    }
    if (typeof p.scheduleSequence === 'number')
      params.push(`SCHEDULE-SEQUENCE=${p.scheduleSequence}`)
    lines.push(`ATTENDEE;${params.join(';')}:${uri(calAddress)}`)
  }
  return lines
}
