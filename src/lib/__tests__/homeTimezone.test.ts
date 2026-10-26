import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import { useSettingsStore } from '@/store/settingsStore'
import { parseISO } from 'date-fns'
import { deviceTimezone, toEventInstant } from '@/lib/datetime'
import { homeTimezone, movedDueValue, storedDayKey } from '@/lib/homeTimezone'

describe('homeTimezone', () => {
  const storage = createLocalStorageMock()

  beforeEach(() => {
    storage.install()
    localStorage.clear()
    useSettingsStore.getState().resetSettings()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    storage.reset()
  })

  it('follows the browser when the setting is empty', () => {
    expect(homeTimezone()).toBe(deviceTimezone())
  })

  it('returns the chosen zone', () => {
    useSettingsStore.getState().updateSettings({ homeTimezone: 'Europe/London' })
    expect(homeTimezone()).toBe('Europe/London')
  })

  it('falls back to the browser for a synced zone that is not valid', () => {
    useSettingsStore.getState().updateSettings({ homeTimezone: 'Mars/Olympus_Mons' })
    expect(homeTimezone()).toBe(deviceTimezone())
    expect(storedDayKey('2026-10-25T15:00:00.000Z')).toBe(
      storedDayKey('2026-10-25T15:00:00.000Z', deviceTimezone())
    )
  })

  it('reads a floating string in the home zone, and as the browser when unset', () => {
    expect(toEventInstant('2026-10-25T09:00:00').getTime()).toBe(
      parseISO('2026-10-25T09:00:00').getTime()
    )
    useSettingsStore.getState().updateSettings({ homeTimezone: 'Pacific/Auckland' })
    // 09:00 NZDT (UTC+13) on 2026-10-25.
    expect(toEventInstant('2026-10-25T09:00:00').toISOString()).toBe('2026-10-24T20:00:00.000Z')
    expect(toEventInstant('2026-10-25T09:00:00.000Z').toISOString()).toBe(
      '2026-10-25T09:00:00.000Z'
    )
  })

  it('files a floating due on the date in the string and a Z due on the home day', () => {
    useSettingsStore.getState().updateSettings({ homeTimezone: 'Pacific/Auckland' })
    expect(storedDayKey('2026-10-25T15:00:00')).toBe('2026-10-25')
    expect(storedDayKey('2026-10-25T15:00:00.000Z')).toBe('2026-10-26')
    expect(storedDayKey('2026-10-25T23:30:00', 'America/New_York')).toBe('2026-10-25')
    expect(storedDayKey('2026-10-25T00:00:00.000Z', undefined, true)).toBe('2026-10-25')
    // Issue #126: a TZID task is filed in its own zone, whatever shape its due takes.
    expect(storedDayKey('2026-10-26T03:30:00.000Z', 'America/New_York')).toBe('2026-10-25')
  })

  it('preserves due shape when a task moves', () => {
    useSettingsStore.getState().updateSettings({ homeTimezone: 'Pacific/Auckland' })
    expect(movedDueValue('2026-10-25T15:00:00', undefined, '2026-10-26', '20:00:00')).toBe(
      '2026-10-26T20:00:00'
    )
    expect(movedDueValue('2026-10-25T08:00:00.000Z', undefined, '2026-10-26', '20:00:00')).toBe(
      '2026-10-26T07:00:00.000Z'
    )
    expect(
      movedDueValue('2026-10-25T15:00:00', 'America/New_York', '2026-10-26', '20:00:00')
    ).toBe('2026-10-26T03:00:00')
  })
})
