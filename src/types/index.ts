export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  interval: number
  endDate?: string
  count?: number
  byWeekday?: number[]
  byMonthDay?: number[]
  byMonth?: number[]
}

export interface Reminder {
  id: string
  minutesBefore: number
  method: 'popup' | 'email'
}

export type EventType = 'event' | 'task'
export type TaskPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface CalendarEvent {
  id: string
  calendarId: string
  title: string
  description?: string
  location?: string
  start: string
  end: string
  isAllDay: boolean
  color?: string
  recurrence?: RecurrenceRule
  reminders?: Reminder[]
  rruleString?: string
  travelDuration?: number
  type?: EventType
  dueDate?: string
  completed?: boolean
  priority?: TaskPriority
  percentComplete?: number
}

export interface Calendar {
  id: string
  name: string
  color: string
  isVisible: boolean
  isDefault: boolean
}

export type ViewType = 'month' | 'week' | 'day' | 'agenda'

export interface CalendarState {
  events: CalendarEvent[]
  calendars: Calendar[]
  currentDate: string
  currentView: ViewType
  selectedEventId: string | null
  isModalOpen: boolean
  selectedDate: string | null
  selectedEndDate: string | null
  isOverlayOpen: boolean
  selectedEventType: EventType
  showAddCalendar: boolean
}

export interface CalendarActions {
  addEvent: (event: CalendarEvent) => void
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void
  deleteEvent: (id: string) => void
  duplicateEvent: (id: string) => string | null
  addCalendar: (calendar: Calendar) => void
  updateCalendar: (id: string, updates: Partial<Calendar>) => void
  deleteCalendar: (id: string) => void
  toggleCalendarVisibility: (id: string) => void
  setDefaultCalendar: (id: string) => void
  setCurrentDate: (date: string) => void
  setCurrentView: (view: ViewType) => void
  setSelectedEventId: (id: string | null) => void
  openModal: (date?: string, endDate?: string, eventId?: string, mode?: EventType) => void
  closeModal: () => void
  setOverlayOpen: (isOpen: boolean) => void
  setShowAddCalendar: (show: boolean) => void
  getEventsForDateRange: (start: string, end: string) => CalendarEvent[]
  getVisibleEvents: () => CalendarEvent[]
}

export type CalendarStore = CalendarState & CalendarActions

export type DateFormat = 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd'
export type TimeFormat = '12h' | '24h'
export type FirstDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type EventDensity = 'comfortable' | 'compact'
export type DefaultDuration = 15 | 30 | 60 | 90 | 120
export type ThemeMode = 'light' | 'dark' | 'auto'

export interface UserSettings {
  timezone: string
  dateFormat: DateFormat
  timeFormat: TimeFormat
  firstDayOfWeek: FirstDayOfWeek
  defaultDuration: DefaultDuration
  defaultView: ViewType
  showWeekNumbers: boolean
  eventDensity: EventDensity
  defaultReminderMinutes: number
  defaultEventColor: string
  enableDesktopNotifications: boolean
  enableSoundAlerts: boolean
  syncEnabled: boolean
  syncIntervalMinutes: number
  conflictResolution: 'server-wins' | 'local-wins' | 'ask'
  compactRecurringEvents: boolean
  hasCompletedOnboarding: boolean
  themeMode: ThemeMode
  lightTheme: string
  darkTheme: string
}

export type SettingsState = UserSettings

export interface SettingsActions {
  updateSettings: (updates: Partial<UserSettings>) => void
  resetSettings: () => void
}

export type SettingsStore = SettingsState & SettingsActions
