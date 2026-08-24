/**
 * Translation catalogs. English is the synchronous fallback; other languages
 * are local Vite chunks loaded before they become active, preserving offline use.
 */
import enCommon from './en/common.json'
import enCalendar from './en/calendar.json'
import enSettings from './en/settings.json'
import enContacts from './en/contacts.json'
import enCaldav from './en/caldav.json'
import enErrors from './en/errors.json'
import enCommands from './en/commands.json'
import type { Language } from '@/types'

export const NAMESPACES = [
  'common',
  'calendar',
  'settings',
  'contacts',
  'caldav',
  'errors',
  'commands',
] as const

export type Namespace = (typeof NAMESPACES)[number]
export type LocaleResources = Record<Namespace, Record<string, unknown>>
export const DEFAULT_NAMESPACE: Namespace = 'common'

const englishResources: LocaleResources = {
  common: enCommon,
  calendar: enCalendar,
  settings: enSettings,
  contacts: enContacts,
  caldav: enCaldav,
  errors: enErrors,
  commands: enCommands,
}

/** Catalogs currently available to i18next. English is always present. */
export const resources: Partial<Record<Language, LocaleResources>> = { en: englishResources }

const loaders: Record<Exclude<Language, 'en'>, () => Promise<LocaleResources>> = {
  da: async () => {
    const [common, calendar, settings, contacts, caldav, errors, commands] = await Promise.all([
      import('./da/common.json'),
      import('./da/calendar.json'),
      import('./da/settings.json'),
      import('./da/contacts.json'),
      import('./da/caldav.json'),
      import('./da/errors.json'),
      import('./da/commands.json'),
    ])
    return {
      common: common.default,
      calendar: calendar.default,
      settings: settings.default,
      contacts: contacts.default,
      caldav: caldav.default,
      errors: errors.default,
      commands: commands.default,
    }
  },
  de: async () => {
    const [common, calendar, settings, contacts, caldav, errors, commands] = await Promise.all([
      import('./de/common.json'),
      import('./de/calendar.json'),
      import('./de/settings.json'),
      import('./de/contacts.json'),
      import('./de/caldav.json'),
      import('./de/errors.json'),
      import('./de/commands.json'),
    ])
    return {
      common: common.default,
      calendar: calendar.default,
      settings: settings.default,
      contacts: contacts.default,
      caldav: caldav.default,
      errors: errors.default,
      commands: commands.default,
    }
  },
}

const pendingLoads = new Map<Language, Promise<LocaleResources>>()

export async function loadLanguageResources(language: Language): Promise<LocaleResources> {
  const loaded = resources[language]
  if (loaded) return loaded
  if (language === 'en') return englishResources

  const existing = pendingLoads.get(language)
  if (existing) return existing

  const pending = loaders[language]()
    .then((catalog: LocaleResources) => {
      resources[language] = catalog
      return catalog
    })
    .finally(() => {
      if (pendingLoads.get(language) === pending) pendingLoads.delete(language)
    })
  pendingLoads.set(language, pending)
  return pending
}
