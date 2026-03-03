export const config = {
  appName: 'Calino',
  appDescription: 'A local-first calendar with CalDAV sync',
  githubRepo: 'ivan-malinovski/Calino',
  contactEmail: 'calendar@malinov.ski',
  websiteUrl: 'https://calino.io',
  privacyPolicyUrl: '/privacy',
  defaultView: 'month' as const,
} as const

export type AppConfig = typeof config
