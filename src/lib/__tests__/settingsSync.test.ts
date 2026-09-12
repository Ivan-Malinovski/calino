import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import {
  serializeSettings,
  deserializeSettings,
  mergeSettings,
  mergeCategories,
  applyRemotePayload,
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
import { useCalendarStore } from '@/store/calendarStore'

describe('settingsSync', () => {
  const storage = createLocalStorageMock()

  beforeEach(() => {
    storage.install()
    useSettingsStore.getState().resetSettings()
    useCalendarStore.setState({ categories: [], autoCategoryRules: [] })
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

    it('should include task collapse overrides', () => {
      useSettingsStore.getState().updateSettings({ taskCollapseOverrides: { parent: true } })
      const parsed = JSON.parse(serializeSettings()) as SettingsSyncPayload
      expect(parsed.settings.taskCollapseOverrides).toEqual({ parent: true })
    })

    it('should include category colours and auto-category rules', () => {
      useCalendarStore.setState({
        categories: [{ id: 'c1', name: 'Work', color: '#ff0000' }],
        autoCategoryRules: [{ id: 'r1', keywords: ['standup'], categoryId: 'c1' }],
      })
      const parsed = JSON.parse(serializeSettings()) as SettingsSyncPayload
      expect(parsed.categories).toEqual([{ id: 'c1', name: 'Work', color: '#ff0000' }])
      expect(parsed.autoCategoryRules).toEqual([
        { id: 'r1', keywords: ['standup'], categoryId: 'c1' },
      ])
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

    it('should leave the category lists out when the payload has none', () => {
      // A payload from a build that predates category sync.
      const payload = { version: SYNC_FORMAT_VERSION, syncedAt: '', settings: {} }
      const result = deserializeSettings(JSON.stringify(payload))
      expect(result?.categories).toBeUndefined()
      expect(result?.autoCategoryRules).toBeUndefined()
    })
  })

  describe('mergeCategories', () => {
    const local = {
      categories: [
        { id: 'local-work', name: 'Work', color: '#111111' },
        { id: 'local-home', name: 'Home', color: '#222222' },
      ],
      autoCategoryRules: [{ id: 'rule-home', keywords: ['chores'], categoryId: 'local-home' }],
    }

    it('should return the local lists untouched when the remote sent none', () => {
      expect(mergeCategories(local, {})).toBe(local)
    })

    it('should return the local lists untouched when the remote matches them', () => {
      const remote = {
        categories: [{ id: 'other-device', name: 'Work', color: '#111111' }],
        autoCategoryRules: [{ id: 'rule-home', keywords: ['chores'], categoryId: 'no-home-here' }],
      }
      // The remote rule can't be resolved, so it drops out and the local one stays.
      expect(mergeCategories(local, remote)).toBe(local)
    })

    it('should take the remote colour for a name both sides have, keeping the local id', () => {
      const merged = mergeCategories(local, {
        categories: [{ id: 'remote-work', name: 'Work', color: '#ff0000' }],
      })
      expect(merged.categories).toEqual([
        { id: 'local-work', name: 'Work', color: '#ff0000' },
        { id: 'local-home', name: 'Home', color: '#222222' },
      ])
    })

    it('should add a category only the remote has and keep one only the local has', () => {
      const merged = mergeCategories(local, {
        categories: [{ id: 'remote-gym', name: 'Gym', color: '#00ff00' }],
      })
      expect(merged.categories.map((c) => c.name)).toEqual(['Work', 'Home', 'Gym'])
      expect(merged.categories[2].id).toBe('remote-gym')
    })

    it('should re-point remote rules at the local category of the same name', () => {
      const merged = mergeCategories(local, {
        categories: [{ id: 'remote-work', name: 'Work', color: '#111111' }],
        autoCategoryRules: [{ id: 'rule-work', keywords: ['standup'], categoryId: 'remote-work' }],
      })
      expect(merged.autoCategoryRules).toEqual([
        { id: 'rule-home', keywords: ['chores'], categoryId: 'local-home' },
        { id: 'rule-work', keywords: ['standup'], categoryId: 'local-work' },
      ])
    })

    it('should replace a local rule with the remote copy of the same id and drop unresolvable ones', () => {
      const merged = mergeCategories(local, {
        categories: [{ id: 'remote-home', name: 'Home', color: '#222222' }],
        autoCategoryRules: [
          { id: 'rule-home', keywords: ['chores', 'laundry'], categoryId: 'remote-home' },
          { id: 'rule-orphan', keywords: ['?'], categoryId: 'no-such-category' },
        ],
      })
      expect(merged.autoCategoryRules).toEqual([
        { id: 'rule-home', keywords: ['chores', 'laundry'], categoryId: 'local-home' },
      ])
    })
  })

  describe('applyRemotePayload', () => {
    it('should write settings and categories to their stores', () => {
      useCalendarStore.setState({
        categories: [{ id: 'local-work', name: 'Work', color: '#111111' }],
        autoCategoryRules: [],
      })
      applyRemotePayload({
        settings: { timezone: 'Pacific/Auckland' },
        categories: [{ id: 'remote-work', name: 'Work', color: '#ff0000' }],
        autoCategoryRules: [{ id: 'r1', keywords: ['standup'], categoryId: 'remote-work' }],
      })
      expect(useSettingsStore.getState().timezone).toBe('Pacific/Auckland')
      const { categories, autoCategoryRules } = useCalendarStore.getState()
      expect(categories).toEqual([{ id: 'local-work', name: 'Work', color: '#ff0000' }])
      expect(autoCategoryRules).toEqual([
        { id: 'r1', keywords: ['standup'], categoryId: 'local-work' },
      ])
    })

    it('should leave the calendar store alone when the payload has no categories', () => {
      const before = useCalendarStore.getState().categories
      applyRemotePayload({ settings: { timezone: 'Pacific/Auckland' } })
      expect(useCalendarStore.getState().categories).toBe(before)
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

    it('deep-merges and normalizes partial adjustable profiles', () => {
      const local = useSettingsStore.getState()
      const merged = mergeSettings(local, {
        adjustableTheme: { dark: { accent: '#123456', density: 999 } },
      } as Parameters<typeof mergeSettings>[1])

      expect(merged.adjustableTheme.dark.accent).toBe('#123456')
      expect(merged.adjustableTheme.dark.density).toBe(120)
      expect(merged.adjustableTheme.dark.panel).toBe(local.adjustableTheme.dark.panel)
      expect(merged.adjustableTheme.light).toEqual(local.adjustableTheme.light)
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
