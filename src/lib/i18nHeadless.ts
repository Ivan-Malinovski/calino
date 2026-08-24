/**
 * Small, read-only i18n instance for the Android background-sync WebView.
 *
 * The headless entry must not import the foreground settings store or the full
 * catalog bundle. It reads only the persisted language preference and loads
 * the namespaces needed by its user-visible status messages.
 */
import i18next, { type i18n as I18nInstance } from 'i18next'
import { FALLBACK_LANGUAGE, normalizeLanguage, SUPPORTED_LANGUAGES } from '@/lib/languages'
import type { Language } from '@/types'

type HeadlessResources = { common: Record<string, unknown>; errors: Record<string, unknown> }

const resourceLoaders: Record<Language, () => Promise<HeadlessResources>> = {
  en: async () => {
    const [common, errors] = await Promise.all([
      import('@/locales/en/common.json'),
      import('@/locales/en/errors.json'),
    ])
    return { common: common.default, errors: errors.default }
  },
  da: async () => {
    const [common, errors] = await Promise.all([
      import('@/locales/da/common.json'),
      import('@/locales/da/errors.json'),
    ])
    return { common: common.default, errors: errors.default }
  },
  de: async () => {
    const [common, errors] = await Promise.all([
      import('@/locales/de/common.json'),
      import('@/locales/de/errors.json'),
    ])
    return { common: common.default, errors: errors.default }
  },
}

function readPersistedLanguage(): Language {
  try {
    const raw = localStorage.getItem('calino-settings')
    if (!raw) return FALLBACK_LANGUAGE
    const state = (JSON.parse(raw) as { state?: { language?: unknown } }).state
    return (
      normalizeLanguage(typeof state?.language === 'string' ? state.language : null) ??
      FALLBACK_LANGUAGE
    )
  } catch {
    return FALLBACK_LANGUAGE
  }
}

export async function initHeadlessI18n(): Promise<I18nInstance> {
  const instance = i18next.createInstance()
  const language = readPersistedLanguage()
  const languages =
    language === FALLBACK_LANGUAGE ? [FALLBACK_LANGUAGE] : [FALLBACK_LANGUAGE, language]
  const loaded = await Promise.all(
    languages.map(async (lng) => [lng, await resourceLoaders[lng]()] as const)
  )
  const resources = Object.fromEntries(loaded)
  await instance.init({
    resources,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: ['common', 'errors'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  return instance
}
