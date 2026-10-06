import ICAL from 'ical.js'

const aliases: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
}

function ianaZone(name: string): string | undefined {
  const mapped = aliases[name] ?? name
  try {
    new Intl.DateTimeFormat('en', { timeZone: mapped }).format(0)
    return mapped
  } catch {
    const suffix = name.match(
      /(?:^|\/)((?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/.+)$/
    )?.[1]
    if (suffix && suffix !== name) return ianaZone(suffix)
    return undefined
  }
}

export function localTime(time: ICAL.Time): string {
  return time.isDate ? time.toString() + 'T00:00:00' : time.toString().replace(/Z$/, '')
}

function civilSeconds(time: ICAL.Time): number {
  const date = new Date(0)
  date.setUTCFullYear(time.year, time.month - 1, time.day)
  date.setUTCHours(time.hour, time.minute, time.second, 0)
  return date.getTime() / 1000
}

function zoneOffset(seconds: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(seconds * 1000)
  const get = (name: string) => Number(parts.find((part) => part.type === name)?.value)
  const wall = new Date(0)
  wall.setUTCFullYear(get('year'), get('month') - 1, get('day'))
  wall.setUTCHours(get('hour'), get('minute'), get('second'), 0)
  return wall.getTime() / 1000 - seconds
}

export interface IcsZoneContext {
  calendar: ICAL.Component
}

function sourceZone(
  time: ICAL.Time,
  property: ICAL.Property | null,
  context: IcsZoneContext
): { name: string | null; fallback: boolean } {
  if (time.isDate) return { name: null, fallback: false }
  if (time.zone === ICAL.Timezone.utcTimezone) return { name: 'UTC', fallback: false }
  const tzid = property?.getFirstParameter('tzid')
  if (!tzid) return { name: null, fallback: false }
  const component = context.calendar
    .getAllSubcomponents('vtimezone')
    .find((zone) => zone.getFirstPropertyValue('tzid') === tzid)
  const location: unknown = component?.getFirstPropertyValue('x-lic-location')
  const name = (typeof location === 'string' && ianaZone(location)) || ianaZone(tzid)
  if (name) return { name, fallback: false }
  if (component && time.zone !== ICAL.Timezone.localTimezone) return { name: 'UTC', fallback: true }
  throw new Error(`Cannot resolve TZID without VTIMEZONE offset data: ${tzid}`)
}

export function epochSeconds(
  time: ICAL.Time,
  property: ICAL.Property | null,
  context: IcsZoneContext
): number {
  const zone = sourceZone(time, property, context)
  const civil = civilSeconds(time)
  if (time.isDate || zone.name === null || time.zone === ICAL.Timezone.utcTimezone) return civil
  if (time.zone !== ICAL.Timezone.localTimezone) return time.toUnixTime()
  let seconds = civil
  for (let i = 0; i < 4; i++) {
    const next = civil - zoneOffset(seconds, zone.name)
    if (next === seconds) break
    seconds = next
  }
  return seconds
}

export function mappedTime(
  time: ICAL.Time,
  property: ICAL.Property | null,
  context: IcsZoneContext
): { local: string; zone: string | null } {
  const zone = sourceZone(time, property, context)
  return {
    local: zone.fallback
      ? new Date(epochSeconds(time, property, context) * 1000).toISOString().slice(0, 19)
      : localTime(time),
    zone: zone.name,
  }
}

/** Convert an instant to the master's local clock (UNTIL, EXDATE, RDATE, recurrence ids). */
export function recurrenceTime(
  time: ICAL.Time,
  property: ICAL.Property | null,
  targetZone: string | null,
  context: IcsZoneContext
): string {
  if (time.isDate || sourceZone(time, property, context).name === null || targetZone === null)
    return localTime(time)
  const seconds = epochSeconds(time, property, context)
  const offset = targetZone === 'UTC' ? 0 : zoneOffset(seconds, targetZone)
  return new Date((seconds + offset) * 1000).toISOString().slice(0, 19)
}

export function utcTime(
  time: ICAL.Time,
  property: ICAL.Property | null,
  context: IcsZoneContext
): string {
  return new Date(epochSeconds(time, property, context) * 1000).toISOString().replace('.000Z', 'Z')
}

export function elapsedDuration(seconds: number, allDay = false): string {
  if (seconds < 0) throw new Error('Event end precedes start')
  if (allDay) return `P${seconds / 86400}D`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return `PT${hours ? hours + 'H' : ''}${minutes ? minutes + 'M' : ''}${rest || !seconds ? rest + 'S' : ''}`
}
