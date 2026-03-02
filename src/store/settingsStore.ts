import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  SettingsStore,
  UserSettings,
  DateFormat,
  TimeFormat,
  FirstDayOfWeek,
  EventDensity,
  DefaultDuration,
  ViewType,
} from '@/types'

const DEFAULT_SETTINGS: UserSettings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
  dateFormat: 'dd/MM/yyyy',
  timeFormat: '24h',
  firstDayOfWeek: 1,
  defaultDuration: 60,
  defaultView: 'month',
  showWeekNumbers: false,
  eventDensity: 'comfortable',
  defaultReminderMinutes: 15,
  defaultEventColor: '#4285F4',
  enableDesktopNotifications: true,
  enableSoundAlerts: false,
  syncEnabled: true,
  syncIntervalMinutes: 15,
  conflictResolution: 'server-wins',
  compactRecurringEvents: false,
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      updateSettings: (updates: Partial<UserSettings>): void => {
        set((state) => ({ ...state, ...updates }))
      },

      resetSettings: (): void => {
        set(DEFAULT_SETTINGS)
      },
    }),
    {
      name: 'goodcal-settings',
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
]

export const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
]

export const SYNC_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
]

export const CONFLICT_OPTIONS: { value: 'server-wins' | 'local-wins' | 'ask'; label: string }[] = [
  { value: 'server-wins', label: 'Server wins (default)' },
  { value: 'local-wins', label: 'Local wins' },
  { value: 'ask', label: 'Ask me' },
]

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris, Berlin, Rome' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'Mumbai, New Delhi' },
  { value: 'Asia/Bangkok', label: 'Bangkok, Jakarta' },
  { value: 'Asia/Singapore', label: 'Singapore, Hong Kong' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney, Melbourne' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
  { value: 'UTC', label: 'UTC' },
]

export const EVENT_COLORS = [
  '#4285F4',
  '#EA4335',
  '#FBBC05',
  '#34A853',
  '#9334E6',
  '#FF6D01',
  '#46BDC6',
  '#7B1FA2',
  '#C2185B',
  '#00796B',
]
