export const config = {
  appName: 'Calino',
  appDescription: 'A local-first calendar with CalDAV sync',
  githubRepo: 'ivan-malinovski/Calino',
  contactEmail: 'calendar@malinov.ski',
  websiteUrl: 'https://calino.io',
  privacyPolicyUrl: '/privacy',
  defaultView: 'month' as const,
} as const

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
] as const

export type AppConfig = typeof config
