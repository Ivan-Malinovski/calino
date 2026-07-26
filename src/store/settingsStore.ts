import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '@/lib/storage'
import type {
  SettingsStore,
  UserSettings,
  DateFormat,
  TimeFormat,
  FirstDayOfWeek,
  EventDensity,
  DefaultDuration,
  ViewType,
  ThemeMode,
  MapProvider,
} from '@/types'
import { config, DEFAULT_CALENDAR_COLOR, EVENT_COLORS as _EVENT_COLORS_FROM_CONFIG } from '@/config'

export const selectThemeMode = (state: SettingsStore) => state.themeMode
export const selectUpdateSettings = (state: SettingsStore) => state.updateSettings

function getBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) return tz
  } catch {
    // Fallback to default
  }
  return 'Europe/Berlin'
}

function getEuropeDefaultFirstDay(): FirstDayOfWeek {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    const region = locale.split('-')[1]
    const europeanRegions = [
      'GB',
      'DE',
      'FR',
      'IT',
      'ES',
      'NL',
      'BE',
      'SE',
      'NO',
      'DK',
      'FI',
      'AT',
      'CH',
      'PL',
      'PT',
      'CZ',
      'HU',
      'IE',
      'IS',
    ]
    if (region && europeanRegions.includes(region)) {
      return 1
    }
  } catch {
    // Fallback to Monday
  }
  return 1
}

function generateTimezoneOptions(): { value: string; label: string }[] {
  try {
    const timezones = Intl.supportedValuesOf('timeZone')
    const options: { value: string; label: string }[] = []

    for (const tz of timezones) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'shortOffset',
        })
        const parts = formatter.formatToParts(new Date())
        const offsetPart = parts.find((p) => p.type === 'timeZoneName')
        const offset = offsetPart?.value || ''

        const city = tz.split('/').pop()?.replace(/_/g, ' ') || tz
        const label = offset ? `${city} (${offset})` : city
        options.push({ value: tz, label })
      } catch {
        options.push({ value: tz, label: tz })
      }
    }

    return options.sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    return [
      { value: 'UTC', label: 'UTC' },
      { value: 'Europe/London', label: 'London (GMT+0/GMT+1)' },
      { value: 'Europe/Paris', label: 'Paris (GMT+1/GMT+2)' },
      { value: 'Europe/Berlin', label: 'Berlin (GMT+1/GMT+2)' },
      { value: 'Europe/Copenhagen', label: 'Copenhagen (GMT+1/GMT+2)' },
      { value: 'America/New_York', label: 'New York (GMT-5/GMT-4)' },
      { value: 'America/Los_Angeles', label: 'Los Angeles (GMT-8/GMT-7)' },
    ]
  }
}

const DEFAULT_SETTINGS: UserSettings = {
  timezone: getBrowserTimezone(),
  dateFormat: 'dd/MM/yyyy',
  timeFormat: '24h',
  firstDayOfWeek: getEuropeDefaultFirstDay(),
  defaultDuration: 60,
  defaultView: config.defaultView,
  showWeekNumbers: true,
  showWeekNumbersInSidebar: false,
  eventDensity: 'comfortable',
  mapProvider: 'google',
  defaultReminderMinutes: 15,
  defaultEventColor: DEFAULT_CALENDAR_COLOR,
  enableDesktopNotifications: true,
  enableSoundAlerts: false,
  enableHaptics: false,
  conflictResolution: 'server-wins',
  compactRecurringEvents: true,
  compressPastWeeks: true,
  monthViewEventLimit: 3,
  hasCompletedOnboarding: false,
  themeMode: 'auto' as ThemeMode,
  lightTheme: config.defaultLightTheme,
  darkTheme: config.defaultDarkTheme,
  mochaAccent: '#89b4fa',
  caldavDebugMode: false,
  hideCompletedTasksInMonthView: true,
  useCategoryColors: true,
  showEventIcons: true,
  sidebarWidth: 300,
  sidebarCollapsed: false,
  journalEnabled: false,
  contactsEnabled: false,
  taskDueDateReminders: true,
  overdueTaskBadge: false,
  agendaSidebarOpen: false,
  agendaSidebarWidth: 340,
  agendaBelowMonthEnabled: true,
  monthAgendaGridRatio: 0.4,
  monthAgendaSplitRatio: 0.65,
  fadePastDaysInAgenda: false,
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      updateSettings: (updates: Partial<UserSettings>): void => {
        set(updates)
      },

      resetSettings: (): void => {
        set(DEFAULT_SETTINGS)
      },
    }),
    {
      name: 'calino-settings',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 1,
      migrate: (persistedState: unknown) => ({
        ...DEFAULT_SETTINGS,
        ...(persistedState as Partial<UserSettings>),
      }),
    }
  )
)

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: 'MM/dd/yyyy', label: 'MM/DD/YYYY (12/31/2024)' },
  { value: 'dd/MM/yyyy', label: 'DD/MM/YYYY (31/12/2024)' },
  { value: 'yyyy-MM-dd', label: 'YYYY-MM-DD (2024-12-31)' },
]

export const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string }[] = [
  { value: '12h', label: '12-hour (2:30 PM)' },
  { value: '24h', label: '24-hour (14:30)' },
]

export const FIRST_DAY_OPTIONS: { value: FirstDayOfWeek; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

export const DENSITY_OPTIONS: { value: EventDensity; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

export const DURATION_OPTIONS: { value: DefaultDuration; label: string }[] = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
]

export const VIEW_OPTIONS: { value: ViewType; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'todo', label: 'Tasks' },
]

export const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
]

export const CONFLICT_OPTIONS: { value: 'server-wins' | 'local-wins' | 'ask'; label: string }[] = [
  { value: 'server-wins', label: 'Server wins (default)' },
  { value: 'local-wins', label: 'Local wins' },
  { value: 'ask', label: 'Ask me' },
]

let _timezoneOptions: { value: string; label: string }[] | null = null
export function getTimezoneOptions(): { value: string; label: string }[] {
  if (!_timezoneOptions) {
    _timezoneOptions = generateTimezoneOptions()
  }
  return _timezoneOptions
}

export const TIMEZONE_OPTIONS = getTimezoneOptions()

// Re-export from config for backward compatibility.
export const EVENT_COLORS = _EVENT_COLORS_FROM_CONFIG

export const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'System' },
]

export const MAP_PROVIDER_OPTIONS: { value: MapProvider; label: string }[] = [
  { value: 'google', label: 'Google Maps' },
  { value: 'apple', label: 'Apple Maps' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'mapy', label: 'mapy.com' },
  { value: 'geo', label: 'Device default (geo:)' },
]
