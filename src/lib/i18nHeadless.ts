/**
 * Small, read-only i18n instance for the Android background-sync WebView.
 *
 * The headless entry must not import the foreground settings store or the full
 * catalog bundle. It reads only the persisted language preference and loads
 * the namespaces needed by its user-visible status messages.
 */
import i18next, { type i18n as I18nInstance } from 'i18next'
import enCommon from '@/locales/en/common.json'
import enErrors from '@/locales/en/errors.json'
import daCommon from '@/locales/da/common.json'
import daErrors from '@/locales/da/errors.json'
import deCommon from '@/locales/de/common.json'
import deErrors from '@/locales/de/errors.json'
import { FALLBACK_LANGUAGE, normalizeLanguage } from '@/lib/languages'
import type { Language } from '@/types'

const resources = {
  en: { common: enCommon, errors: enErrors },
  da: { common: daCommon, errors: daErrors },
  de: { common: deCommon, errors: deErrors },
} as const

function readPersistedLanguage(): Language {
  try {
    const raw = localStorage.getItem('calino-settings')
    if (!raw) return FALLBACK_LANGUAGE
    const state = (JSON.parse(raw) as { state?: { language?: unknown } }).state
    return normalizeLanguage(typeof state?.language === 'string' ? state.language : null) ?? FALLBACK_LANGUAGE
  } catch {
    return FALLBACK_LANGUAGE
  }
}

export async function initHeadlessI18n(): Promise<I18nInstance> {
  const instance = i18next.createInstance()
  await instance.init({
    resources,
    lng: readPersistedLanguage(),
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: Object.keys(resources),
    ns: ['common', 'errors'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  return instance
}
