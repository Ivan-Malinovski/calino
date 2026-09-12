/**
 * CalDAV Settings Sync
 *
 * Serializes/deserializes Calino settings for syncing via CalDAV.
 * Settings are stored as a single VEVENT in a dedicated "Calino Settings" calendar.
 */

import { safeLocalStorage } from '@/lib/storage'
import {
  DEFAULT_ADJUSTABLE_THEME,
  normalizeAdjustableTheme,
  useSettingsStore,
} from '@/store/settingsStore'
import { useCalendarStore } from '@/store/calendarStore'
import type { UserSettings } from '@/types'
import type { AutoCategoryRule, Category } from '@/types/categories'

// ─── Version ──────────────────────────────────────────────────────────────────

/** Current sync format version — bumped on breaking schema changes. */
export const SYNC_FORMAT_VERSION = 1

// ─── Settings payload ─────────────────────────────────────────────────────────

/** The JSON payload stored inside the VEVENT ATTACH field. */
export interface SettingsSyncPayload {
  version: number
  syncedAt: string
  settings: Partial<UserSettings>
  /**
   * Category colours and the keyword rules that file events under them. They
   * live in the calendar store, not the settings store, but they are as
   * Calino-only as any setting: the name travels on each event as CATEGORIES,
   * the colour has nowhere else to go. Optional because a payload written by
   * an older build has neither, and that has to mean "leave mine alone".
   */
  categories?: Category[]
  autoCategoryRules?: AutoCategoryRule[]
}

/** The two category lists as they sit in the calendar store. */
export interface SyncedCategories {
  categories: Category[]
  autoCategoryRules: AutoCategoryRule[]
}

// ─── Syncable fields ──────────────────────────────────────────────────────────

/** Explicit allowlist of settings fields that are synced. */
export const SYNCABLE_SETTINGS: (keyof UserSettings)[] = [
  'language',
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
  'adjustableTheme',
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
  const calendarState = useCalendarStore.getState()
  const payload: SettingsSyncPayload = {
    version: SYNC_FORMAT_VERSION,
    syncedAt: new Date().toISOString(),
    settings: syncableSettings,
    categories: calendarState.categories,
    autoCategoryRules: calendarState.autoCategoryRules,
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
  categories?: Category[]
  autoCategoryRules?: AutoCategoryRule[]
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
    return {
      settings: payload.settings,
      syncedAt: payload.syncedAt,
      // Anything that isn't a list is treated as "not sent".
      ...(Array.isArray(payload.categories) ? { categories: payload.categories } : {}),
      ...(Array.isArray(payload.autoCategoryRules)
        ? { autoCategoryRules: payload.autoCategoryRules }
        : {}),
    }
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
        if (key === 'adjustableTheme') {
          merged.adjustableTheme = normalizeAdjustableTheme(
            value,
            localSettings.adjustableTheme ?? DEFAULT_ADJUSTABLE_THEME
          )
          continue
        }
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
  }
  return merged
}

/**
 * Merge remote category lists onto local ones.
 *
 * Categories are keyed by *name*, not id. Every device mints its own id: sync
 * creates an unseen CATEGORIES value as a new category with a fresh UUID and
 * a random colour, so the same "Work" has a different id on every device.
 * Events reference categories by name, so a name-keyed merge is what makes a
 * remote colour land on the right thing. A rule references its category by id,
 * so each remote rule is re-pointed through the name at the local category.
 *
 * The merge is additive on purpose. A remote colour wins for a name both sides
 * have, a name only the remote has is added, and a name only the local side
 * has is kept: a deletion can't travel this way regardless, because the
 * server's events still carry the name and the next calendar sync would put
 * the category straight back. Rules merge by their own id the same way.
 *
 * A remote payload with no lists at all — written by a build that didn't
 * send them — leaves the local lists untouched.
 */
export function mergeCategories(
  local: SyncedCategories,
  remote: Partial<SyncedCategories>
): SyncedCategories {
  if (!remote.categories) return local

  // Returns `local` itself when nothing differs, so callers can skip the
  // store write (and the cache invalidation that comes with it).
  let changed = false
  const categories = local.categories.map((category) => {
    const match = remote.categories!.find((c) => c.name === category.name)
    if (!match || match.color === category.color) return category
    changed = true
    return { ...category, color: match.color }
  })
  const localNames = new Set(local.categories.map((c) => c.name))
  const localIds = new Set(local.categories.map((c) => c.id))
  for (const category of remote.categories) {
    if (localNames.has(category.name) || localIds.has(category.id)) continue
    categories.push(category)
    localNames.add(category.name)
    localIds.add(category.id)
    changed = true
  }

  let autoCategoryRules = local.autoCategoryRules
  if (remote.autoCategoryRules) {
    // Remote rule → remote category → its name → the merged category's id.
    const remoteNameById = new Map(remote.categories.map((c) => [c.id, c.name]))
    const mergedIdByName = new Map(categories.map((c) => [c.name, c.id]))
    const remapped: AutoCategoryRule[] = []
    for (const rule of remote.autoCategoryRules) {
      const name = remoteNameById.get(rule.categoryId)
      const categoryId = name ? mergedIdByName.get(name) : undefined
      if (categoryId) remapped.push({ ...rule, categoryId })
    }
    const remoteRuleIds = new Set(remapped.map((r) => r.id))
    const kept = local.autoCategoryRules.filter((r) => !remoteRuleIds.has(r.id))
    const next = [...kept, ...remapped]
    if (JSON.stringify(next) !== JSON.stringify(local.autoCategoryRules)) {
      autoCategoryRules = next
      changed = true
    }
  }

  return changed ? { categories, autoCategoryRules } : local
}

/**
 * Apply a remote payload that has won conflict resolution: settings onto the
 * settings store, categories onto the calendar store. The three places that
 * pull settings — the hook, the account-add discovery and the post-sync
 * pull in `useCalDAV` — all go through here so they can't drift.
 */
export function applyRemotePayload(remote: {
  settings: Partial<UserSettings>
  categories?: Category[]
  autoCategoryRules?: AutoCategoryRule[]
}): void {
  const settingsStore = useSettingsStore.getState()
  settingsStore.updateSettings(mergeSettings(settingsStore, remote.settings))

  const calendarStore = useCalendarStore.getState()
  const local: SyncedCategories = {
    categories: calendarStore.categories,
    autoCategoryRules: calendarStore.autoCategoryRules,
  }
  const merged = mergeCategories(local, remote)
  if (merged !== local) {
    calendarStore.applySyncedCategories(merged.categories, merged.autoCategoryRules)
  }
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
