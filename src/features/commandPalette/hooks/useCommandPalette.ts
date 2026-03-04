import { useMemo, useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { createCommandRegistry, type Command } from '../commands'
import { parseNaturalLanguage, type NLPParseResult } from '@/features/nlp'
import type {
  CommandResult,
  ParsedInput,
  EventResult,
  CalendarResult,
  QuickAddResult,
} from '../types'

interface UseCommandPaletteProps {
  isOpen: boolean
}

export interface ExecuteResult {
  success: boolean
  message: string
}

export function useCommandPalette({ isOpen }: UseCommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const openModal = useCalendarStore((state) => state.openModal)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)

  const themeMode = useSettingsStore((state) => state.themeMode)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const { syncAll } = useCalDAV()

  const commands = useMemo(() => {
    return createCommandRegistry({
      navigate,
      setCurrentView,
      setCurrentDate,
      openModal,
      themeMode,
      updateSettings,
      triggerSync: syncAll,
    })
  }, [navigate, setCurrentView, setCurrentDate, openModal, themeMode, updateSettings, syncAll])

  const parseInput = useCallback((input: string): ParsedInput => {
    const trimmed = input.trim().toLowerCase()

    if (!trimmed) {
      return { type: 'empty', raw: input }
    }

    if (trimmed.startsWith('>')) {
      const cmd = trimmed.slice(1).trim()
      return { type: 'command', raw: input, command: cmd }
    }

    if (trimmed.startsWith('@')) {
      const ref = trimmed.slice(1).trim()
      return { type: 'navigation', raw: input, dateRef: ref }
    }

    const dateKeywords = [
      'today',
      'tomorrow',
      'yesterday',
      'next week',
      'last week',
      'next month',
      'last month',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]

    for (const keyword of dateKeywords) {
      if (trimmed.includes(keyword)) {
        const result = parseNaturalLanguage(input)
        if (result.confidence > 0.5) {
          return { type: 'quick-add', raw: input }
        }
        return { type: 'navigation', raw: input, dateRef: trimmed }
      }
    }

    const result = parseNaturalLanguage(input)
    if (result.confidence > 0.7 && result.title) {
      return { type: 'quick-add', raw: input }
    }

    return { type: 'search', raw: input }
  }, [])

  const searchEvents = useCallback(
    (searchQuery: string): EventResult[] => {
      if (!searchQuery.trim()) return []

      const lowerQuery = searchQuery.toLowerCase()
      return events
        .filter(
          (event) =>
            event.title.toLowerCase().includes(lowerQuery) ||
            (event.location && event.location.toLowerCase().includes(lowerQuery))
        )
        .slice(0, 5)
        .map((event) => ({
          id: event.id,
          title: event.title,
          start: event.start,
          calendarId: event.calendarId,
        }))
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

  const filterCommands = useCallback(
    (searchQuery: string): Command[] => {
      if (!searchQuery.trim()) {
        return commands.slice(0, 8)
      }

      const lowerQuery = searchQuery.toLowerCase()

      return commands
        .filter((cmd) => {
          const labelMatch = cmd.label.toLowerCase().includes(lowerQuery.replace(/^>/, ''))
          const keywordMatch = cmd.keywords.some((kw) =>
            kw.toLowerCase().includes(lowerQuery.replace(/^>/, ''))
          )
          const descMatch = cmd.description?.toLowerCase().includes(lowerQuery.replace(/^>/, ''))
          return labelMatch || keywordMatch || descMatch
        })
        .sort((a, b) => {
          const aExact = a.label.toLowerCase() === lowerQuery.replace(/^>/, '') ? 0 : 1
          const bExact = b.label.toLowerCase() === lowerQuery.replace(/^>/, '') ? 0 : 1
          return aExact - bExact
        })
        .slice(0, 8)
    },
    [commands]
  )

  // React Compiler cannot optimize this due to function dependencies
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const results = useMemo((): CommandResult[] => {
    if (!query.trim()) {
      const defaultCommands = filterCommands('')
      return defaultCommands.map((cmd) => ({
        type: 'command' as const,
        item: cmd,
        score: 1,
      }))
    }

    const parsed = parseInput(query)

    if (parsed.type === 'command' || parsed.type === 'navigation') {
      const filtered = filterCommands(parsed.command || parsed.dateRef || query)
      return filtered.map((cmd) => ({
        type: 'command' as const,
        item: cmd,
        score:
          cmd.label.toLowerCase() === (parsed.command || parsed.dateRef || query).toLowerCase()
            ? 1
            : 0.5,
      }))
    }

    if (parsed.type === 'quick-add') {
      const nlpResult = parseNaturalLanguage(query)
      if (nlpResult.confidence > 0.5 && nlpResult.title) {
        const quickAddItem: QuickAddResult = {
          title: nlpResult.title,
          startDate: nlpResult.startDate,
          endDate: nlpResult.endDate ?? undefined,
          location: nlpResult.location,
          isAllDay: nlpResult.isAllDay,
          confidence: nlpResult.confidence,
        }
        return [
          {
            type: 'quick-add' as const,
            item: quickAddItem,
            score: nlpResult.confidence,
          },
        ]
      }
      return []
    }

    const commandResults = filterCommands(query).map((cmd) => ({
      type: 'command' as const,
      item: cmd,
      score: 0.8,
    }))

    const eventResults = searchEvents(query).map((event) => ({
      type: 'event' as const,
      item: event,
      score: 0.6,
    }))

    const calendarResults = searchCalendars(query).map((cal) => ({
      type: 'calendar' as const,
      item: cal,
      score: 0.7,
    }))

    return [...commandResults, ...calendarResults, ...eventResults]
  }, [query, parseInput, filterCommands, searchEvents, searchCalendars])

  const preview = useMemo((): NLPParseResult | null => {
    const parsed = parseInput(query)
    if (parsed.type === 'quick-add') {
      const nlpResult = parseNaturalLanguage(query)
      if (nlpResult.confidence > 0.5) {
        return nlpResult
      }
    }
    return null
  }, [query, parseInput])

  const executeSelected = useCallback(() => {
    const selected = results[selectedIndex]
    if (!selected) return { success: false, message: '' }

    if (selected.type === 'command') {
      const cmd = selected.item as Command
      const message = cmd.action()
      return { success: true, message: message || 'Executed' }
    }

    if (selected.type === 'event') {
      const event = selected.item as EventResult
      openModal(event.start, undefined, event.id)
      return { success: true, message: `Opened: ${event.title}` }
    }

    if (selected.type === 'calendar') {
      const cal = selected.item as CalendarResult
      navigate(`/settings?tab=calendars&calendar=${cal.id}`)
      return { success: true, message: `Opened calendar: ${cal.name}` }
    }

    if (selected.type === 'quick-add') {
      const qa = selected.item as QuickAddResult
      const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]
      addEvent({
        id: crypto.randomUUID(),
        calendarId: defaultCalendar?.id || 'default',
        title: qa.title,
        location: qa.location,
        start: qa.startDate.toISOString(),
        end: qa.endDate ? qa.endDate.toISOString() : qa.startDate.toISOString(),
        isAllDay: qa.isAllDay,
      })
      return { success: true, message: `Created event: ${qa.title}` }
    }

    if (selected.type === 'command') {
      const cmd = selected.item as Command
      const message = cmd.action()
      return { success: true, message: message || 'Executed' }
    }

    return { success: false, message: '' }
  }, [results, selectedIndex, openModal, navigate, addEvent, calendars])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        executeSelected()
      }
    },
    [results.length, executeSelected]
  )

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  return {
    query,
    setQuery,
    results,
    selectedIndex,
    setSelectedIndex,
    preview,
    executeSelected,
    handleKeyDown,
    parseInput,
  }
}
