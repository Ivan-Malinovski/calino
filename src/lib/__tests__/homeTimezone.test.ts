import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import { useSettingsStore } from '@/store/settingsStore'
import { deviceTimezone } from '@/lib/datetime'
import { homeTimezone } from '@/lib/homeTimezone'

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
})
