import type { Command, CommandCategory } from '../types'

export type { Command, CommandCategory }
import { addDays, addWeeks, addMonths, subWeeks, subMonths, format } from 'date-fns'
import type { ThemeMode } from '@/types'

interface CommandFactoryDeps {
  navigate: (path: string) => void
  setCurrentView: (view: 'month' | 'week' | 'day' | 'agenda') => void
  setCurrentDate: (date: string) => void
  openModal: (date?: string, endDate?: string) => void
  toggleSidebar?: () => void
  triggerSync?: () => void
  themeMode?: ThemeMode
  updateSettings?: (
    settings: Partial<{ themeMode: ThemeMode; lightTheme: string; darkTheme: string }>
  ) => void
}

const createNavigationCommands = (deps: CommandFactoryDeps): Command[] => [
  {
    id: 'nav-today',
    label: 'Go to Today',
    description: 'Navigate to the current date',
    category: 'navigation',
    keywords: ['today', 'current', 'now', 'home'],
    shortcut: 'T',
    icon: '📅',
    action: () => {
      deps.setCurrentDate(format(new Date(), 'yyyy-MM-dd'))
      return 'Navigated to today'
    },
  },
  {
    id: 'nav-tomorrow',
    label: 'Go to Tomorrow',
    description: 'Navigate to tomorrow',
    category: 'navigation',
    keywords: ['tomorrow', 'next day'],
    icon: '➡️',
    action: () => {
      deps.setCurrentDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
      return 'Navigated to tomorrow'
    },
  },
  {
    id: 'nav-next-week',
    label: 'Next Week',
    description: 'Go to next week',
    category: 'navigation',
    keywords: ['next week', 'forward'],
    icon: '⏩',
    action: () => {
      deps.setCurrentDate(format(addWeeks(new Date(), 1), 'yyyy-MM-dd'))
      return 'Navigated to next week'
    },
  },
  {
    id: 'nav-prev-week',
    label: 'Previous Week',
    description: 'Go to previous week',
    category: 'navigation',
    keywords: ['previous week', 'last week', 'back'],
    icon: '⏪',
    action: () => {
      deps.setCurrentDate(format(subWeeks(new Date(), 1), 'yyyy-MM-dd'))
      return 'Navigated to previous week'
    },
  },
  {
    id: 'nav-next-month',
    label: 'Next Month',
    description: 'Go to next month',
    category: 'navigation',
    keywords: ['next month'],
    icon: '🗓️',
    action: () => {
      deps.setCurrentDate(format(addMonths(new Date(), 1), 'yyyy-MM-dd'))
      return 'Navigated to next month'
    },
  },
  {
    id: 'nav-prev-month',
    label: 'Previous Month',
    description: 'Go to previous month',
    category: 'navigation',
    keywords: ['previous month', 'last month'],
    icon: '🗓️',
    action: () => {
      deps.setCurrentDate(format(subMonths(new Date(), 1), 'yyyy-MM-dd'))
      return 'Navigated to previous month'
    },
  },
  {
    id: 'view-month',
    label: 'Switch to Month View',
    description: 'Change calendar view to month',
    category: 'navigation',
    keywords: ['month view', 'month', 'calendar'],
    icon: '📆',
    action: () => {
      deps.setCurrentView('month')
      return 'Switched to month view'
    },
  },
  {
    id: 'view-week',
    label: 'Switch to Week View',
    description: 'Change calendar view to week',
    category: 'navigation',
    keywords: ['week view', 'week'],
    icon: '📅',
    action: () => {
      deps.setCurrentView('week')
      return 'Switched to week view'
    },
  },
  {
    id: 'view-day',
    label: 'Switch to Day View',
    description: 'Change calendar view to day',
    category: 'navigation',
    keywords: ['day view', 'day', 'today'],
    icon: '📋',
    action: () => {
      deps.setCurrentView('day')
      return 'Switched to day view'
    },
  },
  {
    id: 'view-agenda',
    label: 'Switch to Agenda View',
    description: 'Change calendar view to agenda',
    category: 'navigation',
    keywords: ['agenda view', 'agenda', 'list'],
    icon: '📝',
    action: () => {
      deps.setCurrentView('agenda')
      return 'Switched to agenda view'
    },
  },
]

const createActionCommands = (deps: CommandFactoryDeps): Command[] => [
  {
    id: 'action-new-event',
    label: 'Create New Event',
    description: 'Open the event creation modal',
    category: 'actions',
    keywords: ['new event', 'create', 'add', 'event'],
    shortcut: 'N',
    icon: '➕',
    action: () => {
      deps.openModal()
      return 'Event modal opened'
    },
  },
  {
    id: 'action-sync',
    label: 'Sync Now',
    description: 'Trigger CalDAV synchronization',
    category: 'actions',
    keywords: ['sync', 'synchronize', 'refresh'],
    icon: '🔄',
    action: () => {
      deps.triggerSync?.()
      return 'Sync started'
    },
  },
  {
    id: 'action-toggle-sidebar',
    label: 'Toggle Sidebar',
    description: 'Show or hide the sidebar',
    category: 'actions',
    keywords: ['sidebar', 'toggle', 'hide', 'show'],
    shortcut: 'B',
    icon: '📱',
    action: () => {
      deps.toggleSidebar?.()
      return 'Sidebar toggled'
    },
  },
]

const createSettingsCommands = (deps: CommandFactoryDeps): Command[] => [
  {
    id: 'settings-open',
    label: 'Open Settings',
    description: 'Go to application settings',
    category: 'settings',
    keywords: ['settings', 'preferences', 'options', 'config'],
    shortcut: ',',
    icon: '⚙️',
    action: () => {
      deps.navigate('/settings')
      return 'Opened settings'
    },
  },
  {
    id: 'settings-general',
    label: 'General Settings',
    description: 'Change general preferences',
    category: 'settings',
    keywords: ['general', 'general settings'],
    icon: '⚙️',
    action: () => {
      deps.navigate('/settings?tab=general')
      return 'Opened general settings'
    },
  },
  {
    id: 'settings-calendars',
    label: 'Calendar Settings',
    description: 'Manage calendars',
    category: 'settings',
    keywords: ['calendars', 'calendar settings'],
    icon: '📅',
    action: () => {
      deps.navigate('/settings?tab=calendars')
      return 'Opened calendar settings'
    },
  },
  {
    id: 'settings-notifications',
    label: 'Notification Settings',
    description: 'Configure notifications',
    category: 'settings',
    keywords: ['notifications', 'alerts', 'reminders'],
    icon: '🔔',
    action: () => {
      deps.navigate('/settings?tab=notifications')
      return 'Opened notification settings'
    },
  },
  {
    id: 'settings-sync',
    label: 'Sync Settings',
    description: 'Configure CalDAV sync',
    category: 'settings',
    keywords: ['sync settings', 'caldav', 'account'],
    icon: '🔗',
    action: () => {
      deps.navigate('/settings?tab=sync')
      return 'Opened sync settings'
    },
  },
  {
    id: 'settings-theme',
    label: 'Theme Settings',
    description: 'Change theme and dark mode',
    category: 'settings',
    keywords: ['theme', 'dark mode', 'light mode', 'appearance'],
    icon: '🎨',
    action: () => {
      deps.navigate('/settings?tab=theme')
      return 'Opened theme settings'
    },
  },
  {
    id: 'theme-toggle-dark',
    label: 'Toggle Dark Mode',
    description: 'Switch between light and dark themes',
    category: 'settings',
    keywords: ['dark mode', 'light mode', 'theme', 'toggle'],
    icon: '🌓',
    action: () => {
      const modes: ThemeMode[] = ['light', 'dark', 'auto']
      const currentMode = deps.themeMode || 'auto'
      const currentIndex = modes.indexOf(currentMode)
      const nextMode = modes[(currentIndex + 1) % modes.length]
      deps.updateSettings?.({ themeMode: nextMode })
      const modeLabels = { light: 'Light', dark: 'Dark', auto: 'System' }
      return `Switched to ${modeLabels[nextMode]} mode`
    },
  },
]

export const createCommandRegistry = (deps: CommandFactoryDeps): Command[] => [
  ...createNavigationCommands(deps),
  ...createActionCommands(deps),
  ...createSettingsCommands(deps),
]

export const getCommandsByCategory = (commands: Command[]): Record<CommandCategory, Command[]> => {
  return commands.reduce(
    (acc, cmd) => {
      if (!acc[cmd.category]) {
        acc[cmd.category] = []
      }
      acc[cmd.category].push(cmd)
      return acc
    },
    {} as Record<CommandCategory, Command[]>
  )
}
