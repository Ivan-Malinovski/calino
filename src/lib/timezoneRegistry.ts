import ICAL from 'ical.js'
// The package's own getVtimezoneComponent reads zone files with fs.readFileSync
// (Node-only) and cannot run in the browser. Vite collects same-origin raw zone
// assets below; only zones requested through the registration path are parsed
// into ICAL.Timezone instances.
//
import zoneIndex from '@touch4it/ical-timezones/zones.js'

// Raw zone texts keyed by Vite's glob path (absolute); matched by suffix.
// Synchronous recurrence expansion and export paths need a zone to be
// available immediately. Keep the raw corpus in the module chunk, while
// deferring the more expensive ICAL.Timezone parsing until a zone is used.
const zoneTextLoaders = import.meta.glob(
  '../../node_modules/@touch4it/ical-timezones/zones/**/*.ics',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
) as Record<string, string>

const zoneLoadersByFilename = new Map<string, () => Promise<string>>()
const zoneTextByFilename = new Map<string, string>()
for (const [key, loader] of Object.entries(zoneTextLoaders)) {
  const marker = key.lastIndexOf('zones/')
  if (marker !== -1) {
    const filename = key.slice(marker + 'zones/'.length)
    zoneTextByFilename.set(filename, loader)
    zoneLoadersByFilename.set(filename, () => Promise.resolve(loader))
  }
}

const zoneTextCache = new Map<string, string | undefined>()
const zoneTextPromises = new Map<string, Promise<string | undefined>>()

function zoneTextLoader(filename: string): (() => Promise<string>) | undefined {
  return zoneLoadersByFilename.get(filename)
}

async function zoneText(filename: string): Promise<string | undefined> {
  if (zoneTextCache.has(filename)) return zoneTextCache.get(filename)

  const existing = zoneTextPromises.get(filename)
  if (existing) return existing

  const loader = zoneTextLoader(filename)
  if (!loader) {
    zoneTextCache.set(filename, undefined)
    return undefined
  }

  const promise = loader()
    .then((text) => {
      zoneTextCache.set(filename, text)
      return text
    })
    .catch(() => {
      zoneTextCache.set(filename, undefined)
      return undefined
    })
  zoneTextPromises.set(filename, promise)
  return promise
}

function registerZoneText(resolved: string, text: string): boolean {
  // A source VTIMEZONE may have been registered between the caller's initial
  // service check and this parse. Never replace that authoritative definition
  // with packaged data.
  if (ICAL.TimezoneService.has(resolved)) return true
  try {
    const comp = new ICAL.Component(ICAL.parse(text) as unknown as string[])
    const vtimezone = comp.name === 'vcalendar' ? comp.getFirstSubcomponent('vtimezone') : comp
    if (!vtimezone) return false
    ICAL.TimezoneService.register(new ICAL.Timezone(vtimezone), resolved)
    return true
  } catch {
    return false
  }
}

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
  UTC: 'UTC',
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

/**
 * ical.js TimezoneService starts with no zones at all; seed Z/UTC/GMT once.
 *
 * Never call TimezoneService.reset() here: the CalDAV adapter registers the
 * VTIMEZONEs carried by the parsed ICS into this same service before the
 * first lazy prime, and reset() would wipe those source-registered zones.
 * Custom/vendor TZIDs absent from the @touch4it package would then lose
 * their definition and fall back to device-local behaviour. Seeding is
 * idempotent per alias, so an already-populated service is left untouched.
 */
function primeService(): void {
  if (
    primed &&
    ICAL.TimezoneService.has('UTC') &&
    ICAL.TimezoneService.has('Z') &&
    ICAL.TimezoneService.has('GMT')
  ) {
    return
  }
  const utc = ICAL.Timezone.utcTimezone
  if (!ICAL.TimezoneService.has('UTC')) ICAL.TimezoneService.register(utc, 'UTC')
  if (!ICAL.TimezoneService.has('Z')) ICAL.TimezoneService.register(utc, 'Z')
  if (!ICAL.TimezoneService.has('GMT')) ICAL.TimezoneService.register(utc, 'GMT')
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
 * Synchronous and browser-safe for zones already registered in
 * TimezoneService. Zones packaged by @touch4it/ical-timezones are loaded by
 * `ensureZoneRegisteredAsync`; a synchronous call cannot wait for a browser
 * module asset and therefore returns false until that async path has loaded
 * the zone.
 *
 * Lookup order is deliberate: the service is consulted (after a
 * non-destructive prime) before the package, so zones the CalDAV adapter
 * registered from a parsed ICS — including custom/vendor TZIDs absent from
 * the @touch4it package — are found without a package round-trip.
 */
export function ensureZoneRegistered(tzid: string): boolean {
  primeService()
  const resolved = normalizeTzid(tzid)
  if (ICAL.TimezoneService.has(resolved)) return true
  if (resolved === 'UTC') return true
  const filename = (zoneIndex as Record<string, string>)[resolved]
  const text = filename ? zoneTextCache.get(filename) ?? zoneTextByFilename.get(filename) : undefined
  if (text) return registerZoneText(resolved, text)
  return false
}

/**
 * Load and register a packaged timezone, if one exists. Source-provided
 * VTIMEZONE components always win: the service is checked both before and
 * after the asynchronous asset load, so a server-provided definition cannot
 * be replaced by the package's IANA definition while the load is in flight.
 */
export async function ensureZoneRegisteredAsync(tzid: string): Promise<boolean> {
  primeService()
  const resolved = normalizeTzid(tzid)
  if (ICAL.TimezoneService.has(resolved) || resolved === 'UTC') return true

  const filename = (zoneIndex as Record<string, string>)[resolved]
  const text = filename ? await zoneText(filename) : undefined
  if (!text) return false

  // A source VTIMEZONE may have been registered while the zone asset loaded.
  if (ICAL.TimezoneService.has(resolved)) return true

  return registerZoneText(resolved, text)
}

/**
 * Best-effort preload for a group of referenced TZIDs. Unknown or unavailable
 * zones resolve to false and retain ical.js's normal floating/device-local
 * fallback; one failed zone never prevents other zones from loading.
 */
export async function preloadTimezones(
  tzids: Iterable<string>
): Promise<ReadonlyMap<string, boolean>> {
  const unique = [...new Set([...tzids].map((tzid) => tzid.trim()).filter(Boolean))]
  const results = await Promise.all(
    unique.map(async (tzid) => [tzid, await ensureZoneRegisteredAsync(tzid)] as const)
  )
  return new Map(results)
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
