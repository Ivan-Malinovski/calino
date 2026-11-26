import { clockPattern, formatInZone, parseWallClock } from '@/lib/datetime'
import { normalizeTzid } from '@/lib/timezoneRegistry'

/**
 * The form's times read on the home clock, for an event in another zone
 * (#281). The fields are wall clocks in the event's zone, so this says what
 * they mean where the user is. Returns null when there is nothing to add.
 */
export function homeZoneTimes(
  formTimezone: string,
  homeTz: string,
  isAllDay: boolean,
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
  timeFormat: '12h' | '24h'
): { zoneLabel: string; times: string } | null {
  if (isAllDay) return null
  const home = normalizeTzid(homeTz)
  const zone = normalizeTzid(formTimezone)
  if (zone === home) return null

  const startInstant = parseWallClock(`${startDate}T${startTime}:00`, zone)
  const endInstant = parseWallClock(`${endDate}T${endTime}:00`, zone)
  if (Number.isNaN(startInstant.getTime()) || Number.isNaN(endInstant.getTime())) return null

  let start: string
  let end: string
  try {
    // Same offset all year (e.g. two names for one zone): nothing to say.
    if (
      formatInZone(startInstant, zone, "yyyy-MM-dd'T'HH:mm") ===
      formatInZone(startInstant, home, "yyyy-MM-dd'T'HH:mm")
    ) {
      return null
    }
    start = formatInZone(startInstant, home, clockPattern(timeFormat))
    end = formatInZone(endInstant, home, clockPattern(timeFormat))
    // A late or early event can sit on a different calendar day at home, so
    // name the day when it differs — otherwise the times alone would mislead.
    const startDay = formatInZone(startInstant, home, 'yyyy-MM-dd')
    if (startDay !== startDate) {
      start = `${formatInZone(startInstant, home, 'MMM d')}, ${start}`
    }
  } catch {
    // Unknown zone: better to show nothing than a wrong time.
    return null
  }

  return {
    // 'Europe/Copenhagen' reads as 'Copenhagen'; the region prefix is noise
    // once the city is there.
    zoneLabel: (home.split('/').pop() ?? home).replace(/_/g, ' '),
    times: `${start}\u2013${end}`,
  }
}
