import type { Command, CommandCategory } from '../types'

export type { Command, CommandCategory }
import { addDays, addWeeks, addMonths, subWeeks, subMonths, format } from 'date-fns'
import type { ThemeMode } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import { useHistoryStore } from '@/store/historyStore'

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
      label: 'Go to Today',
      description: () => format(new Date(), 'EEEE, d MMMM yyyy'),
      category: 'navigation',
      keywords: ['today', 'current', 'now', 'home'],
      shortcut: 'T',
      icon: ICONS.calendar,
      action: () => {
        const today = new Date()
        deps.setCurrentDate(format(today, 'yyyy-MM-dd'))
        return 'Navigated to today'
      },
    },
    {
      id: 'nav-tomorrow',
      label: 'Go to Tomorrow',
      description: () => format(addDays(new Date(), 1), 'EEEE, d MMMM yyyy'),
      category: 'navigation',
      keywords: ['tomorrow', 'next day'],
      icon: ICONS.chevronRight,
      action: () => {
        const tomorrow = addDays(new Date(), 1)
        deps.setCurrentDate(format(tomorrow, 'yyyy-MM-dd'))
        return 'Navigated to tomorrow'
      },
    },
    {
      id: 'nav-next-week',
      label: 'Next Week',
      description: () => {
        const next = addWeeks(new Date(), 1)
        return `${format(next, 'd MMM')} – ${format(next, 'd MMM')}`
      },
      category: 'navigation',
      keywords: ['next week', 'forward'],
      icon: ICONS.skipForward,
      shortcut: ']',
      action: () => {
        const next = addWeeks(new Date(), 1)
        deps.setCurrentDate(format(next, 'yyyy-MM-dd'))
        return 'Navigated to next week'
      },
    },
    {
      id: 'nav-prev-week',
      label: 'Previous Week',
      description: () => {
        const prev = subWeeks(new Date(), 1)
        return `${format(prev, 'd MMM')} – ${format(prev, 'd MMM')}`
      },
      category: 'navigation',
      keywords: ['previous week', 'last week', 'back'],
      icon: ICONS.skipBack,
      shortcut: '[',
      action: () => {
        const prev = subWeeks(new Date(), 1)
        deps.setCurrentDate(format(prev, 'yyyy-MM-dd'))
        return 'Navigated to previous week'
      },
    },
    {
      id: 'nav-next-month',
      label: 'Next Month',
      description: () => format(addMonths(new Date(), 1), 'MMMM yyyy'),
      category: 'navigation',
      keywords: ['next month'],
      icon: ICONS.skipForward,
      shortcut: '⇧]',
      action: () => {
        const next = addMonths(new Date(), 1)
        deps.setCurrentDate(format(next, 'yyyy-MM-dd'))
        return 'Navigated to next month'
      },
    },
    {
      id: 'nav-prev-month',
      label: 'Previous Month',
      description: () => format(subMonths(new Date(), 1), 'MMMM yyyy'),
      category: 'navigation',
      keywords: ['previous month', 'last month'],
      icon: ICONS.skipBack,
      shortcut: '⇧[',
      action: () => {
        const prev = subMonths(new Date(), 1)
        deps.setCurrentDate(format(prev, 'yyyy-MM-dd'))
        return 'Navigated to previous month'
      },
    },
    {
      id: 'view-month',
      label: 'Month View',
      category: 'navigation',
      keywords: ['month view', 'month', 'calendar'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('month')
        deps.navigate('/month')
        return 'Switched to month view'
      },
    },
    {
      id: 'view-week',
      label: 'Week View',
      category: 'navigation',
      keywords: ['week view', 'week'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('week')
        deps.navigate('/week')
        return 'Switched to week view'
      },
    },
    {
      id: 'view-day',
      label: 'Day View',
      category: 'navigation',
      keywords: ['day view', 'day', 'today'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('day')
        deps.navigate('/day')
        return 'Switched to day view'
      },
    },
    {
      id: 'view-agenda',
      label: 'Agenda View',
      category: 'navigation',
      keywords: ['agenda view', 'agenda', 'list'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('agenda')
        deps.navigate('/agenda')
        return 'Switched to agenda view'
      },
    },
    {
      id: 'view-tasks',
      label: 'Tasks View',
      category: 'navigation',
      keywords: ['tasks view', 'tasks', 'todo', 'task list'],
      icon: ICONS.calendar,
      action: () => {
        deps.setCurrentView('todo')
        deps.navigate('/tasks')
        return 'Switched to tasks view'
      },
    },
  ]
}

const createActionCommands = (deps: CommandFactoryDeps): Command[] => [
  {
    id: 'action-new-event',
    label: 'Create Event',
    category: 'actions',
    keywords: ['new event', 'create', 'add', 'event'],
    shortcut: 'C',
    icon: ICONS.plus,
    action: () => {
      deps.openModal()
      return 'Event modal opened'
    },
  },
  {
    id: 'action-new-task',
    label: 'New Task',
    category: 'actions',
    keywords: ['new task', 'task', 'todo'],
    shortcut: 'K',
    icon: ICONS.circle,
    action: () => {
      deps.openModal(undefined, undefined, undefined, 'task')
      return 'Task modal opened'
    },
  },
  {
    id: 'action-undo',
    label: 'Undo',
    description: 'Revert the last change to your events',
    category: 'actions',
    keywords: ['undo', 'revert', 'back', 'history'],
    shortcut: '⌘Z',
    icon: ICONS.undo,
    action: () => {
      return useHistoryStore.getState().undo() ? 'Undone' : 'Nothing to undo'
    },
  },
  {
    id: 'action-redo',
    label: 'Redo',
    description: 'Reapply the last undone change',
    category: 'actions',
    keywords: ['redo', 'reapply', 'forward', 'history'],
    shortcut: '⇧⌘Z',
    icon: ICONS.redo,
    action: () => {
      return useHistoryStore.getState().redo() ? 'Redone' : 'Nothing to redo'
    },
  },
  {
    id: 'settings-open',
    label: 'Open Settings',
    category: 'actions',
    keywords: ['settings', 'preferences', 'options', 'config'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings')
      return 'Opened settings'
    },
  },
  {
    id: 'toggle-sidebar',
    label: deps.sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
    category: 'actions',
    keywords: ['sidebar', 'toggle', 'panel', 'show', 'hide'],
    icon: ICONS.sidebar,
    action: () => {
      deps.toggleSidebar?.()
      return deps.sidebarOpen ? 'Sidebar shown' : 'Sidebar hidden'
    },
  },
  {
    id: 'toggle-dark-mode',
    label: deps.themeMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
    category: 'actions',
    keywords: ['dark mode', 'light mode', 'theme', 'toggle', 'appearance'],
    icon: deps.themeMode === 'dark' ? ICONS.sun : ICONS.moon,
    action: () => {
      const newMode: ThemeMode = deps.themeMode === 'dark' ? 'light' : 'dark'
      deps.updateSettings?.({ themeMode: newMode })
      return `Switched to ${newMode} mode`
    },
  },
  {
    id: 'toggle-theme-mode',
    label: 'Cycle Theme (Light → Dark → System)',
    description: `Current: ${deps.themeMode === 'auto' ? 'System' : deps.themeMode === 'dark' ? 'Dark' : 'Light'}`,
    category: 'actions',
    keywords: ['theme', 'cycle', 'light', 'dark', 'system', 'appearance', 'mode'],
    icon:
      deps.themeMode === 'auto' ? ICONS.system : deps.themeMode === 'dark' ? ICONS.moon : ICONS.sun,
    action: () => {
      const order: ThemeMode[] = ['light', 'dark', 'auto']
      const currentIdx = order.indexOf(deps.themeMode ?? 'auto')
      const nextMode = order[(currentIdx + 1) % order.length]
      deps.updateSettings?.({ themeMode: nextMode })
      const label = nextMode === 'auto' ? 'System' : nextMode === 'dark' ? 'Dark' : 'Light'
      return `Theme set to ${label}`
    },
  },
  {
    id: 'toggle-time-format',
    label: deps.timeFormat === '24h' ? 'Switch to 12-hour Format' : 'Switch to 24-hour Format',
    category: 'actions',
    keywords: ['time format', '12h', '24h', 'clock', 'toggle'],
    icon: ICONS.clock,
    action: () => {
      const newFormat = deps.timeFormat === '24h' ? '12h' : '24h'
      deps.updateSettings?.({ timeFormat: newFormat })
      return `Time format set to ${newFormat}`
    },
  },
  {
    id: 'toggle-category-colors',
    label: deps.useCategoryColors ? 'Disable Category Colors' : 'Enable Category Colors',
    category: 'actions',
    keywords: ['category', 'colors', 'toggle', 'calendar color'],
    icon: ICONS.palette,
    action: () => {
      deps.updateSettings?.({ useCategoryColors: !deps.useCategoryColors })
      return deps.useCategoryColors ? 'Category colors disabled' : 'Category colors enabled'
    },
  },
  {
    id: 'sync-calendars',
    label: 'Sync Calendars',
    category: 'actions',
    keywords: ['sync', 'caldav', 'refresh', 'update'],
    icon: ICONS.sync,
    action: () => {
      deps.triggerSync?.()
      return 'Syncing calendars...'
    },
  },
]

const createSettingsCommands = (deps: CommandFactoryDeps): Command[] => [
  {
    id: 'debug-toggle',
    label: 'Toggle CalDAV Debug Mode',
    description: 'Enable or disable CalDAV sync debug logging',
    category: 'settings',
    keywords: ['debug', 'caldav', 'sync', 'logging', 'console'],
    icon: ICONS.bug,
    action: () => {
      const newValue = !deps.caldavDebugMode
      deps.updateSettings?.({ caldavDebugMode: newValue })
      return newValue ? 'CalDAV debug mode enabled' : 'CalDAV debug mode disabled'
    },
  },
  {
    id: 'toggle-journal',
    label: deps.journalEnabled ? 'Disable Journal' : 'Enable Journal',
    description: 'Attach freeform notes to days in your calendar',
    category: 'settings',
    keywords: ['journal', 'notes', 'diary', 'enable', 'disable'],
    icon: ICONS.calendar,
    action: () => {
      const newValue = !deps.journalEnabled
      deps.updateSettings?.({ journalEnabled: newValue })
      return newValue ? 'Journal enabled' : 'Journal disabled'
    },
  },
  {
    id: 'toggle-contacts',
    label: deps.contactsEnabled ? 'Disable Contacts' : 'Enable Contacts',
    description: 'Show and manage contacts in your calendar',
    category: 'settings',
    keywords: ['contacts', 'people', 'address book', 'enable', 'disable'],
    icon: ICONS.calendar,
    action: () => {
      const newValue = !deps.contactsEnabled
      deps.updateSettings?.({ contactsEnabled: newValue })
      return newValue ? 'Contacts enabled' : 'Contacts disabled'
    },
  },
  {
    id: 'toggle-week-numbers-sidebar',
    label: deps.showWeekNumbersInSidebar
      ? 'Hide Week Numbers in Sidebar'
      : 'Show Week Numbers in Sidebar',
    description: 'Display ISO week numbers next to each row in the mini calendar',
    category: 'settings',
    keywords: ['week', 'numbers', 'sidebar', 'mini calendar', 'iso week'],
    icon: ICONS.sidebar,
    action: () => {
      const newValue = !deps.showWeekNumbersInSidebar
      deps.updateSettings?.({ showWeekNumbersInSidebar: newValue })
      return newValue ? 'Week numbers shown in sidebar' : 'Week numbers hidden in sidebar'
    },
  },
  {
    id: 'toggle-agenda-below-month',
    label: deps.agendaBelowMonthEnabled
      ? 'Disable Agenda Below Month View'
      : 'Enable Agenda Below Month View',
    description: 'On tall, portrait-oriented screens, show an agenda panel below the month grid',
    category: 'settings',
    keywords: ['agenda', 'month', 'split', 'panel', 'portrait', 'layout'],
    icon: ICONS.sidebar,
    action: () => {
      const newValue = !deps.agendaBelowMonthEnabled
      deps.updateSettings?.({ agendaBelowMonthEnabled: newValue })
      return newValue ? 'Agenda below month view enabled' : 'Agenda below month view disabled'
    },
  },
  {
    id: 'open-journal',
    label: 'Open Journal',
    description: 'Navigate to the Journal view',
    category: 'navigation',
    keywords: ['journal', 'notes', 'diary', 'open', 'navigate'],
    icon: ICONS.calendar,
    action: () => {
      deps.navigate('/journal')
      return 'Opened Journal'
    },
  },
  {
    id: 'new-journal-entry',
    label: 'New Journal Entry',
    description: 'Create a new journal entry for today',
    category: 'actions',
    keywords: ['journal', 'notes', 'diary', 'new', 'create', 'add'],
    icon: ICONS.plus,
    action: () => {
      const today = new Date().toISOString().split('T')[0]
      deps.openJournalModal(today, true)
    },
  },
  {
    id: 'export-journal',
    label: 'Export Journal as Markdown',
    description: 'Download all journal entries as a .md file',
    category: 'actions',
    keywords: ['journal', 'export', 'markdown', 'download', 'backup'],
    icon: ICONS.calendar,
    action: () => {
      const events = useCalendarStore.getState().events
      const journalEntries = events
        .filter((e) => e.type === 'journal')
        .sort((a, b) => b.start.localeCompare(a.start))

      if (journalEntries.length === 0) {
        return 'No journal entries to export'
      }

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

      return `Exported ${journalEntries.length} journal entries`
    },
  },
  {
    id: 'settings-general',
    label: 'General Settings',
    category: 'settings',
    keywords: ['general', 'general settings'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=general')
      return 'Opened general settings'
    },
  },
  {
    id: 'settings-theme',
    label: 'Theme Settings',
    category: 'settings',
    keywords: ['theme', 'dark mode', 'light mode', 'appearance'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=theme')
      return 'Opened theme settings'
    },
  },
  {
    id: 'settings-calendars',
    label: 'Calendar Settings',
    category: 'settings',
    keywords: ['calendars', 'calendar settings'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=calendar')
      return 'Opened calendar settings'
    },
  },
  {
    id: 'settings-events',
    label: 'Event Settings',
    category: 'settings',
    keywords: ['event defaults', 'event settings'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=events')
      return 'Opened event settings'
    },
  },
  {
    id: 'settings-sync',
    label: 'Sync Settings',
    category: 'settings',
    keywords: ['sync settings', 'caldav', 'account'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=caldav')
      return 'Opened sync settings'
    },
  },
  {
    id: 'settings-data',
    label: 'Data Settings',
    category: 'settings',
    keywords: ['data', 'import', 'export', 'backup'],
    icon: ICONS.settings,
    action: () => {
      deps.navigate('/settings?tab=data')
      return 'Opened data settings'
    },
  },
]

export const createCommandRegistry = (deps: CommandFactoryDeps): Command[] => [
  ...createActionCommands(deps),
  ...createNavigationCommands(deps),
  ...createSettingsCommands(deps),
]

