export type RecurrenceFrequency =
  'secondly' | 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly'

import type { Category, AutoCategoryRule } from './categories'
import type { ExtractedEventFields } from '@/features/aiVision/types'

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
export type CalendarComponent = 'VEVENT' | 'VTODO' | 'VJOURNAL'
export type SyncStatus = 'synced' | 'pending' | 'failed'
export type TaskPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface CalendarAttachment {
  href: string // URL or data URI for inline attachments
  contentType: string // MIME type
  size?: number // bytes
  filename?: string // display name
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
  /** RFC 5545 UID. Detached recurrence instances share this with their master. */
  uid?: string
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
  /** Exact CalDAV object URL used for update/delete; it is not derived from UID. */
  resourceHref?: string
  excludedDates?: string[]
  recurrenceId?: string
  /** Local master identity for a detached recurrence occurrence. */
  recurrenceMasterId?: string
  /**
   * R2.7 — View-only. Set on an *expanded* occurrence (one the rule generated,
   * as opposed to a stored detached override) and never persisted or
   * serialized. It names the master this occurrence came from, so a card the
   * user interacts with can act on the series without parsing its synthetic
   * `${masterId}-${occurrenceKey}` id back apart.
   */
  occurrenceMasterId?: string
  /** Raw VEVENT STATUS value, including cancelled detached occurrences. */
  eventStatus?: string
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
  /** RFC 5545 §3.8.4.1 ATTENDEE properties. */
  attendees?: CalendarAttendee[]
  /** RFC 5545 §3.8.4.3 ORGANIZER property. */
  organizer?: CalendarOrganizer
}

export type CalendarSource = 'local' | 'caldav' | 'webcal'

export interface Calendar {
  id: string
  name: string
  color: string
  isVisible: boolean
  isDefault: boolean
  accountId?: string
  showTasksInViews: boolean
  supportedComponents?: CalendarComponent[]
  // Undefined ≈ local/caldav (existing behavior, unchanged for old data).
  source?: CalendarSource
  // True for webcal subscriptions — event mutation is blocked at the store
  // boundary via isCalendarReadOnly().
  readOnly?: boolean
}

export type ViewType =
  'month' | 'week' | '3day' | 'day' | 'agenda' | 'todo' | 'journal' | 'contacts' | 'year'

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
  pendingEventPrefill: ExtractedEventFields | null
  /**
   * Remaining AI-photo-import candidates still to be reviewed, when the user
   * chose "Add all" on a photo with multiple detected events. `closeModal`
   * pops the next one and reopens the form instead of fully closing, until
   * the queue is empty.
   */
  importQueue: ExtractedEventFields[]
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

/**
 * R2.7 — The write plan for completing/un-completing one occurrence of a
 * recurring task. Shaped to be passed straight to
 * `saveRecurrenceOverride(calendarId, master, override, removedOverrideIds)`.
 */
export interface TaskOccurrencePlan {
  /** Unchanged — the master keeps its RRULE and is re-PUT only for SEQUENCE. */
  master: CalendarEvent
  /** The detached instance to write, or null to leave the series unexcepted. */
  override: CalendarEvent | null
  /** Overrides to drop from the resource (un-completing a pure marker). */
  removedOverrideIds: string[]
}

export interface CalendarActions {
  addEvent: (event: CalendarEvent) => void
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void
  completeTask: (id: string, completed: boolean) => CalendarEvent[]
  completeTaskOccurrence: (
    masterId: string,
    occurrenceStart: string,
    completed: boolean
  ) => TaskOccurrencePlan | null
  deleteEvent: (id: string) => void
  addBrokenEvent: (event: CalendarEvent, reason: string) => void
  removeBrokenEvent: (eventId: string) => void
  fixBrokenEvent: (eventId: string) => void
  addDuplicateUidIssue: (issue: DuplicateUidIssue) => void
  clearDuplicateUidIssues: () => void
  removeDuplicateUidResource: (uid: string, calendarId: string, href: string) => void
  duplicateEvent: (id: string, addCopySuffix?: boolean) => string | null
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
    initialCalendarId?: string
  ) => void
  closeModal: () => void
  setPendingEventPrefill: (fields: ExtractedEventFields | null) => void
  startImportQueue: (candidates: ExtractedEventFields[]) => void
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
export type DefaultDuration = number
export type ThemeMode = 'light' | 'dark' | 'auto'
/** Strength of a calendar's colour on its event cards — default theme only. */
export type EventTint = 'subtle' | 'balanced' | 'vivid'
export type MapProvider = 'google' | 'apple' | 'osm' | 'mapy' | 'geo'

export interface UserSettings {
  timezone: string
  dateFormat: DateFormat
  timeFormat: TimeFormat
  firstDayOfWeek: FirstDayOfWeek
  defaultDuration: DefaultDuration
  defaultView: ViewType
  showWeekNumbers: boolean
  showWeekNumbersInSidebar: boolean
  eventDensity: EventDensity
  mapProvider: MapProvider
  /** Reminder seeded into a new event's form. `null` is "None" — start with no reminder. */
  defaultReminderMinutes: number | null
  defaultEventColor: string
  enableDesktopNotifications: boolean
  /** Android only: mirror events into the OS calendar provider so the system
   *  fires reminders and other apps (widgets, Wear OS, Auto) can see them. */
  enableCalendarMirror: boolean
  enableSoundAlerts: boolean
  enableHaptics: boolean
  conflictResolution: 'server-wins' | 'local-wins' | 'ask'
  compactRecurringEvents: boolean
  compressPastWeeks: boolean
  monthViewEventLimit: number
  hasCompletedOnboarding: boolean
  themeMode: ThemeMode
  lightTheme: string
  darkTheme: string
  mochaAccent: string
  eventTint: EventTint
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
  agendaBelowMonthEnabled: boolean
  monthAgendaGridRatio: number
  monthAgendaSplitRatio: number
  fadePastDaysInAgenda: 'never' | 'current' | 'all'
  /** User's arrangement of the view switcher. Reconciled against ALL_VIEWS
   *  on read — see `useOrderedViews` — so it tolerates views being added to
   *  or removed from the app between releases. */
  viewOrder: ViewType[]
  /** The view the desktop tab-strip divider sits directly after, or null
   *  when it sits before everything. Stored by view rather than by index so
   *  it survives reordering and views being switched off. */
  viewDividerAfter: ViewType | null
}

export type SettingsState = UserSettings

export interface SettingsActions {
  updateSettings: (updates: Partial<UserSettings>) => void
  resetSettings: () => void
}

export type SettingsStore = SettingsState & SettingsActions

/**
 * Which slice of a recurring series an edit or delete applies to. Shared by
 * RecurrenceDialog, DeleteDialog, EventModal and the recurrenceDelete helper —
 * it used to be redeclared in each of them.
 */
export type RecurrenceEditMode = 'all' | 'future' | 'this'
