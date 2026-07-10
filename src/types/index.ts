export type RecurrenceFrequency = 'secondly' | 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly'

import type { Category, AutoCategoryRule } from './categories'

export type AttendeePartstat = 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS-ACTION' | 'DELEGATED'

export interface CalendarAttendee {
  email: string
  name?: string
  role?: string
  partstat?: AttendeePartstat
  rsvp?: boolean
}

export interface CalendarOrganizer {
  email: string
  name?: string
}

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  interval: number
  endDate?: string
  count?: number
  byWeekday?: number[]
  byMonthDay?: number[]
  byMonth?: number[]
  bySetPos?: number[]
  // R2.1 — RRULE UNTIL form for all-day events. The caller must set this
  // from the event's isAllDay flag before serializing.
  isAllDay?: boolean
  // R2.4 — Per-BYDAY ordinals (parallel to byWeekday). e.g. for
  // "BYDAY=2MO,-1FR", byWeekday=[1,5] and byDayOrdinals=[2,-1].
  // Distinct from bySetPos, which is the standalone BYSETPOS rule part.
  byDayOrdinals?: number[]
  // R2.4 — Missing RRULE parts per RFC 5545 §3.3.10.
  wkst?: 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
  byHour?: number[]
  byMinute?: number[]
  bySecond?: number[]
  byWeekNo?: number[]
  byYearDay?: number[]
}

export interface Reminder {
  id: string
  minutesBefore: number
  // R2.6 — VALARM ACTION values per RFC 5545 §3.8.6.3.
  method: 'popup' | 'email' | 'audio'
}

export type EventType = 'event' | 'task' | 'journal'
export type CalendarComponent = 'VEVENT' | 'VTODO'
export type SyncStatus = 'synced' | 'pending' | 'failed'
export type TaskPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface CalendarAttachment {
  href: string        // URL or data URI for inline attachments
  contentType: string // MIME type
  size?: number       // bytes
  filename?: string   // display name
}

export interface BrokenEvent {
  event: CalendarEvent
  reason: string
  detectedAt: string
}

export interface DuplicateUidResource {
  title: string
  start: string
  href: string
  kept: boolean
}

export interface DuplicateUidIssue {
  uid: string
  calendarId: string
  resources: DuplicateUidResource[]
  detectedAt: string
}

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
  categories?: string[]
  recurrence?: RecurrenceRule
  reminders?: Reminder[]
  rruleString?: string
  travelDuration?: number
  type?: EventType
  dueDate?: string
  completed?: boolean
  parentTaskId?: string
  priority?: TaskPriority
  percentComplete?: number
  transparency?: 'opaque' | 'transparent'
  sequence?: number
  etag?: string
  excludedDates?: string[]
  recurrenceId?: string
  isFragment?: boolean
  isFirstFragment?: boolean
  isLastFragment?: boolean
  /** Month view: shared row across every day a multi-day event spans. */
  laneIndex?: number
  originalStart?: string
  originalEnd?: string
  syncStatus?: SyncStatus
  attachments?: CalendarAttachment[]
  url?: string
  relatedTo?: string[]
  created?: string
  lastModified?: string
  // R2.2 — IANA TZID (e.g. 'America/New_York') when DTSTART/DTEND were
  // originally parsed from a TZID form. Required to round-trip the timezone
  // — without it, on re-serialize the wall-clock is lost to UTC.
  timezone?: string
  // R2.5 — VTODO STATUS per RFC 5545 §3.8.2.3.
  taskStatus?: 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED'
  // R2.5 — VTODO COMPLETED timestamp per RFC 5545 §3.8.2.1 (must be UTC).
  completedAt?: string
}

export interface Calendar {
  id: string
  name: string
  color: string
  isVisible: boolean
  isDefault: boolean
  accountId?: string
  showTasksInViews: boolean
  supportedComponents?: CalendarComponent[]
}

export type ViewType = 'month' | 'week' | '3day' | 'day' | 'agenda' | 'todo' | 'journal' | 'contacts' | 'year'

export interface CalendarState {
  events: CalendarEvent[]
  brokenEvents: BrokenEvent[]
  duplicateUidIssues: DuplicateUidIssue[]
  calendars: Calendar[]
  categories: Category[]
  autoCategoryRules: AutoCategoryRule[]
  selectedCategoryIds: string[]
  currentDate: string
  currentView: ViewType
  selectedEventId: string | null
  isModalOpen: boolean
  selectedDate: string | null
  selectedEndDate: string | null
  initialTitle: string | null
  initialCalendarId: string | null
  subtaskParentId: string | null
  isOverlayOpen: boolean
  selectedEventType: EventType
  showAddCalendar: boolean
  previewEventId: string | null
  previewPosition: { x: number; y: number } | null
  isJournalModalOpen: boolean
  journalModalDate: string | null
  journalStartInCompose: boolean
  /**
   * Bumped by every store action that affects the result of
   * `getEventsForDateRange` (add/update/delete events, add/update/delete
   * calendars & categories, toggle calendar visibility, change the selected
   * category filter). Used to invalidate the range-expansion cache and as a
   * stable dep in `useMemo` callers that derive per-range structures
   * (WeekView, CalendarGrid). Excluded from persistence.
   */
  rangeExpansionVersion: number
}

export interface CalendarActions {
  addEvent: (event: CalendarEvent) => void
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void
  completeTask: (id: string, completed: boolean) => CalendarEvent[]
  deleteEvent: (id: string) => void
  addBrokenEvent: (event: CalendarEvent, reason: string) => void
  removeBrokenEvent: (eventId: string) => void
  fixBrokenEvent: (eventId: string) => void
  addDuplicateUidIssue: (issue: DuplicateUidIssue) => void
  clearDuplicateUidIssues: () => void
  duplicateEvent: (id: string) => string | null
  /**
   * Bump the range-expansion version counter without mutating events.
   * Required after any `setState` call that mutates events/calendars/
   * categories, so the range-expansion cache and per-view memos
   * invalidate. R4.1/R4.3 — primarily for the history store.
   */
  bumpVersion: () => void
  addCalendar: (calendar: Calendar) => void
  updateCalendar: (id: string, updates: Partial<Calendar>) => void
  deleteCalendar: (id: string) => void
  toggleCalendarVisibility: (id: string) => void
  setDefaultCalendar: (id: string) => void
  addCategory: (category: Category) => void
  updateCategory: (id: string, updates: Partial<Category>) => void
  deleteCategory: (id: string) => void
  addAutoCategoryRule: (rule: AutoCategoryRule) => void
  updateAutoCategoryRule: (id: string, updates: Partial<AutoCategoryRule>) => void
  deleteAutoCategoryRule: (id: string) => void
  toggleCategoryFilter: (categoryId: string) => void
  setCurrentDate: (date: string) => void
  setCurrentView: (view: ViewType) => void
  setSelectedEventId: (id: string | null) => void
  openModal: (
    date?: string,
    endDate?: string,
    eventId?: string,
    mode?: EventType,
    initialTitle?: string,
    parentTaskId?: string,
    initialCalendarId?: string,
  ) => void
  closeModal: () => void
  setOverlayOpen: (isOpen: boolean) => void
  setShowAddCalendar: (show: boolean) => void
  openPreview: (eventId: string, position: { x: number; y: number }) => void
  closePreview: () => void
  openJournalModal: (date: string, startInCompose?: boolean) => void
  closeJournalModal: () => void
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
  conflictResolution: 'server-wins' | 'local-wins' | 'ask'
  compactRecurringEvents: boolean
  compressPastWeeks: boolean
  monthViewEventLimit: number
  hasCompletedOnboarding: boolean
  themeMode: ThemeMode
  lightTheme: string
  darkTheme: string
  caldavDebugMode: boolean
  hideCompletedTasksInMonthView: boolean
  useCategoryColors: boolean
  showEventIcons: boolean
  sidebarWidth: number
  sidebarCollapsed: boolean
  journalEnabled: boolean
  contactsEnabled: boolean
  taskDueDateReminders: boolean
  overdueTaskBadge: boolean
  agendaSidebarOpen: boolean
  agendaSidebarWidth: number
}

export type SettingsState = UserSettings

export interface SettingsActions {
  updateSettings: (updates: Partial<UserSettings>) => void
  resetSettings: () => void
}

export type SettingsStore = SettingsState & SettingsActions
