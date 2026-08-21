import type { CalendarEvent, RecurrenceRule, ViewType } from '@/types'
import type { NLPParseResult } from '@/features/nlp'

export type CommandCategory = 'navigation' | 'actions' | 'settings' | 'event'

export interface Command {
  id: string
  label: string
  // A function description is recomputed each time the palette renders
  // (e.g. "Go to Today" needs today's date, not a date captured at
  // registry-build time — otherwise it goes stale at midnight).
  description?: string | (() => string)
  category: CommandCategory
  keywords: string[]
  shortcut?: string
  icon?: string
  action: () => string | void
}

export interface QuickAddResult {
  title: string
  startDate: Date
  endDate?: Date
  location?: string
  isAllDay: boolean
  isTask: boolean
  confidence: number
  /** Parsed recurrence ("every monday", "every other day"). Quick-add skips
   *  the modal, so this has to reach the created event from here or the
   *  series silently collapses to a single occurrence. */
  recurrence?: RecurrenceRule
}

export interface CalendarResult {
  id: string
  name: string
  color: string
}

export interface EventResult {
  id: string
  title: string
  start: string
  calendarId: string
  /** Which modal the result opens. Journal entries belong to the journal
   *  day modal, not the event modal. Absent means a plain event. */
  type?: CalendarEvent['type']
  /** Human-readable RRULE ("Every week on Monday") — set only for a series,
   *  and the flag the row uses to mark itself recurring. */
  recurrence?: string
}

export interface ExecuteResult {
  success: boolean
  message: string
  linkText?: string
  onLinkClick?: () => void
}

export type CommandPaletteItemGroup =
  'navigation' | 'actions' | 'settings' | 'calendars' | 'event' | 'task' | 'journal' | 'quick-add'

export type CommandPaletteItemData = Command | CalendarResult | EventResult | QuickAddResult

export interface CommandPaletteItem {
  id: string
  value: string
  group: CommandPaletteItemGroup
  keywords: string[]
  shortcut?: string
  onSelect: () => Promise<ExecuteResult | undefined>
  data: CommandPaletteItemData
  itemType: 'command' | 'event' | 'calendar' | 'quick-add'
}

export type DateNavigationTarget =
  | 'today'
  | 'tomorrow'
  | 'next-week'
  | 'prev-week'
  | 'next-month'
  | 'prev-month'
  | ViewType
  | 'settings'
  | 'new-event'
  | 'sync'
  | 'toggle-sidebar'

export interface ParsedInput {
  type: 'command' | 'navigation' | 'search' | 'quick-add' | 'empty'
  raw: string
  command?: string
  dateRef?: string
  /** Parsed NLP result, attached when the input was analysed. Lets callers
   *  reuse a single parse instead of re-running the parser. */
  nlp?: NLPParseResult
}
