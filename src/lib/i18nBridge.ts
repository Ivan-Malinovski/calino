/**
 * Wires the persisted `language` setting to i18next.
 *
 * Kept separate from `src/lib/i18n.ts` so that the i18next singleton itself
 * stays free of a settings-store import — the headless sync entry needs the
 * former without the latter.
 */
import { useSettingsStore } from '@/store/settingsStore'
import { initI18n, setLanguage } from '@/lib/i18n'

/**
 * Initialize i18next from the persisted setting and follow it thereafter.
 *
 * The stored value is authoritative once it exists: it is seeded from the
 * browser's preferred languages on first run (`getBrowserLanguage`), and after
 * that only the user's own choice changes it. A device language change on
 * Android therefore does not move a chosen UI language — which is what we
 * want, and just as well, since `AndroidManifest.xml` declares
 * `configChanges="…|locale|…"` and never recreates the activity anyway.
 */
export function startI18n(): void {
  const language = useSettingsStore.getState().language
  initI18n(language)
  if (typeof document !== 'undefined') document.documentElement.lang = language

  useSettingsStore.subscribe((state, prev) => {
    if (state.language !== prev.language) void setLanguage(state.language)
  })
}
