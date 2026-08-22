/**
 * CalDAV Settings Sync
 *
 * Serializes/deserializes Calino settings for syncing via CalDAV.
 * Settings are stored as a single VEVENT in a dedicated "Calino Settings" calendar.
 */

import { safeLocalStorage } from '@/lib/storage'
import { useSettingsStore } from '@/store/settingsStore'
import type { UserSettings } from '@/types'

// ─── Version ──────────────────────────────────────────────────────────────────

/** Current sync format version — bumped on breaking schema changes. */
export const SYNC_FORMAT_VERSION = 1

// ─── Settings payload ─────────────────────────────────────────────────────────

/** The JSON payload stored inside the VEVENT ATTACH field. */
export interface SettingsSyncPayload {
  version: number
  syncedAt: string
  settings: Partial<UserSettings>
}

// ─── Syncable fields ──────────────────────────────────────────────────────────

/** Explicit allowlist of settings fields that are synced. */
export const SYNCABLE_SETTINGS: (keyof UserSettings)[] = [
  'timezone',
  'secondaryTimezoneEnabled',
  'secondaryTimezone',
  'secondaryTimezoneLabel',
  'dateFormat',
  'timeFormat',
  'firstDayOfWeek',
  'defaultDuration',
  'defaultView',
  'showWeekNumbers',
  'showWeekNumbersInSidebar',
  'eventDensity',
  'defaultReminderMinutes',
  'defaultEventColor',
  'enableDesktopNotifications',
  'enableSoundAlerts',
  'compactRecurringEvents',
  'compressPastWeeks',
  'monthViewEventLimit',
  'themeMode',
  'lightTheme',
  'darkTheme',
  'hideCompletedTasksInMonthView',
  'useCategoryColors',
  'journalEnabled',
  'taskCollapseOverrides',
]

// ─── Serialization ────────────────────────────────────────────────────────────

/** Encode a UTF-8 string to base64 (safe for non-Latin1 characters). */
export function encodeBase64(utf8: string): string {
  const bytes = new TextEncoder().encode(utf8)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/** Decode a base64 string to UTF-8. */
export function decodeBase64(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Serialize the current syncable settings to a JSON string wrapped in a
 * SettingsSyncPayload.
 */
export function serializeSettings(): string {
  const state = useSettingsStore.getState()
  const syncableSettings: Partial<UserSettings> = {}
  for (const key of SYNCABLE_SETTINGS) {
    if (key in state) {
      ;(syncableSettings as Record<string, unknown>)[key] = state[key]
    }
  }
  const payload: SettingsSyncPayload = {
    version: SYNC_FORMAT_VERSION,
    syncedAt: new Date().toISOString(),
    settings: syncableSettings,
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Deserialize a JSON string into a settings payload.
 * Returns null when the JSON is invalid or the version is unknown.
 */
export function deserializeSettings(json: string): {
  settings: Partial<UserSettings>
  syncedAt: string
} | null {
  try {
    const payload = JSON.parse(json) as SettingsSyncPayload
    if (payload.version !== SYNC_FORMAT_VERSION) {
      console.warn(`[SettingsSync] Unknown sync format version: ${payload.version}`)
      return null
    }
    if (!payload.settings || typeof payload.settings !== 'object') {
      console.warn('[SettingsSync] Invalid settings payload')
      return null
    }
    return { settings: payload.settings, syncedAt: payload.syncedAt }
  } catch (error) {
    console.warn('[SettingsSync] Failed to parse settings JSON:', error)
    return null
  }
}

/**
 * Merge remote settings onto local settings.
 * Only syncable fields from `remoteSettings` are applied.
 */
export function mergeSettings(
  localSettings: UserSettings,
  remoteSettings: Partial<UserSettings>
): UserSettings {
  const merged = { ...localSettings }
  for (const key of SYNCABLE_SETTINGS) {
    if (key in remoteSettings) {
      const value = remoteSettings[key]
      if (value !== undefined) {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
  }
  return merged
}

// ─── Conflict resolution helpers ──────────────────────────────────────────────

/**
 * Compare two timestamps and return the more recent one.
 * Returns 'local', 'remote', or 'equal'.
 */
export function resolveConflict(
  localModified: string,
  remoteDtstamp: string
): 'local' | 'remote' | 'equal' {
  const localTime = new Date(localModified).getTime()
  const remoteTime = new Date(remoteDtstamp).getTime()
  if (localTime > remoteTime) return 'local'
  if (remoteTime > localTime) return 'remote'
  return 'equal'
}

// ─── CalDAV constants ─────────────────────────────────────────────────────────

/**
 * UID prefix used to identify Calino internal sync records so they can be
 * filtered out of any parsed event list before they reach the UI. The
 * current settings VEVENT uses the literal UID `calino-settings`; this
 * prefix matches that and any future per-instance variant.
 */
export const SETTINGS_EVENT_UID_PREFIX = 'calino-settings'

/** Internal name of the dedicated settings calendar collection. */
export const SETTINGS_CALENDAR_NAME = 'calino-settings'

/** Display name shown in CalDAV clients (if they ever see it). */
export const SETTINGS_CALENDAR_DISPLAY_NAME = 'Calino Settings'

/**
 * WebDAV dead-property used to identify the settings calendar during PROPFIND.
 * The value "1" marks the collection as belonging to Calino settings sync.
 */
export const SETTINGS_CALENDAR_DEAD_PROP = 'X-CALINO-SETTINGS-CALENDAR'

/** File name used when creating the VEVENT object. */
export const SETTINGS_EVENT_FILENAME = 'calino-settings.ics'

// ─── localStorage keys ────────────────────────────────────────────────────────

/** Account ID of the primary CalDAV account used for settings sync. */
export const STORAGE_KEY_PRIMARY_ACCOUNT_ID = 'calino.settingsSync.primaryAccountId'

/** ETag of the last-synced settings VEVENT. */
export const STORAGE_KEY_ETAG = 'calino.settingsSync.etag'

/** Local timestamp (ms) of the last local settings write. */
export const STORAGE_KEY_LAST_MODIFIED = 'calino.settingsSync.lastModified'

/** Timestamp of the last successful sync (ISO string). */
export const STORAGE_KEY_LAST_SYNCED_AT = 'calino.settingsSync.lastSyncedAt'

// ─── localStorage helpers ─────────────────────────────────────────────────────

/** Get the primary account ID (null when sync is off). */
export function getPrimaryAccountId(): string | null {
  return safeLocalStorage.getItem(STORAGE_KEY_PRIMARY_ACCOUNT_ID)
}

/** Set the primary account ID. */
export function setPrimaryAccountId(id: string | null): void {
  if (id !== null) {
    safeLocalStorage.setItem(STORAGE_KEY_PRIMARY_ACCOUNT_ID, id)
  } else {
    safeLocalStorage.removeItem(STORAGE_KEY_PRIMARY_ACCOUNT_ID)
  }
}

/** Get the stored ETag. */
export function getEtag(): string | null {
  return safeLocalStorage.getItem(STORAGE_KEY_ETAG)
}

/** Store the ETag. */
export function setEtag(etag: string | null): void {
  if (etag !== null) {
    safeLocalStorage.setItem(STORAGE_KEY_ETAG, etag)
  } else {
    safeLocalStorage.removeItem(STORAGE_KEY_ETAG)
  }
}

/** Get the last-local-modified timestamp (ms). */
export function getLastModified(): number {
  const raw = safeLocalStorage.getItem(STORAGE_KEY_LAST_MODIFIED)
  return raw ? Number(raw) : 0
}

/** Update the last-local-modified timestamp to now. */
export function touchLastModified(): void {
  safeLocalStorage.setItem(STORAGE_KEY_LAST_MODIFIED, String(Date.now()))
}

/** Clear all sync-related localStorage keys. */
export function clearSyncKeys(): void {
  safeLocalStorage.removeItem(STORAGE_KEY_PRIMARY_ACCOUNT_ID)
  safeLocalStorage.removeItem(STORAGE_KEY_ETAG)
  safeLocalStorage.removeItem(STORAGE_KEY_LAST_MODIFIED)
  safeLocalStorage.removeItem(STORAGE_KEY_LAST_SYNCED_AT)
}

/** Convenience: is sync currently active? */
export function isSyncEnabled(): boolean {
  return getPrimaryAccountId() !== null
}

/** Get the timestamp of the last successful sync. */
export function getLastSyncedAt(): string {
  return safeLocalStorage.getItem(STORAGE_KEY_LAST_SYNCED_AT) || ''
}

/** Set the timestamp of the last successful sync. */
export function setLastSyncedAt(iso: string): void {
  safeLocalStorage.setItem(STORAGE_KEY_LAST_SYNCED_AT, iso)
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Derive the calendar home URL from a stored calendar URL.
 * Strips the last path segment (calendar name) to get the home path.
 */
export function deriveCalendarHomeUrl(serverUrl: string, calendarUrl: string): string {
  const storedCalUrl = new URL(calendarUrl)
  const realServerUrl = new URL(serverUrl)
  const pathParts = storedCalUrl.pathname.split('/').filter(Boolean)
  if (pathParts.length <= 1) {
    // Calendar is at the root or one level deep — use server origin as home
    return realServerUrl.origin + '/'
  }
  pathParts.pop() // remove calendar name → calendar home
  const homePath = '/' + pathParts.join('/') + '/'
  return realServerUrl.origin + homePath
}

/**
 * Convert an iCalendar DTSTAMP (YYYYMMDDTHHMMSSZ) to ISO 8601.
 * Returns empty string for invalid input.
 */
export function dtstampToISO(dtstamp: string): string {
  if (!dtstamp || dtstamp.length < 15) return ''
  return `${dtstamp.slice(0, 4)}-${dtstamp.slice(4, 6)}-${dtstamp.slice(6, 8)}T${dtstamp.slice(9, 11)}:${dtstamp.slice(11, 13)}:${dtstamp.slice(13, 15)}Z`
}
