import { useMemo, useCallback, useState } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router'
import {
  useCalendarStore,
  selectOpenModal,
  selectOpenJournalModal,
  selectAddEvent,
  selectEvents,
  selectCalendars,
  selectSetCurrentView,
  selectSetCurrentDate,
} from '@/store/calendarStore'
import { useSettingsStore, selectThemeMode, selectUpdateSettings } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { createCommandRegistry, type Command } from '../commands'
import { parseNaturalLanguage } from '@/features/nlp'
import type {
  CommandPaletteItem,
  CommandPaletteItemGroup,
  ParsedInput,
  EventResult,
  CalendarResult,
  QuickAddResult,
  ExecuteResult,
} from '../types'
import type { CalendarEvent } from '@/types'

// Static lookup data — moved outside component to avoid re-creation on every render
const PURE_DATE_KEYWORDS = [
  'today',
  'tomorrow',
  'yesterday',
  'next week',
  'last week',
  'next month',
  'last month',
  'next year',
  'last year',
  'this weekend',
  'next weekend',
]

/** How many matching events the palette shows. Also bounds the search scan. */
const MAX_EVENT_RESULTS = 5

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

interface UseCommandPaletteProps {
  isOpen: boolean
  toggleSidebar?: () => void
  sidebarOpen?: boolean
}

function categoryToGroup(category: string): CommandPaletteItemGroup {
  if (category === 'event') return 'event'
  if (category === 'actions') return 'actions'
  if (category === 'settings') return 'settings'
  return 'navigation'
}

export function useCommandPalette({ toggleSidebar, sidebarOpen }: UseCommandPaletteProps): {
  query: string
  setQuery: (q: string) => void
  items: CommandPaletteItem[]
  executeSelected: (index?: number) => Promise<ExecuteResult | undefined>
  parseInput: (query: string) => ParsedInput
} {
  const navigate = useNavigate()
  const [query, setQueryState] = useState('')

  const setQuery = useCallback((q: string) => {
    setQueryState(q)
  }, [])
  const setCurrentView = useCalendarStore(selectSetCurrentView)
  const setCurrentDate = useCalendarStore(selectSetCurrentDate)
  const openModal = useCalendarStore(selectOpenModal)
  const openJournalModal = useCalendarStore(selectOpenJournalModal)
  const addEvent = useCalendarStore(selectAddEvent)
  const events = useCalendarStore(selectEvents)
  const calendars = useCalendarStore(selectCalendars)

  const themeMode = useSettingsStore(selectThemeMode)
  const updateSettings = useSettingsStore(selectUpdateSettings)
  const caldavDebugMode = useSettingsStore((state) => state.caldavDebugMode)

  const { syncAll, createEvent: createCalDAVEvent } = useCalDAV()

  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const useCategoryColors = useSettingsStore((state) => state.useCategoryColors)
  const journalEnabled = useSettingsStore((state) => state.journalEnabled)
  const contactsEnabled = useSettingsStore((state) => state.contactsEnabled)
  const showWeekNumbersInSidebar = useSettingsStore((state) => state.showWeekNumbersInSidebar)
  const agendaBelowMonthEnabled = useSettingsStore((state) => state.agendaBelowMonthEnabled)

  const commands = useMemo(() => {
    return createCommandRegistry({
      navigate,
      setCurrentView,
      setCurrentDate,
      openModal,
      openJournalModal,
      themeMode,
      caldavDebugMode,
      timeFormat,
      useCategoryColors,
      journalEnabled,
      contactsEnabled,
      showWeekNumbersInSidebar,
      agendaBelowMonthEnabled,
      sidebarOpen,
      toggleSidebar,
      updateSettings,
      triggerSync: syncAll,
    })
  }, [
    navigate,
    setCurrentView,
    setCurrentDate,
    openModal,
    openJournalModal,
    themeMode,
    caldavDebugMode,
    timeFormat,
    useCategoryColors,
    journalEnabled,
    contactsEnabled,
    showWeekNumbersInSidebar,
    agendaBelowMonthEnabled,
    sidebarOpen,
    toggleSidebar,
    updateSettings,
    syncAll,
  ])

  const parseInput = useCallback((input: string): ParsedInput => {
    const trimmed = input.trim().toLowerCase()

    if (!trimmed) {
      return { type: 'empty', raw: input }
    }

    // Explicit command prefix
    if (trimmed.startsWith('>')) {
      const cmd = trimmed.slice(1).trim()
      return { type: 'command', raw: input, command: cmd }
    }

    // Explicit navigation prefix
    if (trimmed.startsWith('@')) {
      const ref = trimmed.slice(1).trim()
      return { type: 'navigation', raw: input, dateRef: ref }
    }

    // Check for event creation intent (has time or duration indicators)
    const hasTimeIndicator =
      /\bat\s+\d|\bat\s+noon|\bat\s+midnight|\bat\s+lunch|\bat\s+dinner|\d{1,2}\s*(am|pm)|\d{1,2}:\d{2}/.test(
        trimmed
      )
    const hasDurationIndicator = /for\s+\d+\s*(min|hour|hr)/.test(trimmed)
    const hasLocationIndicator = /\bat\s+(?!\d|noon|midnight|lunch|dinner)/.test(trimmed)

    // If has time/duration/location, try quick-add (check BEFORE month/day navigation)
    if (hasTimeIndicator || hasDurationIndicator || hasLocationIndicator) {
      const result = parseNaturalLanguage(input)
      if (result.confidence > 0.6 && result.title) {
        return { type: 'quick-add', raw: input }
      }
    }

    // If NLP produces a meaningful title with high confidence, prefer
    // quick-add even without explicit time/duration/location indicators.
    // This lets inputs like "hang out with batman tomorrow" become a
    // quick-add result instead of falling through to navigation. The
    // "New Event" placeholder from extractTitle is excluded so plain
    // date keywords like "tomorrow" still navigate. Navigation verbs
    // ("go to", "show", "open") are also excluded — they indicate the
    // user wants to navigate, not create an event.
    const NAVIGATION_VERBS = /^(go|show|open|navigate|view|switch|take me)\b/i
    const nlpPreview = parseNaturalLanguage(input)
    if (
      nlpPreview.title &&
      nlpPreview.title !== 'New Event' &&
      nlpPreview.confidence >= 0.7 &&
      !NAVIGATION_VERBS.test(nlpPreview.title)
    ) {
      return { type: 'quick-add', raw: input }
    }

    // Check for pure date navigation (exact or starts with date keyword)
    for (const keyword of PURE_DATE_KEYWORDS) {
      if (trimmed === keyword || trimmed.startsWith(keyword)) {
        return { type: 'navigation', raw: input, dateRef: trimmed }
      }
    }

    // Check for day names ("monday", "next monday", "this friday", "thu" for thursday)
    for (const day of DAY_NAMES) {
      if (trimmed === day || trimmed.endsWith(day) || day.startsWith(trimmed)) {
        return { type: 'navigation', raw: input, dateRef: trimmed }
      }
    }

    // Check for month names ("march", "march 2024", "show march", "dece" for december)
    for (const month of MONTH_NAMES) {
      if (trimmed.includes(month) || month.startsWith(trimmed)) {
        return { type: 'navigation', raw: input, dateRef: trimmed }
      }
    }

    // Check for year patterns ("2024", "2025")
    if (/^\d{4}$/.test(trimmed)) {
      return { type: 'navigation', raw: input, dateRef: trimmed }
    }

    // Default: search
    return { type: 'search', raw: input }
  }, [])

  // Memoize NLP result once per query
  const nlpResult = useMemo(() => {
    if (!query.trim()) return null
    const parsed = parseInput(query)
    if (parsed.type === 'quick-add') {
      const result = parseNaturalLanguage(query)
      return result.confidence > 0.5 ? result : null
    }
    return null
  }, [query, parseInput])

  const searchEvents = useCallback(
    (searchQuery: string): EventResult[] => {
      if (!searchQuery.trim()) return []

      const lowerQuery = searchQuery.toLowerCase()
      // Explicit loop with an early exit rather than .filter().slice(0, 5):
      // filter runs the whole corpus to completion before slicing, so on a
      // large calendar every keystroke scanned every event and allocated two
      // lowercased strings per event. We only ever show 5.
      const results: EventResult[] = []
      for (const event of events) {
        if (
          event.title.toLowerCase().includes(lowerQuery) ||
          event.location?.toLowerCase().includes(lowerQuery)
        ) {
          results.push({
            id: event.id,
            title: event.title,
            start: event.start,
            calendarId: event.calendarId,
            type: event.type,
          })
          if (results.length === MAX_EVENT_RESULTS) break
        }
      }
      return results
    },
    [events]
  )

  const searchCalendars = useCallback(
    (searchQuery: string): CalendarResult[] => {
      if (!searchQuery.trim()) return []

      const lowerQuery = searchQuery.toLowerCase()
      return calendars
        .filter((cal) => cal.name.toLowerCase().includes(lowerQuery))
        .slice(0, 3)
        .map((cal) => ({
          id: cal.id,
          name: cal.name,
          color: cal.color,
        }))
    },
    [calendars]
  )

  // Build the items list. cmdk's fuzzy filter operates on item.value.
  const items = useMemo((): CommandPaletteItem[] => {
    // Empty query: top 8 default commands
    if (!query.trim()) {
      return commands.slice(0, 8).map(commandToItem)
    }

    const parsed = parseInput(query)

    // Direct navigation: synthesize a "Go to ..." item
    if (parsed.type === 'navigation') {
      const dateRef = parsed.dateRef || query
      const parsedDate = parseNaturalLanguage(dateRef)
      const navCmd: Command = {
        id: 'nav-quick',
        label: `Go to ${dateRef}`,
        description: format(parsedDate.startDate, 'EEEE, d MMMM yyyy'),
        category: 'navigation',
        keywords: ['navigate', 'go', 'date', dateRef],
        icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v2M10.5 1.5v2"/></svg>',
        action: () => {
          setCurrentDate(format(parsedDate.startDate, 'yyyy-MM-dd'))
          if (
            parsedDate.startDate.getMonth() !== new Date().getMonth() ||
            parsedDate.startDate.getFullYear() !== new Date().getFullYear()
          ) {
            setCurrentView('month')
          }
          return `Navigated to ${format(parsedDate.startDate, 'EEEE, d MMMM yyyy')}`
        },
      }
      return [commandToItem(navCmd)]
    }

    // Quick-add
    if (parsed.type === 'quick-add') {
      if (nlpResult && nlpResult.title) {
        const qa: QuickAddResult = {
          title: nlpResult.title,
          startDate: nlpResult.startDate,
          endDate: nlpResult.endDate ?? undefined,
          location: nlpResult.location,
          isAllDay: nlpResult.isAllDay,
          isTask: nlpResult.isTask,
          confidence: nlpResult.confidence,
        }
        return [quickAddToItem(qa, query, calendars, addEvent, createCalDAVEvent, openModal)]
      }
      return []
    }

    // Explicit `>` command prefix: show only commands, let cmdk filter
    if (parsed.type === 'command') {
      const filter = (parsed.command || query).replace(/^>/, '').toLowerCase()
      return commands
        .filter((cmd) => {
          const labelMatch = cmd.label.toLowerCase().includes(filter)
          const keywordMatch = cmd.keywords.some((kw) => kw.toLowerCase().includes(filter))
          // Description may be a function for live date-dependent text; resolve
          // it for filter matching.
          const descText =
            typeof cmd.description === 'function' ? cmd.description() : cmd.description
          const descMatch = descText?.toLowerCase().includes(filter)
          return labelMatch || keywordMatch || descMatch
        })
        .slice(0, 8)
        .map(commandToItem)
    }

    // Search/command: union of all commands + matched events + matched calendars.
    // We do our own filtering since cmdk's fuzzy filter is too aggressive.
    const lowerQuery = query.toLowerCase()
    const commandItems = commands
      .filter((cmd) => {
        const labelMatch = cmd.label.toLowerCase().includes(lowerQuery)
        const keywordMatch = cmd.keywords.some((kw) => kw.toLowerCase().includes(lowerQuery))
        const descText = typeof cmd.description === 'function' ? cmd.description() : cmd.description
        const descMatch = descText?.toLowerCase().includes(lowerQuery)
        return labelMatch || keywordMatch || descMatch
      })
      .map(commandToItem)
    const eventItems = searchEvents(query).map((event) =>
      eventToItem(event, openModal, openJournalModal)
    )
    const calendarItems = searchCalendars(query).map((cal) => calendarToItem(cal, navigate))

    return [...commandItems, ...calendarItems, ...eventItems]
  }, [
    query,
    commands,
    parseInput,
    nlpResult,
    searchEvents,
    searchCalendars,
    setCurrentDate,
    setCurrentView,
    calendars,
    addEvent,
    createCalDAVEvent,
    openModal,
    openJournalModal,
    navigate,
  ])

  const executeSelected = useCallback(
    async (index?: number) => {
      const executeIndex = index ?? 0
      const selected = items[executeIndex]
      if (!selected) return { success: false, message: '' }
      return selected.onSelect()
    },
    [items]
  )

  return {
    query,
    setQuery,
    items,
    executeSelected,
    parseInput,
  }
}

// --- builders ---

function commandToItem(cmd: Command): CommandPaletteItem {
  // Description may be a function (for live date-dependent text); resolve it
  // for the cmdk `value` field so it participates in fuzzy matching.
  const descText = typeof cmd.description === 'function' ? cmd.description() : cmd.description
  return {
    id: cmd.id,
    value: `${cmd.label} ${cmd.keywords.join(' ')} ${descText ?? ''}`,
    group: categoryToGroup(cmd.category),
    keywords: cmd.keywords,
    shortcut: cmd.shortcut,
    onSelect: async () => {
      const message = cmd.action()
      return { success: true, message: message ?? '' }
    },
    data: cmd,
    itemType: 'command',
  }
}

function eventToItem(
  event: EventResult,
  openModal: (date?: string, endDate?: string, eventId?: string) => void,
  openJournalModal: (date: string, startInCompose?: boolean) => void
): CommandPaletteItem {
  return {
    id: `event-${event.id}`,
    value: `${event.title} ${new Date(event.start).toLocaleString()}`,
    group: 'event',
    keywords: [],
    onSelect: async () => {
      if (event.type === 'journal') {
        // Journal entries live in the journal day modal — the event modal
        // can't render one (it filters journals out of its own lookup).
        // That modal is keyed by day, not by entry id.
        openJournalModal(event.start.split('T')[0])
      } else {
        openModal(event.start, undefined, event.id)
      }
      return { success: true, message: `Opened: ${event.title}` }
    },
    data: event,
    itemType: 'event',
  }
}

function calendarToItem(cal: CalendarResult, navigate: (path: string) => void): CommandPaletteItem {
  return {
    id: `cal-${cal.id}`,
    value: cal.name,
    group: 'calendars',
    keywords: [],
    onSelect: async () => {
      navigate(`/settings?tab=calendars&calendar=${cal.id}`)
      return { success: true, message: `Opened calendar: ${cal.name}` }
    },
    data: cal,
    itemType: 'calendar',
  }
}

function quickAddToItem(
  qa: QuickAddResult,
  rawInput: string,
  calendars: { id: string; isDefault?: boolean }[],
  addEvent: (event: CalendarEvent) => void,
  createCalDAVEvent: (calendarId: string, event: CalendarEvent) => Promise<unknown>,
  openModal: (date?: string, endDate?: string, eventId?: string) => void
): CommandPaletteItem {
  return {
    id: `qa-${qa.title}-${qa.startDate.toISOString()}`,
    value: `${rawInput} ${qa.title} ${qa.location ?? ''} ${qa.isAllDay ? 'all day' : ''}`,
    group: 'quick-add',
    keywords: [rawInput, qa.title, qa.location ?? ''].filter(Boolean),
    onSelect: async () => {
      const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]
      const calendarId = defaultCalendar?.id || 'default'

      if (qa.isTask) {
        const newEvent = {
          id: crypto.randomUUID(),
          calendarId,
          title: qa.title,
          location: qa.location,
          start: qa.startDate.toISOString(),
          end: qa.endDate ? qa.endDate.toISOString() : qa.startDate.toISOString(),
          isAllDay: qa.isAllDay,
          type: 'task' as const,
          dueDate: format(qa.startDate, 'yyyy-MM-dd'),
        }
        addEvent(newEvent)
        try {
          await createCalDAVEvent(calendarId, newEvent)
        } catch {
          // error already handled by useCalDAV
        }
        return {
          success: true,
          message: `Created task: ${qa.title}`,
          linkText: 'Open',
          onLinkClick: () => openModal(undefined, undefined, newEvent.id),
        }
      }

      const newEvent = {
        id: crypto.randomUUID(),
        calendarId,
        title: qa.title,
        location: qa.location,
        start: qa.startDate.toISOString(),
        end: qa.endDate ? qa.endDate.toISOString() : qa.startDate.toISOString(),
        isAllDay: qa.isAllDay,
      }
      addEvent(newEvent)
      try {
        await createCalDAVEvent(calendarId, newEvent)
      } catch {
        // error already handled by useCalDAV
      }
      return {
        success: true,
        message: `Created event: ${qa.title}`,
        linkText: 'Open',
        onLinkClick: () => openModal(undefined, undefined, newEvent.id),
      }
    },
    data: qa,
    itemType: 'quick-add',
  }
}
