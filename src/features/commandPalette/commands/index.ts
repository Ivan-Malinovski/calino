import type { Command, CommandCategory } from '../types'

export type { Command, CommandCategory }
import { addDays, addWeeks, addMonths, subWeeks, subMonths, format } from 'date-fns'
import type { ThemeMode } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import { useHistoryStore } from '@/store/historyStore'
import { toLocalDateString, formatDisplayDate } from '@/lib/datetime'
import i18n from '@/lib/i18n'

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(`commands:${key}`, opts)

interface CommandFactoryDeps {
  navigate: (path: string) => void
  setCurrentView: (view: 'month' | 'week' | 'day' | 'agenda' | 'journal' | 'todo') => void
  setCurrentDate: (date: string) => void
  openModal: (
    date?: string,
    endDate?: string,
    eventId?: string,
    mode?: 'event' | 'task' | 'journal'
  ) => void
  openJournalModal: (date: string, startInCompose?: boolean) => void
  toggleSidebar?: () => void
  triggerSync?: () => void
  themeMode?: ThemeMode
  caldavDebugMode?: boolean
  timeFormat?: '12h' | '24h'
  sidebarOpen?: boolean
  useCategoryColors?: boolean
  journalEnabled?: boolean
  contactsEnabled?: boolean
  showWeekNumbersInSidebar?: boolean
  agendaBelowMonthEnabled?: boolean
  updateSettings?: (
    settings: Partial<{
      themeMode: ThemeMode
      lightTheme: string
      darkTheme: string
      caldavDebugMode: boolean
      timeFormat: '12h' | '24h'
      useCategoryColors: boolean
      journalEnabled: boolean
      contactsEnabled: boolean
      showWeekNumbersInSidebar: boolean
      agendaBelowMonthEnabled: boolean
    }>
  ) => void
}

// 16×16 stroke SVG icons
const ICONS = {
  calendar:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v2M10.5 1.5v2"/></svg>',
  arrowRight:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  arrowLeft:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8H3M7 4L3 8l4 4"/></svg>',
  undo: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 105-5 5 5 0 00-4.5 2.8M2 3v3h3"/></svg>',
  redo: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 11-5-5 5 5 0 014.5 2.8M14 3v3h-3"/></svg>',
  skipForward:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4l6 4-6 4V4zM11 4l2 4-2 4"/></svg>',
  skipBack:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4L7 8l6 4V4zM5 4L3 8l2 4"/></svg>',
  chevronRight:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  circle:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5"/></svg>',
  settings:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M13.5 10a1.3 1.3 0 00.26 1.45l.05.05a1.58 1.58 0 11-2.23 2.23l-.05-.05A1.3 1.3 0 0010 13.5a1.3 1.3 0 00-.8 1.2v.1a1.58 1.58 0 01-3.16 0v-.1A1.3 1.3 0 005.28 13.5a1.3 1.3 0 00-1.45.26l-.05.05a1.58 1.58 0 11-2.23-2.23l.05-.05A1.3 1.3 0 002.5 10a1.3 1.3 0 00-1.2-.8H1.2a1.58 1.58 0 010-3.16h.1A1.3 1.3 0 002.5 5.28a1.3 1.3 0 00-.26-1.45l-.05-.05a1.58 1.58 0 112.23-2.23l.05.05A1.3 1.3 0 005.28 2.5a1.3 1.3 0 00.8-1.2V1.2a1.58 1.58 0 013.16 0v.1a1.3 1.3 0 00.8 1.2 1.3 1.3 0 001.45-.26l.05-.05a1.58 1.58 0 112.23 2.23l-.05.05A1.3 1.3 0 0013.5 5.28a1.3 1.3 0 001.2.8h.1a1.58 1.58 0 010 3.16h-.1a1.3 1.3 0 00-1.2.8z"/></svg>',
  bug: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v2M8 13v2M3 5H1M3 11H1M13 5h2M13 11h2M5.5 2.5l-1 1M10.5 12.5l-1 1M5.5 12.5l-1-1M10.5 2.5l-1-1"/><rect x="3" y="5" width="10" height="8" rx="2"/><path d="M5 5V4a3 3 0 016 0v1"/></svg>',
  sidebar:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/></svg>',
  moon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z"/></svg>',
  sun: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/></svg>',
  clock:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 2.5"/></svg>',
  system:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="9" rx="2"/><path d="M5 15h6M8 12v3"/></svg>',
  sync: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 019.86-3.36M13.5 8a5.5 5.5 0 01-9.86 3.36"/><path d="M12.36 1v3.36H9M3.64 15v-3.36H7"/></svg>',
  palette:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="5" r="1" fill="currentColor"/><circle cx="5.5" cy="7.5" r="1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/></svg>',
} as const

const createNavigationCommands = (deps: CommandFactoryDeps): Command[] => {
  // NOTE: don't capture `new Date()` here — registry is built once per render
  // but the palette can stay open across midnight, and computed descriptions
  // are still rendered (search filter + CommandItem) on every keystroke.
  // Each action computes its own `today` so results stay correct.
  return [
    {
      id: 'nav-today',
      label: t('nav.goToToday'),
      description: () => formatDisplayDate(new Date(), 'EEEE, d MMMM yyyy'),
      category: 'navigation',
      keywords: ['today', 'current', 'now', 'home'],
      shortcut: 'T',
      icon: ICONS.calendar,
      action: () => {
        const today = new Date()
        deps.setCurrentDate(format(today, 'yyyy-MM-dd'))
        return t('nav.navigatedToToday')
      },
    },
    {
      id: 'nav-tomorrow',
      label: t('nav.goToTomorrow'),
      description: () => formatDisplayDate(addDays(new Date(), 1), 'EEEE, d MMMM yyyy'),
      category: 'navigation',
      keywords: ['tomorrow', 'next day'],
      icon: ICONS.chevronRight,
      action: () => {
        const tomorrow = addDays(new Date(), 1)
        deps.setCurrentDate(format(tomorrow, 'yyyy-MM-dd'))
        return t('nav.navigatedToTomorrow')
      },
    },
    {
      id: 'nav-next-week',
      label: t('nav.nextWeek'),
      description: () => {
        const next = addWeeks(new Date(), 1)
        return `${formatDisplayDate(next, 'd MMM')} – ${formatDisplayDate(next, 'd MMM')}`
      },
      category: 'navigation',
      keywords: ['next week', 'forward'],
      icon: ICONS.skipForward,
      shortcut: ']',
      action: () => {
        const next = addWeeks(new Date(), 1)
        deps.setCurrentDate(format(next, 'yyyy-MM-dd'))
        return t('nav.navigatedToNextWeek')
      },
    },
    {
      id: 'nav-prev-week',
      label: t('nav.previousWeek'),
      description: () => {
        const prev = subWeeks(new Date(), 1)
        return `${formatDisplayDate(prev, 'd MMM')} – ${formatDisplayDate(prev, 'd MMM')}`
      },
      category: 'navigation',
      keywords: ['previous week', 'last week', 'back'],
      icon: ICONS.skipBack,
      shortcut: '[',
      action: () => {
        const prev = subWeeks(new Date(), 1)
        deps.setCurrentDate(format(prev, 'yyyy-MM-dd'))
        return t('nav.navigatedToPreviousWeek')
      },
    },
    {
      id: 'nav-next-month',
      label: t('nav.nextMonth'),
      description: () => formatDisplayDate(addMonths(new Date(), 1), 'MMMM yyyy'),
      category: 'navigation',
      keywords: ['next month'],
      icon: ICONS.skipForward,
      shortcut: '⇧]',
      action: () => {
        const next = addMonths(new Date(), 1)
        deps.setCurrentDate(format(next, 'yyyy-MM-dd'))
        return t('nav.navigatedToNextMonth')
      },
    },
    {
      id: 'nav-prev-month',
      label: t('nav.previousMonth'),
      description: () => formatDisplayDate(subMonths(new Date(), 1), 'MMMM yyyy'),
      category: 'navigation',
      keywords: ['previous month', 'last month'],
      icon: ICONS.skipBack,
      shortcut: '⇧[',
      action: () => {
        const prev = subMonths(new Date(), 1)
        deps.setCurrentDate(format(prev, 'yyyy-MM-dd'))
        return t('nav.navigatedToPreviousMonth')
      },
    },
    {
      id: 'view-month',
      label: t('nav.monthView'),
      category: 'navigation',
      keywords: ['month view', 'month', 'calendar'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('month')
        deps.navigate('/month')
        return t('nav.switchedToMonthView')
      },
    },
    {
      id: 'view-week',
      label: t('nav.weekView'),
      category: 'navigation',
      keywords: ['week view', 'week'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('week')
        deps.navigate('/week')
        return t('nav.switchedToWeekView')
      },
    },
    {
      id: 'view-day',
      label: t('nav.dayView'),
      category: 'navigation',
      keywords: ['day view', 'day', 'today'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('day')
        deps.navigate('/day')
        return t('nav.switchedToDayView')
      },
    },
    {
      id: 'view-agenda',
      label: t('nav.agendaView'),
      category: 'navigation',
      keywords: ['agenda view', 'agenda', 'list'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('agenda')
        deps.navigate('/agenda')
        return t('nav.switchedToAgendaView')
      },
    },
    {
      id: 'view-tasks',
      label: t('nav.tasksView'),
      category: 'navigation',
      keywords: ['tasks view', 'tasks', 'todo', 'task list'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('todo')
        deps.navigate('/tasks')
        return t('nav.switchedToTasksView')
      },
    },
  ]
}

const createActionCommands = (deps: CommandFactoryDeps): Command[] => [
  {
    id: 'action-new-event',
    label: t('actions.createEvent'),
    category: 'actions',
    keywords: ['new event', 'create', 'add', 'event'],
    shortcut: 'C',
    icon: ICONS.plus,
    action: () => {
      deps.openModal()
      return t('actions.eventModalOpened')
    },
  },
  {
    id: 'action-new-task',
    label: t('actions.newTask'),
    category: 'actions',
    keywords: ['new task', 'task', 'todo'],
    shortcut: 'K',
    icon: ICONS.circle,
    action: () => {
      deps.openModal(undefined, undefined, undefined, 'task')
      return t('actions.taskModalOpened')
    },
  },
  {
    id: 'action-undo',
    label: t('actions.undo'),
    description: t('actions.undoDescription'),
    category: 'actions',
    keywords: ['undo', 'revert', 'back', 'history'],
    shortcut: '⌘Z',
    icon: ICONS.undo,
    action: () => {
      return useHistoryStore.getState().undo() ? t('actions.undone') : t('actions.nothingToUndo')
    },
  },
  {
    id: 'action-redo',
    label: t('actions.redo'),
    description: t('actions.redoDescription'),
    category: 'actions',
    keywords: ['redo', 'reapply', 'forward', 'history'],
    shortcut: '⇧⌘Z',
    icon: ICONS.redo,
    action: () => {
      return useHistoryStore.getState().redo() ? t('actions.redone') : t('actions.nothingToRedo')
    },
  },
  {
    id: 'settings-open',
    label: t('actions.openSettings'),
    category: 'actions',
    keywords: ['settings', 'preferences', 'options', 'config'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings')
      return t('actions.openedSettings')
    },
  },
  {
    id: 'toggle-sidebar',
    label: deps.sidebarOpen ? t('actions.hideSidebar') : t('actions.showSidebar'),
    category: 'actions',
    keywords: ['sidebar', 'toggle', 'panel', 'show', 'hide'],
    icon: ICONS.sidebar,
    action: () => {
      deps.toggleSidebar?.()
      return deps.sidebarOpen ? t('actions.sidebarShown') : t('actions.sidebarHidden')
    },
  },
  {
    id: 'toggle-dark-mode',
    label: deps.themeMode === 'dark' ? t('actions.switchToLightMode') : t('actions.switchToDarkMode'),
    category: 'actions',
    keywords: ['dark mode', 'light mode', 'theme', 'toggle', 'appearance'],
    icon: deps.themeMode === 'dark' ? ICONS.sun : ICONS.moon,
    action: () => {
      const newMode: ThemeMode = deps.themeMode === 'dark' ? 'light' : 'dark'
      deps.updateSettings?.({ themeMode: newMode })
      return newMode === 'dark' ? t('actions.switchedToDarkMode') : t('actions.switchedToLightMode')
    },
  },
  {
    id: 'toggle-theme-mode',
    label: t('actions.cycleTheme'),
    description: t('actions.currentThemeMode', {
      mode:
        deps.themeMode === 'auto'
          ? t('actions.themeModeSystem')
          : deps.themeMode === 'dark'
            ? t('actions.themeModeDark')
            : t('actions.themeModeLight'),
    }),
    category: 'actions',
    keywords: ['theme', 'cycle', 'light', 'dark', 'system', 'appearance', 'mode'],
    icon:
      deps.themeMode === 'auto' ? ICONS.system : deps.themeMode === 'dark' ? ICONS.moon : ICONS.sun,
    action: () => {
      const order: ThemeMode[] = ['light', 'dark', 'auto']
      const currentIdx = order.indexOf(deps.themeMode ?? 'auto')
      const nextMode = order[(currentIdx + 1) % order.length]
      deps.updateSettings?.({ themeMode: nextMode })
      const label =
        nextMode === 'auto'
          ? t('actions.themeModeSystem')
          : nextMode === 'dark'
            ? t('actions.themeModeDark')
            : t('actions.themeModeLight')
      return t('actions.themeSetTo', { mode: label })
    },
  },
  {
    id: 'toggle-time-format',
    label:
      deps.timeFormat === '24h' ? t('actions.switchTo12Hour') : t('actions.switchTo24Hour'),
    category: 'actions',
    keywords: ['time format', '12h', '24h', 'clock', 'toggle'],
    icon: ICONS.clock,
    action: () => {
      const newFormat = deps.timeFormat === '24h' ? '12h' : '24h'
      deps.updateSettings?.({ timeFormat: newFormat })
      return t('actions.timeFormatSetTo', { format: newFormat })
    },
  },
  {
    id: 'toggle-category-colors',
    label: deps.useCategoryColors
      ? t('actions.disableCategoryColors')
      : t('actions.enableCategoryColors'),
    category: 'actions',
    keywords: ['category', 'colors', 'toggle', 'calendar color'],
    icon: ICONS.palette,
    action: () => {
      deps.updateSettings?.({ useCategoryColors: !deps.useCategoryColors })
      return deps.useCategoryColors
        ? t('actions.categoryColorsDisabled')
        : t('actions.categoryColorsEnabled')
    },
  },
  {
    id: 'sync-calendars',
    label: t('actions.syncCalendars'),
    category: 'actions',
    keywords: ['sync', 'caldav', 'refresh', 'update'],
    icon: ICONS.sync,
    action: () => {
      deps.triggerSync?.()
      return t('actions.syncingCalendars')
    },
  },
]

const createSettingsCommands = (deps: CommandFactoryDeps): Command[] => [
  {
    id: 'debug-toggle',
    label: t('settings.toggleDebugMode'),
    description: t('settings.toggleDebugModeDescription'),
    category: 'settings',
    keywords: ['debug', 'caldav', 'sync', 'logging', 'console'],
    icon: ICONS.bug,
    action: () => {
      const newValue = !deps.caldavDebugMode
      deps.updateSettings?.({ caldavDebugMode: newValue })
      return newValue ? t('settings.debugModeEnabled') : t('settings.debugModeDisabled')
    },
  },
  {
    id: 'toggle-journal',
    label: deps.journalEnabled ? t('settings.disableJournal') : t('settings.enableJournal'),
    description: t('settings.journalDescription'),
    category: 'settings',
    keywords: ['journal', 'notes', 'diary', 'enable', 'disable'],
    icon: ICONS.calendar,
    action: () => {
      const newValue = !deps.journalEnabled
      deps.updateSettings?.({ journalEnabled: newValue })
      return newValue ? t('settings.journalEnabled') : t('settings.journalDisabled')
    },
  },
  {
    id: 'toggle-contacts',
    label: deps.contactsEnabled ? t('settings.disableContacts') : t('settings.enableContacts'),
    description: t('settings.contactsDescription'),
    category: 'settings',
    keywords: ['contacts', 'people', 'address book', 'enable', 'disable'],
    icon: ICONS.calendar,
    action: () => {
      const newValue = !deps.contactsEnabled
      deps.updateSettings?.({ contactsEnabled: newValue })
      return newValue ? t('settings.contactsEnabled') : t('settings.contactsDisabled')
    },
  },
  {
    id: 'toggle-week-numbers-sidebar',
    label: deps.showWeekNumbersInSidebar
      ? t('settings.hideWeekNumbers')
      : t('settings.showWeekNumbers'),
    description: t('settings.weekNumbersDescription'),
    category: 'settings',
    keywords: ['week', 'numbers', 'sidebar', 'mini calendar', 'iso week'],
    icon: ICONS.sidebar,
    action: () => {
      const newValue = !deps.showWeekNumbersInSidebar
      deps.updateSettings?.({ showWeekNumbersInSidebar: newValue })
      return newValue ? t('settings.weekNumbersShown') : t('settings.weekNumbersHidden')
    },
  },
  {
    id: 'toggle-agenda-below-month',
    label: deps.agendaBelowMonthEnabled
      ? t('settings.disableAgendaBelowMonth')
      : t('settings.enableAgendaBelowMonth'),
    description: t('settings.agendaBelowMonthDescription'),
    category: 'settings',
    keywords: ['agenda', 'month', 'split', 'panel', 'portrait', 'layout'],
    icon: ICONS.sidebar,
    action: () => {
      const newValue = !deps.agendaBelowMonthEnabled
      deps.updateSettings?.({ agendaBelowMonthEnabled: newValue })
      return newValue
        ? t('settings.agendaBelowMonthEnabled')
        : t('settings.agendaBelowMonthDisabled')
    },
  },
  {
    id: 'open-journal',
    label: t('settings.openJournal'),
    description: t('settings.openJournalDescription'),
    category: 'navigation',
    keywords: ['journal', 'notes', 'diary', 'open', 'navigate'],
    icon: ICONS.calendar,
    action: () => {
      deps.navigate('/journal')
      return t('settings.openedJournal')
    },
  },
  {
    id: 'new-journal-entry',
    label: t('settings.newJournalEntry'),
    description: t('settings.newJournalEntryDescription'),
    category: 'actions',
    keywords: ['journal', 'notes', 'diary', 'new', 'create', 'add'],
    icon: ICONS.plus,
    action: () => {
      const today = toLocalDateString(new Date())
      deps.openJournalModal(today, true)
    },
  },
  {
    id: 'export-journal',
    label: t('settings.exportJournal'),
    description: t('settings.exportJournalDescription'),
    category: 'actions',
    keywords: ['journal', 'export', 'markdown', 'download', 'backup'],
    icon: ICONS.calendar,
    action: () => {
      const events = useCalendarStore.getState().events
      const journalEntries = events
        .filter((e) => e.type === 'journal')
        .sort((a, b) => b.start.localeCompare(a.start))

      if (journalEntries.length === 0) {
        return t('settings.noJournalEntriesToExport')
      }

      // Exported document content stays in English regardless of UI locale —
      // this is the exported file's own content, not app UI chrome.
      let md = '# Journal\n\n'
      let currentDate = ''

      for (const entry of journalEntries) {
        if (entry.start !== currentDate) {
          currentDate = entry.start
          md += `\n## ${currentDate}\n\n`
        }
        if (entry.title) {
          md += `### ${entry.title}\n\n`
        }
        if (entry.description) {
          md += `${entry.description}\n\n`
        }
        if (entry.categories && entry.categories.length > 0) {
          md += `*Categories: ${entry.categories.join(', ')}*\n\n`
        }
      }

      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `journal-export-${new Date().toISOString().split('T')[0]}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      return t('settings.exportedJournalEntries', { count: journalEntries.length })
    },
  },
  {
    id: 'settings-general',
    label: t('settings.generalSettings'),
    category: 'settings',
    keywords: ['general', 'general settings'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=general')
      return t('settings.openedGeneralSettings')
    },
  },
  {
    id: 'settings-theme',
    label: t('settings.themeSettings'),
    category: 'settings',
    keywords: ['theme', 'dark mode', 'light mode', 'appearance'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=theme')
      return t('settings.openedThemeSettings')
    },
  },
  {
    id: 'settings-calendars',
    label: t('settings.calendarSettings'),
    category: 'settings',
    keywords: ['calendars', 'calendar settings'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=calendar')
      return t('settings.openedCalendarSettings')
    },
  },
  {
    id: 'settings-events',
    label: t('settings.eventSettings'),
    category: 'settings',
    keywords: ['event defaults', 'event settings'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=events')
      return t('settings.openedEventSettings')
    },
  },
  {
    id: 'settings-sync',
    label: t('settings.syncSettings'),
    category: 'settings',
    keywords: ['sync settings', 'caldav', 'account'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=caldav')
      return t('settings.openedSyncSettings')
    },
  },
  {
    id: 'settings-data',
    label: t('settings.dataSettings'),
    category: 'settings',
    keywords: ['data', 'import', 'export', 'backup'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=data')
      return t('settings.openedDataSettings')
    },
  },
]

export const createCommandRegistry = (deps: CommandFactoryDeps): Command[] => [
  ...createActionCommands(deps),
  ...createNavigationCommands(deps),
  ...createSettingsCommands(deps),
]
