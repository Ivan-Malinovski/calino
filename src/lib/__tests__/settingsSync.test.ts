import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import {
  serializeSettings,
  deserializeSettings,
  mergeSettings,
  resolveConflict,
  encodeBase64,
  decodeBase64,
  deriveCalendarHomeUrl,
  dtstampToISO,
  SETTINGS_EVENT_UID_PREFIX,
  SETTINGS_CALENDAR_NAME,
  getPrimaryAccountId,
  setPrimaryAccountId,
  getEtag,
  setEtag,
  getLastModified,
  touchLastModified,
  getLastSyncedAt,
  setLastSyncedAt,
  clearSyncKeys,
  isSyncEnabled,
  SYNC_FORMAT_VERSION,
  type SettingsSyncPayload,
} from '../settingsSync'
import { useSettingsStore } from '@/store/settingsStore'

describe('settingsSync', () => {
  const storage = createLocalStorageMock()

  beforeEach(() => {
    storage.install()
    useSettingsStore.getState().resetSettings()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    storage.reset()
  })

  describe('encodeBase64 / decodeBase64', () => {
    it('should round-trip ASCII strings', () => {
      const original = 'Hello, World!'
      expect(decodeBase64(encodeBase64(original))).toBe(original)
    })

    it('should round-trip non-Latin1 characters (CJK)', () => {
      const original = '你好世界'
      expect(decodeBase64(encodeBase64(original))).toBe(original)
    })

    it('should round-trip emoji', () => {
      const original = '📅🕐🌍'
      expect(decodeBase64(encodeBase64(original))).toBe(original)
    })

    it('should handle empty string', () => {
      expect(encodeBase64('')).toBe('')
      expect(decodeBase64('')).toBe('')
    })

    it('should round-trip JSON with non-ASCII values', () => {
      const json = JSON.stringify({ timezone: 'Europe/København', name: 'Мой календарь' })
      expect(decodeBase64(encodeBase64(json))).toBe(json)
    })
  })

  describe('deriveCalendarHomeUrl', () => {
    it('should strip last path segment', () => {
      const result = deriveCalendarHomeUrl(
        'https://example.com/dav.php',
        'https://example.com/dav.php/calendars/user/personal/'
      )
      expect(result).toBe('https://example.com/dav.php/calendars/user/')
    })

    it('should handle root calendar', () => {
      const result = deriveCalendarHomeUrl('https://example.com', 'https://example.com/cal/')
      expect(result).toBe('https://example.com/')
    })

    it('should use real server origin', () => {
      const result = deriveCalendarHomeUrl(
        'https://real.example.com',
        'https://proxy.example.com/calendars/user/cal/'
      )
      expect(result).toBe('https://real.example.com/calendars/user/')
    })
  })

  describe('dtstampToISO', () => {
    it('should convert valid DTSTAMP', () => {
      expect(dtstampToISO('20250101T120000Z')).toBe('2025-01-01T12:00:00Z')
    })

    it('should return empty string for empty input', () => {
      expect(dtstampToISO('')).toBe('')
    })

    it('should return empty string for short input', () => {
      expect(dtstampToISO('2025')).toBe('')
    })
  })

  describe('serializeSettings', () => {
    it('should produce valid JSON with version and syncedAt', () => {
      const json = serializeSettings()
      const parsed = JSON.parse(json) as SettingsSyncPayload
      expect(parsed.version).toBe(SYNC_FORMAT_VERSION)
      expect(parsed.syncedAt).toBeDefined()
      expect(parsed.settings).toBeDefined()
    })

    it('should only include syncable fields', () => {
      const parsed = JSON.parse(serializeSettings()) as SettingsSyncPayload
      expect(parsed.settings.timezone).toBeDefined()
      expect(parsed.settings.caldavDebugMode).toBeUndefined()
    })

    it('should reflect current store values', () => {
      useSettingsStore.getState().updateSettings({ timezone: 'Asia/Tokyo', themeMode: 'dark' })
      const parsed = JSON.parse(serializeSettings()) as SettingsSyncPayload
      expect(parsed.settings.timezone).toBe('Asia/Tokyo')
      expect(parsed.settings.themeMode).toBe('dark')
    })
  })

  describe('deserializeSettings', () => {
    it('should parse valid JSON', () => {
      const payload: SettingsSyncPayload = {
        version: SYNC_FORMAT_VERSION,
        syncedAt: '2025-01-01T00:00:00Z',
        settings: { timezone: 'UTC' },
      }
      const result = deserializeSettings(JSON.stringify(payload))
      expect(result).not.toBeNull()
      expect(result?.settings.timezone).toBe('UTC')
    })

    it('should return null for wrong version', () => {
      const payload = { version: 999, syncedAt: '', settings: {} }
      expect(deserializeSettings(JSON.stringify(payload))).toBeNull()
    })

    it('should return null for invalid JSON', () => {
      expect(deserializeSettings('not json')).toBeNull()
    })

    it('should return null for missing settings', () => {
      const payload = { version: SYNC_FORMAT_VERSION, syncedAt: '' }
      expect(deserializeSettings(JSON.stringify(payload))).toBeNull()
    })
  })

  describe('mergeSettings', () => {
    it('should overlay remote syncable fields onto local', () => {
      const local = useSettingsStore.getState()
      const remote = { timezone: 'Pacific/Auckland', themeMode: 'light' as const }
      const merged = mergeSettings(local, remote)
      expect(merged.timezone).toBe('Pacific/Auckland')
      expect(merged.themeMode).toBe('light')
      expect(merged.dateFormat).toBe(local.dateFormat)
    })

    it('should ignore non-syncable remote fields', () => {
      const local = useSettingsStore.getState()
      const remote = { caldavDebugMode: true } as Record<string, unknown>
      const merged = mergeSettings(local, remote as Parameters<typeof mergeSettings>[1])
      expect(merged.caldavDebugMode).toBe(local.caldavDebugMode)
    })
  })

  describe('resolveConflict', () => {
    it('should pick remote when remote is more recent', () => {
      expect(resolveConflict('2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z')).toBe('remote')
    })
    it('should pick local when local is more recent', () => {
      expect(resolveConflict('2025-06-01T00:00:00Z', '2025-01-01T00:00:00Z')).toBe('local')
    })
    it('should return equal when timestamps match', () => {
      expect(resolveConflict('2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')).toBe('equal')
    })
  })

  describe('constants', () => {
    it('should have the settings UID prefix', () => {
      expect(SETTINGS_EVENT_UID_PREFIX).toBe('calino-settings')
    })
    it('should have the calendar internal name', () => {
      expect(SETTINGS_CALENDAR_NAME).toBe('calino-settings')
    })
  })

  describe('localStorage helpers', () => {
    it('should manage primaryAccountId', () => {
      expect(getPrimaryAccountId()).toBeNull()
      setPrimaryAccountId('abc')
      expect(getPrimaryAccountId()).toBe('abc')
      setPrimaryAccountId(null)
      expect(getPrimaryAccountId()).toBeNull()
    })

    it('should manage etag', () => {
      expect(getEtag()).toBeNull()
      setEtag('"xyz"')
      expect(getEtag()).toBe('"xyz"')
      setEtag(null)
      expect(getEtag()).toBeNull()
    })

    it('should store empty string etag (not treat as clear)', () => {
      setEtag('')
      expect(getEtag()).toBe('')
    })

    it('should manage lastModified', () => {
      expect(getLastModified()).toBe(0)
      touchLastModified()
      expect(getLastModified()).toBeGreaterThan(0)
    })

    it('should manage lastSyncedAt', () => {
      expect(getLastSyncedAt()).toBe('')
      setLastSyncedAt('2025-01-01T00:00:00Z')
      expect(getLastSyncedAt()).toBe('2025-01-01T00:00:00Z')
    })

    it('should clear all sync keys including lastSyncedAt', () => {
      setPrimaryAccountId('x')
      setEtag('"y"')
      touchLastModified()
      setLastSyncedAt('2025-01-01T00:00:00Z')
      clearSyncKeys()
      expect(getPrimaryAccountId()).toBeNull()
      expect(getEtag()).toBeNull()
      expect(getLastModified()).toBe(0)
      expect(getLastSyncedAt()).toBe('')
    })

    it('isSyncEnabled should reflect primaryAccountId', () => {
      expect(isSyncEnabled()).toBe(false)
      setPrimaryAccountId('x')
      expect(isSyncEnabled()).toBe(true)
      setPrimaryAccountId(null)
      expect(isSyncEnabled()).toBe(false)
    })
  })
})
