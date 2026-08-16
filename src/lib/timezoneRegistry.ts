import ICAL from 'ical.js'
import { getVtimezoneComponent } from '@touch4it/ical-timezones'

/**
 * Phase 2 (C0) - timezone data for ical.js.
 *
 * ical.js ships no IANA tzdata and its ICAL.TimezoneService starts
 * completely empty (not even UTC until the first get/reset). Without a
 * real zone, a TZID resolves to "floating": recurrence expansion keeps a
 * fixed UTC instant instead of the series wall clock (the Phase 2 DST-
 * drift bug) and serialization cannot emit a VTIMEZONE.
 *
 * This module lazily registers real zones (tzurl data bundled with
 * @touch4it/ical-timezones) into the global TimezoneService on first
 * use, and resolves Windows/legacy TZIDs that ical.js and date-fns-tz
 * cannot understand to their IANA equivalents. Registration is lazy and
 * cached so startup cost is zero for calendars carrying no TZIDs, and
 * unit tests exercise it through the expansion/serialization paths.
 */

/** Windows zone IDs to IANA. Covers the IDs a Windows/Outlook-produced
 * ICS is likely to carry; the tzurl data also knows legacy Olson names. */
const WINDOWS_TZID_ALIASES: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Marquesas Standard Time': 'Pacific/Marquesas',
  'Alaskan Standard Time': 'America/Anchorage',
  'UTC-09': 'Etc/GMT+9',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'UTC-08': 'Etc/GMT+8',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Mountain Standard Time (Mexico)': 'America/Chihuahua',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Paraguay Standard Time': 'America/Asuncion',
  'Atlantic Standard Time': 'America/Halifax',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Tocantins Standard Time': 'America/Araguaina',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'Greenland Standard Time': 'America/Godthab',
  'Montevideo Standard Time': 'America/Montevideo',
  'Bahia Standard Time': 'America/Bahia',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Namibia Standard Time': 'Africa/Windhoek',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Syria Standard Time': 'Asia/Damascus',
  'West Bank Standard Time': 'Asia/Hebron',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Sudan Standard Time': 'Africa/Khartoum',
  'Libya Standard Time': 'Africa/Tripoli',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Calcutta',
  'Nepal Standard Time': 'Asia/Katmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Omsk Standard Time': 'Asia/Omsk',
  'Myanmar Standard Time': 'Asia/Rangoon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Altai Standard Time': 'Asia/Barnaul',
  'W. Mongolia Standard Time': 'Asia/Hovd',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Aus Central W. Standard Time': 'Australia/Eucla',
  'Transbaikal Standard Time': 'Asia/Chita',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'North Korea Standard Time': 'Asia/Pyongyang',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Lord Howe Standard Time': 'Australia/Lord_Howe',
  'Bougainville Standard Time': 'Pacific/Bougainville',
  'Russia Time Zone 10': 'Asia/Srednekolymsk',
  'Magadan Standard Time': 'Asia/Magadan',
  'Norfolk Standard Time': 'Pacific/Norfolk',
  'Sakhalin Standard Time': 'Asia/Sakhalin',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Russia Time Zone 11': 'Asia/Kamchatka',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC+12': 'Etc/GMT-12',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'UTC+13': 'Etc/GMT-13',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati',
}

let primed = false

/** ical.js TimezoneService starts with no zones at all; prime Z/UTC/GMT once. */
function primeService(): void {
  if (primed) return
  ICAL.TimezoneService.reset()
  primed = true
}

/**
 * Map a TZID to its IANA equivalent. Windows IDs (Outlook/Exchange), bare
 * UTC/GMT/Z, and already-IANA IDs pass through unchanged when known.
 */
export function normalizeTzid(tzid: string): string {
  const trimmed = tzid.trim()
  if (!trimmed) return trimmed
  if (trimmed === 'Z' || trimmed.toLowerCase() === 'utc' || trimmed.toLowerCase() === 'gmt') {
    return 'UTC'
  }
  const exact = WINDOWS_TZID_ALIASES[trimmed]
  if (exact) return exact
  const lower = trimmed.toLowerCase()
  for (const [win, iana] of Object.entries(WINDOWS_TZID_ALIASES)) {
    if (win.toLowerCase() === lower) return iana
  }
  return trimmed
}

/**
 * Register a real timezone for tzid (after alias normalisation) into
 * ICAL.TimezoneService, so ICAL.RecurExpansion can expand a series in its
 * own zone and ICAL.helpers.updateTimezones can emit a VTIMEZONE.
 *
 * Synchronous: the tzurl data ships inside the package (one file per zone).
 * Returns true when the zone is available (registered just now or before).
 */
export function ensureZoneRegistered(tzid: string): boolean {
  primeService()
  const resolved = normalizeTzid(tzid)
  if (ICAL.TimezoneService.has(resolved)) return true
  try {
    const text = getVtimezoneComponent(resolved)
    if (!text) return false
    const comp = new ICAL.Component(ICAL.parse(text) as unknown as string[])
    // The generator returns a bare VTIMEZONE; tolerate a VCALENDAR wrapper.
    const vtimezone = comp.name === 'vcalendar' ? comp.getFirstSubcomponent('vtimezone') : comp
    if (!vtimezone) return false
    ICAL.TimezoneService.register(new ICAL.Timezone(vtimezone), resolved)
    return true
  } catch {
    return false
  }
}

/**
 * The registered ICAL.Timezone for a TZID, or undefined when the zone is
 * unknown or its data cannot be generated. undefined means callers fall
 * back to today's floating/device-local behaviour rather than crashing.
 */
export function resolveZone(tzid: string): ICAL.Timezone | undefined {
  if (!tzid) return undefined
  if (!ensureZoneRegistered(tzid)) return undefined
  return ICAL.TimezoneService.get(normalizeTzid(tzid))
}