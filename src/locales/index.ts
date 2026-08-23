/**
 * Translation catalogs, statically imported.
 *
 * Calino is local-first, so catalogs are bundled rather than fetched: an
 * i18next backend plugin would break offline use, the Android WebView (which
 * serves from `https://localhost`), and the headless sync entry.
 */
import enCommon from './en/common.json'
import enCalendar from './en/calendar.json'
import enSettings from './en/settings.json'
import enContacts from './en/contacts.json'
import enCaldav from './en/caldav.json'
import enErrors from './en/errors.json'
import enCommands from './en/commands.json'

import daCommon from './da/common.json'
import daCalendar from './da/calendar.json'
import daSettings from './da/settings.json'
import daContacts from './da/contacts.json'
import daCaldav from './da/caldav.json'
import daErrors from './da/errors.json'
import daCommands from './da/commands.json'

import deCommon from './de/common.json'
import deCalendar from './de/calendar.json'
import deSettings from './de/settings.json'
import deContacts from './de/contacts.json'
import deCaldav from './de/caldav.json'
import deErrors from './de/errors.json'
import deCommands from './de/commands.json'

/** Namespace names, in the order they appear in each locale directory. */
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

/** The namespace used when a `t()` call doesn't name one. */
export const DEFAULT_NAMESPACE: Namespace = 'common'

export const resources = {
  en: {
    common: enCommon,
    calendar: enCalendar,
    settings: enSettings,
    contacts: enContacts,
    caldav: enCaldav,
    errors: enErrors,
    commands: enCommands,
  },
  da: {
    common: daCommon,
    calendar: daCalendar,
    settings: daSettings,
    contacts: daContacts,
    caldav: daCaldav,
    errors: daErrors,
    commands: daCommands,
  },
  de: {
    common: deCommon,
    calendar: deCalendar,
    settings: deSettings,
    contacts: deContacts,
    caldav: deCaldav,
    errors: deErrors,
    commands: deCommands,
  },
} as const
