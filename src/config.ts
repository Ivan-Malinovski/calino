export const config = {
  appName: 'Calino',
  appDescription: 'An easy, private, local web calendar with CalDAV sync. Your data on your terms.',
  appVersion: __APP_VERSION__,
  githubRepo: import.meta.env.CALINO_GITHUB_REPO || 'ivan-malinovski/Calino',
  contactEmail: import.meta.env.CALINO_CONTACT_EMAIL || 'calendar@malinov.ski',
  websiteUrl: import.meta.env.VITE_SITE_URL || 'https://calino.io',
  privacyPolicyUrl: '/privacy',
  defaultView: 'month' as const,
  defaultLightTheme: 'built-in',
  defaultDarkTheme: 'built-in',
  enableServiceWorker: import.meta.env.CALINO_ENABLE_SW === 'true',
}

export const DEFAULT_CALENDAR_COLOR = '#4285F4'

export const CALENDAR_COLORS = [
  '#4285F4',
  '#EA4335',
  '#FBBC05',
  '#34A853',
  '#FF6D01',
  '#46BDC6',
  '#7B1FA2',
  '#C2185B',
  '#00796B',
  '#F57C00',
  '#455A64',
  '#5D4037',
] as const

export const EVENT_COLORS = [...CALENDAR_COLORS, '#9334E6'] as const

export const MOBILE_BREAKPOINT = 768
export const COMPACT_MOBILE_BREAKPOINT = 500
export const TABLET_BREAKPOINT = 1220
export const TOAST_DURATION_MS = 5000

export type AppConfig = typeof config
