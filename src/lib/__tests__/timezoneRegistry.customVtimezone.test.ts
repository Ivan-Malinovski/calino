import { describe, it, expect, beforeEach } from 'vitest'
import ICAL from 'ical.js'
import { ensureZoneRegistered, resolveZone } from '../timezoneRegistry'

/**
 * Regression test for the verified bug: iCalendarAdapter.parseICALEvent
 * registers the VTIMEZONEs carried by a parsed ICS into
 * ICAL.TimezoneService, but the first lazy call to
 * ensureZoneRegistered/resolveZone primed the service with
 * TimezoneService.reset() — wiping those source-registered zones. Custom /
 * vendor TZIDs absent from the @touch4it package (e.g. 'Custom/Office')
 * then lost their definition and fell back to device-local behaviour.
 *
 * These tests register a custom VTIMEZONE the exact way the adapter does
 * (new ICAL.Timezone(vtz); ICAL.TimezoneService.register(tz)) and assert
 * the source zone survives the prime and its DST rules still apply.
 */

/** EU-style rules: +0100 CET in winter, +0200 CEST in summer (last Sunday
 * of March / October), matching the verified repro. Wrapped in a VCALENDAR
 * like a real ICS file, so the VTIMEZONE shows up as a subcomponent the
 * way iCalendarAdapter.parseICALEvent finds it. */
function customVtimezoneIcs(tzid: string): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calino test//EN
BEGIN:VTIMEZONE
TZID:${tzid}
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE
END:VCALENDAR`
}

/** Parse the ICS and register its VTIMEZONE the way
 * iCalendarAdapter.parseICALEvent does (lines 29-37). Returns the
 * registered ICAL.Timezone so identity can be asserted. */
function registerSourceVtimezone(tzid: string): ICAL.Timezone {
  const comp = new ICAL.Component(ICAL.parse(customVtimezoneIcs(tzid)) as unknown as string[])
  const vtz = comp.getFirstSubcomponent('vtimezone')
  expect(vtz).toBeDefined()
  const tz = new ICAL.Timezone(vtz)
  ICAL.TimezoneService.register(tz)
  return tz
}

/** UTC hour of a wall-clock time interpreted in the given zone. Zone-
 * agnostic: reads the UTC instant, so the assertion holds in either
 * vitest project (west/east). */
function utcHourOf(
  zone: ICAL.Timezone,
  ymd: { year: number; month: number; day: number; hour: number }
): number {
  const wall = ICAL.Time.fromData({
    year: ymd.year,
    month: ymd.month,
    day: ymd.day,
    hour: ymd.hour,
    minute: 0,
    second: 0,
    zone: zone as never,
  })
  return new Date(wall.toJSDate().toISOString()).getUTCHours()
}

describe('timezoneRegistry: source-registered custom VTIMEZONE survives', () => {
  beforeEach(() => {
    // Isolate the singleton between tests. The module-level prime flag
    // survives (priming is idempotent and non-destructive after the fix),
    // so the first test below still exercises the real first-prime path.
    ICAL.TimezoneService.reset()
  })

  it('keeps a source-registered custom zone across the first lazy prime', () => {
    const tz = registerSourceVtimezone('Custom/Office')

    // First ensureZoneRegistered in this file triggers primeService; with
    // the bug it called TimezoneService.reset() and wiped the source zone.
    expect(ensureZoneRegistered('Custom/Office')).toBe(true)
    expect(ICAL.TimezoneService.has('Custom/Office')).toBe(true)
    // The very instance the adapter registered is still in the service.
    expect(ICAL.TimezoneService.get('Custom/Office')).toBe(tz)

    const zone = resolveZone('Custom/Office')
    expect(zone).toBeDefined()
    expect(zone!.tzid).toBe('Custom/Office')
  })

  it('the custom zone DST rules survive: wall 10:00 is 08:00Z in July and 09:00Z in December', () => {
    registerSourceVtimezone('Custom/Office')
    const zone = resolveZone('Custom/Office')
    expect(zone).toBeDefined()
    // July: CEST +0200; December: CET +0100 (2026 EU transitions).
    expect(utcHourOf(zone!, { year: 2026, month: 7, day: 1, hour: 10 })).toBe(8)
    expect(utcHourOf(zone!, { year: 2026, month: 12, day: 1, hour: 10 })).toBe(9)
  })

  it('finds a custom zone registered after the service was already primed', () => {
    // Force the lazy prime first (non-destructive).
    expect(ensureZoneRegistered('UTC')).toBe(true)
    // A later sync registers another source zone; it must be resolvable.
    registerSourceVtimezone('Custom/Office.Late')
    expect(ICAL.TimezoneService.has('Custom/Office.Late')).toBe(true)
    const zone = resolveZone('Custom/Office.Late')
    expect(zone).toBeDefined()
    expect(zone!.tzid).toBe('Custom/Office.Late')
  })

  it('IANA zones still register from the package and resolve (no regression)', () => {
    expect(ensureZoneRegistered('Europe/Copenhagen')).toBe(true)
    const zone = resolveZone('Europe/Copenhagen')
    expect(zone).toBeDefined()
    expect(zone!.tzid).toBe('Europe/Copenhagen')
    // Package data still carries the DST rule.
    expect(utcHourOf(zone!, { year: 2026, month: 7, day: 1, hour: 10 })).toBe(8)
  })
})
