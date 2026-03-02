import type { ViewType } from '@/types'

export type CommandCategory = 'navigation' | 'actions' | 'settings' | 'search' | 'event'

export interface Command {
  id: string
  label: string
  description?: string
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
  confidence: number
}

export interface CommandResult {
  type: 'command' | 'event' | 'calendar' | 'quick-add'
  item: Command | CalendarResult | EventResult | QuickAddResult
  score: number
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
}

export interface CommandPaletteState {
  isOpen: boolean
  query: string
  results: CommandResult[]
  selectedIndex: number
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
}
