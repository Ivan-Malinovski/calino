import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '../settingsStore'

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings()
  })

  it('has default settings', () => {
    const settings = useSettingsStore.getState()

    expect(settings.timezone).toBeDefined()
    expect(settings.dateFormat).toBe('dd/MM/yyyy')
    expect(settings.timeFormat).toBe('24h')
    expect(settings.firstDayOfWeek).toBe(1)
    expect(settings.defaultDuration).toBe(60)
    expect(settings.defaultView).toBe('month')
    expect(settings.showWeekNumbers).toBe(true)
    expect(settings.eventDensity).toBe('comfortable')
    expect(settings.defaultReminderMinutes).toBe(15)
    expect(settings.defaultEventColor).toBe('#4285F4')
    expect(settings.enableDesktopNotifications).toBe(true)
    expect(settings.enableSoundAlerts).toBe(false)
    expect(settings.syncEnabled).toBe(true)
    expect(settings.syncIntervalMinutes).toBe(15)
    expect(settings.conflictResolution).toBe('server-wins')
  })

  it('updates settings with updateSettings', () => {
    const store = useSettingsStore.getState()

    store.updateSettings({
      timeFormat: '24h',
      firstDayOfWeek: 1,
      defaultView: 'week',
    })

    const settings = useSettingsStore.getState()
    expect(settings.timeFormat).toBe('24h')
    expect(settings.firstDayOfWeek).toBe(1)
    expect(settings.defaultView).toBe('week')
  })

  it('updateSettings only changes provided fields', () => {
    const store = useSettingsStore.getState()

    store.updateSettings({ timeFormat: '24h' })

    const settings = useSettingsStore.getState()
    expect(settings.timeFormat).toBe('24h')
    expect(settings.dateFormat).toBe('dd/MM/yyyy')
    expect(settings.firstDayOfWeek).toBe(1)
  })

  it('resetSettings restores default values', () => {
    const store = useSettingsStore.getState()

    store.updateSettings({
      timeFormat: '24h',
      firstDayOfWeek: 1,
      defaultView: 'agenda',
      showWeekNumbers: true,
    })

    store.resetSettings()

    const settings = useSettingsStore.getState()
    expect(settings.timeFormat).toBe('24h')
    expect(settings.firstDayOfWeek).toBe(1)
    expect(settings.defaultView).toBe('month')
    expect(settings.showWeekNumbers).toBe(true)
  })

  it('handles all date format options', () => {
    const store = useSettingsStore.getState()

    const formats = ['MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'] as const
    formats.forEach((format) => {
      store.updateSettings({ dateFormat: format })
      expect(useSettingsStore.getState().dateFormat).toBe(format)
    })
  })

  it('handles all time format options', () => {
    const store = useSettingsStore.getState()

    store.updateSettings({ timeFormat: '24h' })
    expect(useSettingsStore.getState().timeFormat).toBe('24h')

    store.updateSettings({ timeFormat: '12h' })
    expect(useSettingsStore.getState().timeFormat).toBe('12h')
  })

  it('handles all first day of week options', () => {
    const store = useSettingsStore.getState()

    for (let day = 0; day <= 6; day++) {
      store.updateSettings({ firstDayOfWeek: day as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
      expect(useSettingsStore.getState().firstDayOfWeek).toBe(day)
    }
  })

  it('handles all view options', () => {
    const store = useSettingsStore.getState()

    const views = ['month', 'week', 'day', 'agenda'] as const
    views.forEach((view) => {
      store.updateSettings({ defaultView: view })
      expect(useSettingsStore.getState().defaultView).toBe(view)
    })
  })

  it('handles all event density options', () => {
    const store = useSettingsStore.getState()

    store.updateSettings({ eventDensity: 'compact' })
    expect(useSettingsStore.getState().eventDensity).toBe('compact')

    store.updateSettings({ eventDensity: 'comfortable' })
    expect(useSettingsStore.getState().eventDensity).toBe('comfortable')
  })

  it('handles all conflict resolution options', () => {
    const store = useSettingsStore.getState()

    store.updateSettings({ conflictResolution: 'local-wins' })
    expect(useSettingsStore.getState().conflictResolution).toBe('local-wins')

    store.updateSettings({ conflictResolution: 'server-wins' })
    expect(useSettingsStore.getState().conflictResolution).toBe('server-wins')

    store.updateSettings({ conflictResolution: 'ask' })
    expect(useSettingsStore.getState().conflictResolution).toBe('ask')
  })

  it('handles boolean toggle options', () => {
    const store = useSettingsStore.getState()

    store.updateSettings({ enableDesktopNotifications: false })
    expect(useSettingsStore.getState().enableDesktopNotifications).toBe(false)

    store.updateSettings({ enableDesktopNotifications: true })
    expect(useSettingsStore.getState().enableDesktopNotifications).toBe(true)

    store.updateSettings({ enableSoundAlerts: true })
    expect(useSettingsStore.getState().enableSoundAlerts).toBe(true)

    store.updateSettings({ showWeekNumbers: true })
    expect(useSettingsStore.getState().showWeekNumbers).toBe(true)
  })

  it('handles numeric duration options', () => {
    const store = useSettingsStore.getState()

    const durations = [15, 30, 60, 90, 120] as const
    durations.forEach((duration) => {
      store.updateSettings({ defaultDuration: duration })
      expect(useSettingsStore.getState().defaultDuration).toBe(duration)
    })
  })

  it('handles sync interval options', () => {
    const store = useSettingsStore.getState()

    const intervals = [5, 15, 30, 60] as const
    intervals.forEach((interval) => {
      store.updateSettings({ syncIntervalMinutes: interval })
      expect(useSettingsStore.getState().syncIntervalMinutes).toBe(interval)
    })
  })

  it('handles reminder options', () => {
    const store = useSettingsStore.getState()

    const reminders = [0, 5, 15, 30, 60, 1440] as const
    reminders.forEach((reminder) => {
      store.updateSettings({ defaultReminderMinutes: reminder })
      expect(useSettingsStore.getState().defaultReminderMinutes).toBe(reminder)
    })
  })
})
