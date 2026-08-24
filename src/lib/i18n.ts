/**
 * i18next singleton.
 *
 * Imported for its side effect from `src/main.tsx` *before* `App`, so that
 * `useTranslation()` works in every component without an `I18nextProvider`.
 * That matters here: most component tests render bare, without the
 * `src/test/caldavRender.tsx` wrapper, and a provider would force all of them
 * to be migrated.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources, NAMESPACES, DEFAULT_NAMESPACE, loadLanguageResources } from '@/locales'
import {
  FALLBACK_LANGUAGE,
  getBrowserLanguage,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
} from '@/lib/languages'
import type { Language } from '@/types'

let initialized = false
let languageRequest = 0

/**
 * Initialize i18next. Safe to call more than once — later calls are ignored,
 * which keeps the test setup file and `main.tsx` from fighting each other.
 *
 * `lng` is passed explicitly rather than left to a browser-language detector:
 * the persisted `settings.language` is the authority, and the store has
 * already resolved the browser default into it (see `getBrowserLanguage`).
 */
export function initI18n(lng: Language = getBrowserLanguage()): typeof i18n {
  if (initialized) return i18n

  void i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    // React escapes interpolated values already; escaping again would render
    // apostrophes and ampersands as entities.
    interpolation: { escapeValue: false },
    returnNull: false,
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: import.meta.env.DEV
      ? (lngs, ns, key): void => {
          console.warn(`[i18n] missing key "${ns}:${key}" for ${lngs.join(', ')}`)
        }
      : undefined,
  })

  initialized = true
  return i18n
}

/** Load a language's local chunk before initializing the foreground UI. */
export async function initI18nAsync(lng: Language = getBrowserLanguage()): Promise<typeof i18n> {
  await loadLanguageResources(lng)
  return initI18n(lng)
}

/**
 * The active language, narrowed to one we ship.
 *
 * Reads `i18n.language`, not `resolvedLanguage` — the latter lags behind a
 * `changeLanguage()` call until the async `languageChanged` event settles,
 * which made every locale-aware date formatter one switch behind.
 */
export function currentLanguage(): Language {
  return normalizeLanguage(i18n.language) ?? FALLBACK_LANGUAGE
}

/**
 * Switch language and keep `<html lang>` in sync — screen readers and the
 * browser's own hyphenation and spellcheck read it.
 */
export async function setLanguage(lng: Language): Promise<void> {
  const request = ++languageRequest
  const catalog = await loadLanguageResources(lng)
  if (request !== languageRequest) return
  if (initialized && !i18n.hasResourceBundle(lng, DEFAULT_NAMESPACE)) {
    for (const namespace of NAMESPACES) {
      i18n.addResourceBundle(lng, namespace, catalog[namespace], true, true)
    }
  }
  if (i18n.language !== lng) await i18n.changeLanguage(lng)
  if (typeof document !== 'undefined') document.documentElement.lang = lng
}

export default i18n
