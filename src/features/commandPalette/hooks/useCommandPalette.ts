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
import { makeDefaultReminders } from '@/lib/notifications'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { createCommandRegistry, type Command } from '../commands'
import { parseNaturalLanguage } from '@/features/nlp'
import { displayOccurrence, resolveRRuleString } from '@/lib/occurrenceExpansion'
import { describeRecurrence } from '@/lib/recurrence'
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

/** How many matching events the palette shows. */
const MAX_EVENT_RESULTS = 5

/** Matches scanned per displayed row, leaving room for series de-duplication. */
const CANDIDATE_OVERSCAN = 4

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

    // Parse once and reuse it for both the event-intent check below and the
    // quick-add result (see the nlpResult memo), so the relatively expensive
    // chrono parse runs a single time per keystroke instead of twice.
    const nlp = parseNaturalLanguage(input)

    // Signals that the phrase carries explicit event structure.
    const hasTimeIndicator =
      /\bat\s+\d|\bat\s+noon|\bat\s+midnight|\bat\s+lunch|\bat\s+dinner|\d{1,2}\s*(am|pm)|\d{1,2}:\d{2}/.test(
        trimmed
      )
    const hasDurationIndicator = /for\s+\d+\s*(min|hour|hr)/.test(trimmed)
    const hasLocationIndicator = /\bat\s+(?!\d|noon|midnight|lunch|dinner)/.test(trimmed)
    const hasEventStructure =
      hasTimeIndicator || hasDurationIndicator || hasLocationIndicator || nlp.isTask

    // A non-empty title that chrono produced from the phrase (and that doesn't
    // start with a navigation verb) is a "bare event" — e.g. a single noun like
    // "lunch", "gym", or "meeting", or a phrase like "team offsite".
    const NAVIGATION_VERBS = /^(go|show|open|navigate|view|switch|take me)\b/i
    const isEventTitle =
      !!nlp.title && nlp.title !== 'New Event' && !NAVIGATION_VERBS.test(nlp.title)

    // True only when the whole input is a date/navigation reference (a bare
    // month/day/year name, "next monday", "march 2024", "june 15", …). A
    // month/day name *embedded* in an event phrase ("pay rent may 1st",
    // "team meeting next monday", "may I have a meeting") must NOT count —
    // those are events, not navigation.
    const isPureDateNavigation = (value: string): boolean => {
      for (const keyword of PURE_DATE_KEYWORDS) {
        if (value === keyword || value.startsWith(keyword + ' ')) return true
      }
      if (/^\d{4}$/.test(value)) return true
      if (
        /^(?:next|last|this|on|the)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(
          value
        )
      )
        return true
      // Prefix matching so a half-typed name still navigates while the user
      // types ("thur" → thursday, "dece" → december). Only ever fires for a
      // value SHORTER than the name, so an event phrase that merely starts
      // with a month/day word ("may I have a meeting") can't match here.
      for (const day of DAY_NAMES) {
        if (value === day || value === day.slice(0, 3) || day.startsWith(value)) return true
      }
      if (
        /^(?:next|last|this|on|the)?\s*(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{1,2}(?:st|nd|rd|th)?|\s+\d{4})?$/i.test(
          value
        )
      )
        return true
      if (
        /^\d{1,2}(?:st|nd|rd|th)?\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(
          value
        )
      )
        return true
      for (const month of MONTH_NAMES) {
        if (value === month || value === month.slice(0, 3) || month.startsWith(value)) return true
      }
      return false
    }

    // 1) Explicit event structure always wins — even if a navigation verb leads
    //    the phrase ("go to gym at 5pm"). The confidence gate keeps false
    //    positives like "call at 555-1234" (a phone number) from matching.
    if (hasEventStructure && (nlp.confidence > 0.6 || nlp.isTask)) {
      return { type: 'quick-add', raw: input, nlp }
    }

    // 2) A pure date reference navigates. This runs before the bare-event check
    //    so "march", "monday", "2027" still navigate and aren't turned into
    //    all-day events.
    if (isPureDateNavigation(trimmed)) {
      return { type: 'navigation', raw: input, dateRef: trimmed }
    }

    // 3) Otherwise a non-empty event title is a quick-add: bare nouns
    //    ("lunch"/"gym"/"meeting"), task prefixes, or any event phrase. This
    //    runs AFTER the pure-date guard so a month/day name inside an event
    //    phrase never misroutes to navigation.
    if (isEventTitle) {
      return { type: 'quick-add', raw: input, nlp }
    }

    // Default: search
    return { type: 'search', raw: input }
  }, [])

  // Memoize NLP result once per query — reuse the parse from parseInput rather
  // than re-running the parser a second time.
  const nlpResult = useMemo(() => {
    if (!query.trim()) return null
    const parsed = parseInput(query)
    if (parsed.type === 'quick-add' && parsed.nlp) {
      const nlp = parsed.nlp
      return nlp.title && nlp.title !== 'New Event' ? nlp : null
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
      // lowercased strings per event.
      //
      // The cap is a multiple of what we display because matches still have to
      // survive series de-duplication below; overshooting a little is cheaper
      // than scanning the whole calendar.
      const matches: CalendarEvent[] = []
      for (const event of events) {
        if (
          event.title.toLowerCase().includes(lowerQuery) ||
          event.location?.toLowerCase().includes(lowerQuery)
        ) {
          matches.push(event)
          if (matches.length === MAX_EVENT_RESULTS * CANDIDATE_OVERSCAN) break
        }
      }

      // A detached override is a separate event in the store, so an edited
      // occurrence matched alongside its own series and showed up as a second,
      // near-identical row. Drop it when its master matched too — the series
      // row already stands for it. An override that no longer resembles the
      // series (a renamed occurrence, matching on its own) keeps its row.
      const matchedIds = new Set(matches.map((event) => event.id))

      const now = new Date()
      const results: EventResult[] = []
      for (const event of matches) {
        if (event.recurrenceMasterId && matchedIds.has(event.recurrenceMasterId)) continue

        // A series is shown as one row, dated at the occurrence a user would
        // recognise — the next one — rather than at the master's DTSTART,
        // which for a long-running weekly is years in the past. The synthetic
        // occurrence id is what `findEventById` resolves, so the modal opens
        // on that occurrence and its recurrence-scope dialog offers the right
        // choices.
        const shape = resolveRRuleString(event) ? displayOccurrence(event, now) : null
        results.push({
          id: shape ? `${event.id}-${shape.occKey}` : event.id,
          title: event.title,
          start: shape ? shape.occStartStr : event.start,
          calendarId: event.calendarId,
          type: event.type,
          recurrence: shape ? describeRecurrence(event) : undefined,
        })
        if (results.length === MAX_EVENT_RESULTS) break
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

    // Union of commands + matched events + matched calendars. Shared by the
    // quick-add and search branches so typing a bare event noun still finds
    // existing items by name.
    const buildSearchUnion = (): CommandPaletteItem[] => {
      const lowerQuery = query.toLowerCase()
      const commandItems = commands
        .filter((cmd) => {
          const labelMatch = cmd.label.toLowerCase().includes(lowerQuery)
          const keywordMatch = cmd.keywords.some((kw) => kw.toLowerCase().includes(lowerQuery))
          const descText =
            typeof cmd.description === 'function' ? cmd.description() : cmd.description
          const descMatch = descText?.toLowerCase().includes(lowerQuery)
          return labelMatch || keywordMatch || descMatch
        })
        .map(commandToItem)
      const eventItems = searchEvents(query).map((event) =>
        eventToItem(event, openModal, openJournalModal)
      )
      const calendarItems = searchCalendars(query).map((cal) => calendarToItem(cal, navigate))

      return [...commandItems, ...calendarItems, ...eventItems]
    }

    // Direct navigation: synthesize a "Go to ..." item
    if (parsed.type === 'navigation') {
      const dateRef = parsed.dateRef || query
      // `parsed.nlp` is only attached on the quick-add branches, and `dateRef`
      // is frequently a substring of the query rather than the whole of it, so
      // the navigation branch always parses the reference itself.
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

    // Quick-add: offer the parsed event/task, but ALSO surface any existing
    // events/calendars/commands that match the text. A bare noun like "lunch"
    // is now an event, yet "Standup" should still find an existing "Standup"
    // series — showing both keeps creation and search from being mutually
    // exclusive.
    if (parsed.type === 'quick-add') {
      const quickAddItem: CommandPaletteItem[] =
        nlpResult && nlpResult.title
          ? [
              quickAddToItem(
                {
                  title: nlpResult.title,
                  startDate: nlpResult.startDate,
                  endDate: nlpResult.endDate ?? undefined,
                  location: nlpResult.location,
                  isAllDay: nlpResult.isAllDay,
                  isTask: nlpResult.isTask,
                  confidence: nlpResult.confidence,
                  recurrence: nlpResult.recurrence,
                },
                query,
                calendars,
                addEvent,
                createCalDAVEvent,
                openModal
              ),
            ]
          : []
      return [...quickAddItem, ...buildSearchUnion()]
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
    return buildSearchUnion()
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
    group: event.type === 'journal' ? 'journal' : event.type === 'task' ? 'task' : 'event',
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
        // Quick-add skips the modal, so seed the default reminder here — the
        // setting means "what a new event starts with", however it was made.
        reminders: makeDefaultReminders(useSettingsStore.getState().defaultReminderMinutes),
        // Same reasoning for recurrence: "gym every other day" parses a rule,
        // and with no modal in the way this is the only place it can be
        // attached. `isAllDay` is mirrored onto the rule because the RRULE
        // serializer picks the UNTIL form from it (see RecurrenceRule).
        ...(qa.recurrence ? { recurrence: { ...qa.recurrence, isAllDay: qa.isAllDay } } : {}),
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
