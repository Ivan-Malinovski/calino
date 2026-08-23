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
  AdjustableThemeSettings,
  AdjustableFontFamily,
} from '@/types'
import { getBrowserLanguage } from '@/lib/languages'
import { config, DEFAULT_CALENDAR_COLOR, EVENT_COLORS as _EVENT_COLORS_FROM_CONFIG } from '@/config'
import { ALL_VIEWS, DEFAULT_DIVIDER_AFTER } from '@/features/calendar/viewRoutes'

export const selectThemeMode = (state: SettingsStore) => state.themeMode
export const selectUpdateSettings = (state: SettingsStore) => state.updateSettings

/**
 * Seeds `timezone`, which nothing reads: Calino renders every date and time in
 * the device's own zone. The Settings picker that used to expose this was
 * removed — it claimed to control display and controlled nothing — but the
 * field stays in state and in SYNCABLE_SETTINGS so a value written by another
 * client round-trips through sync instead of being dropped on the floor.
 */
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

export const DEFAULT_ADJUSTABLE_THEME: AdjustableThemeSettings = {
  light: {
    canvas: '#f7f4ee',
    panel: '#fffdfa',
    accent: '#9a6b43',
    accentContrast: '#ffffff',
    text: '#2c2823',
    mutedText: '#70695f',
    border: '#e4ded4',
    fontFamily: 'system',
    cornerRadius: 10,
    density: 100,
    shadowStrength: 70,
    eventTint: 10,
  },
  dark: {
    canvas: '#17181b',
    panel: '#22252a',
    accent: '#87a7ff',
    accentContrast: '#16181d',
    text: '#eef1f5',
    mutedText: '#a7afba',
    border: '#3b414b',
    fontFamily: 'system',
    cornerRadius: 10,
    density: 100,
    shadowStrength: 60,
    eventTint: 18,
  },
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback
}

function safeRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function safeFontFamily(value: unknown, fallback: AdjustableFontFamily): AdjustableFontFamily {
  return value === 'system' || value === 'serif' || value === 'mono' ? value : fallback
}

/** Normalize partial or malformed adjustable theme data at a state boundary. */
export function normalizeAdjustableTheme(
  value: unknown,
  fallback: AdjustableThemeSettings = DEFAULT_ADJUSTABLE_THEME
): AdjustableThemeSettings {
  const source = isRecord(value) ? value : {}
  const normalizeProfile = (
    candidate: unknown,
    defaults: AdjustableThemeSettings['light']
  ): AdjustableThemeSettings['light'] => {
    const profile = isRecord(candidate) ? candidate : {}
    return {
      canvas: safeColor(profile.canvas, defaults.canvas),
      panel: safeColor(profile.panel, defaults.panel),
      accent: safeColor(profile.accent, defaults.accent),
      accentContrast: safeColor(profile.accentContrast, defaults.accentContrast),
      text: safeColor(profile.text, defaults.text),
      mutedText: safeColor(profile.mutedText, defaults.mutedText),
      border: safeColor(profile.border, defaults.border),
      fontFamily: safeFontFamily(profile.fontFamily, defaults.fontFamily),
      cornerRadius: safeRange(profile.cornerRadius, defaults.cornerRadius, 0, 24),
      density: safeRange(profile.density, defaults.density, 80, 120),
      shadowStrength: safeRange(profile.shadowStrength, defaults.shadowStrength, 0, 100),
      eventTint: safeRange(profile.eventTint, defaults.eventTint, 4, 30),
    }
  }

  return {
    light: normalizeProfile(source.light, fallback.light),
    dark: normalizeProfile(source.dark, fallback.dark),
  }
}

const DEFAULT_SETTINGS: UserSettings = {
  language: getBrowserLanguage(),
  timezone: getBrowserTimezone(),
  secondaryTimezoneEnabled: false,
  secondaryTimezone: null,
  secondaryTimezoneLabel: null,
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
  // Off by default: it needs a runtime calendar permission, so it has to be a
  // deliberate opt-in rather than something a user discovers via a prompt.
  enableCalendarMirror: false,
  enableSoundAlerts: false,
  enableHaptics: false,
  conflictResolution: 'server-wins',
  compactRecurringEvents: true,
  compressPastWeeks: true,
  // 0 = Auto: the day cell's height decides. See `useMonthEventCapacity`.
  monthViewEventLimit: 0,
  hasCompletedOnboarding: false,
  themeMode: 'auto' as ThemeMode,
  lightTheme: config.defaultLightTheme,
  darkTheme: config.defaultDarkTheme,
  // Matches the look Calino has always shipped; see issue #31 for the
  // stronger options and why they move --event-ink-* with them.
  eventTint: 'subtle',
  mochaAccent: '#89b4fa',
  caldavDebugMode: false,
  adjustableTheme: DEFAULT_ADJUSTABLE_THEME,
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
  fadePastDaysInAgenda: 'never',
  viewOrder: ALL_VIEWS.map((v) => v.value),
  // Divider defaults to the boundary between the calendar views and the
  // tools, which is what the groups encode.
  viewDividerAfter: DEFAULT_DIVIDER_AFTER,
  taskCollapseOverrides: {},
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      updateSettings: (updates: Partial<UserSettings>): void => {
        set((state) => {
          if (updates.adjustableTheme === undefined) return updates
          return {
            ...updates,
            adjustableTheme: normalizeAdjustableTheme(
              updates.adjustableTheme,
              state.adjustableTheme
            ),
          }
        })
      },

      resetSettings: (): void => {
        set(DEFAULT_SETTINGS)
      },
    }),
    {
      name: 'calino-settings',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 4,
      // Blind spread: any key the persisted state carries wins, including
      // ones from a newer version after a downgrade. That is safe for
      // viewOrder specifically because it is reconciled against ALL_VIEWS on
      // every read rather than trusted as-is.
      migrate: (persistedState: unknown) => {
        const persisted = (persistedState ?? {}) as Partial<UserSettings>
        const adjustableTheme = persisted.adjustableTheme
        return {
          ...DEFAULT_SETTINGS,
          ...persisted,
          adjustableTheme: normalizeAdjustableTheme(adjustableTheme),
        }
      },
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

/**
 * Options for the per-event reminder chips. No "None" here — removing the last
 * chip is how an event ends up with no reminder.
 */
export const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
]

/**
 * Options for the "Default Reminder" setting, which seeds the new-event form.
 * "None" means a new event starts with no reminder at all.
 */
export const DEFAULT_REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'None' },
  ...REMINDER_OPTIONS,
]

export const CONFLICT_OPTIONS: { value: 'server-wins' | 'local-wins' | 'ask'; label: string }[] = [
  { value: 'server-wins', label: 'Server wins (default)' },
  { value: 'local-wins', label: 'Local wins' },
  { value: 'ask', label: 'Ask me' },
]

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
