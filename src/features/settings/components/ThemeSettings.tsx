import { useEffect, useMemo } from 'react'
import type { CSSProperties, JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useSettingsStore,
  THEME_MODE_OPTIONS,
  DEFAULT_ADJUSTABLE_THEME,
} from '@/store/settingsStore'
import { useTheme } from '@/components/ThemeContext'
import {
  getThemePreviewCSS,
  CATPPUCCIN_ACCENTS,
  catppuccinPickerFlavor,
  resolveCatppuccinAccent,
} from '@/lib/themes'
import type { AdjustableThemeProfile, AdjustableThemeSettings, ThemeMode, EventTint } from '@/types'
import styles from './Settings.module.css'
import { AdjustableThemeControls } from './AdjustableThemeControls'

function MiniCalendarPreview({
  themeId,
  variant,
  profile,
}: {
  themeId: string
  variant: 'light' | 'dark' | 'system'
  profile?: AdjustableThemeProfile
}): JSX.Element {
  // Extract theme colors from the theme's CSS (dynamically reflects the selected theme)
  const css = getThemePreviewCSS(themeId)
  const extract = (prop: string, fallback: string) => {
    const match = css.match(new RegExp(`${prop}:\\s*([^;\\n]+)`))
    return match ? match[1].trim() : fallback
  }

  const canvas = profile?.canvas ?? extract('--canvas', '#faf8f3')
  const panel = profile?.panel ?? extract('--panel', '#ffffff')
  const accent = profile?.accent ?? extract('--accent', '#b07d4f')
  const accentMixLight = profile
    ? `color-mix(in srgb, ${accent} 14%, transparent)`
    : css.includes('--accent-soft')
      ? extract('--accent-soft', `color-mix(in srgb, ${accent} 12%, ${canvas})`)
      : `color-mix(in srgb, ${accent} 12%, ${canvas})`
  const accentMixDark = profile
    ? `color-mix(in srgb, ${accent} 18%, transparent)`
    : css.includes('--accent-soft')
      ? extract('--accent-soft', `color-mix(in srgb, ${accent} 20%, #1a1816)`)
      : `color-mix(in srgb, ${accent} 20%, #1a1816)`

  const isSystem = variant === 'system'
  const bg = isSystem ? `linear-gradient(135deg, ${canvas} 50%, #1a1816 50%)` : canvas
  const cellBg = isSystem ? `linear-gradient(135deg, ${panel} 50%, #242220 50%)` : panel
  const eventBg = isSystem
    ? `linear-gradient(135deg, ${accentMixLight} 50%, ${accentMixDark} 50%)`
    : accentMixLight

  return (
    <div
      className={`${styles.themeCardPreview} ${variant === 'light' ? styles.themeCardPreviewLight : variant === 'dark' ? styles.themeCardPreviewDark : styles.themeCardPreviewSystem}`}
      style={{ background: bg }}
    >
      <div className={styles.tcBar} style={{ background: cellBg, width: '60%' }} />
      <div className={styles.tcGrid}>
        {Array.from({ length: 14 }, (_, i) => (
          <div
            key={i}
            className={styles.tcDay}
            style={
              i === 2 || i === 5 || i === 10 ? { background: eventBg } : { background: cellBg }
            }
          />
        ))}
      </div>
    </div>
  )
}

function extractThemeProps(css: string): {
  bg: string
  panel: string
  accent: string
  text: string
  radiusSm: string
  radiusMd: string
  radiusLg: string
} {
  const get = (prop: string, fallback: string): string => {
    const match = css.match(new RegExp(`${prop}:\\s*([^;]+)`))
    return match ? match[1].trim() : fallback
  }
  return {
    bg: get('--canvas', get('--color-bg-primary', '#faf8f3')),
    panel: get('--panel', get('--color-bg-secondary', '#ffffff')),
    accent: get('--accent', get('--color-accent', '#b07d4f')),
    text: get('--ink', get('--color-text-primary', '#2c2823')),
    radiusSm: get('--radius-sm', '7px'),
    radiusMd: get('--radius-md', '11px'),
    radiusLg: get('--radius-lg', '16px'),
  }
}

function getAdjustableProfile(
  themeId: string,
  adjustableTheme: AdjustableThemeSettings
): AdjustableThemeProfile | undefined {
  if (themeId === 'adjustable-light') return adjustableTheme.light
  if (themeId === 'adjustable-dark') return adjustableTheme.dark
  return undefined
}

function ThemePreviewCard({
  name,
  css,
  profile,
  isActive,
  onClick,
}: {
  name: string
  css: string
  profile?: AdjustableThemeProfile
  isActive: boolean
  onClick: () => void
}): JSX.Element {
  const props = useMemo(() => {
    const extracted = extractThemeProps(css)
    if (!profile) return extracted
    return {
      ...extracted,
      bg: profile.canvas,
      panel: profile.panel,
      accent: profile.accent,
      text: profile.text,
      radiusSm: `${profile.cornerRadius * 0.4}px`,
      radiusMd: `${profile.cornerRadius * 0.75}px`,
      radiusLg: `${profile.cornerRadius * 1.1}px`,
    }
  }, [css, profile])

  return (
    <button
      className={`${styles.themePreviewCard} ${isActive ? styles.themePreviewCardActive : ''}`}
      onClick={onClick}
      data-component="theme-preview-card"
      data-theme-id={name}
      data-active={isActive ? 'true' : undefined}
      type="button"
    >
      <div className={styles.themePreviewSwatch} style={{ background: props.bg }}>
        <div
          className={styles.themePreviewPanel}
          style={{ background: props.panel, borderRadius: props.radiusMd }}
        >
          <div
            className={styles.themePreviewBar}
            style={{ background: props.accent, width: '50%', borderRadius: props.radiusSm }}
          />
          <div className={styles.themePreviewRows}>
            <div
              className={styles.themePreviewRow}
              style={{
                background: props.text,
                opacity: 0.15,
                width: '80%',
                borderRadius: props.radiusSm,
              }}
            />
            <div
              className={styles.themePreviewRow}
              style={{
                background: props.text,
                opacity: 0.1,
                width: '60%',
                borderRadius: props.radiusSm,
              }}
            />
            <div
              className={styles.themePreviewRow}
              style={{
                background: props.text,
                opacity: 0.06,
                width: '70%',
                borderRadius: props.radiusSm,
              }}
            />
          </div>
        </div>
      </div>
      <div className={styles.themePreviewLabel}>{name}</div>
    </button>
  )
}

export function ThemeSettings(): JSX.Element {
  const { t } = useTranslation('settings')
  const themeMode = useSettingsStore((s) => s.themeMode)
  const lightTheme = useSettingsStore((s) => s.lightTheme)
  const darkTheme = useSettingsStore((s) => s.darkTheme)
  const mochaAccent = useSettingsStore((s) => s.mochaAccent)
  const eventTint = useSettingsStore((s) => s.eventTint)
  const adjustableTheme = useSettingsStore((s) => s.adjustableTheme) ?? DEFAULT_ADJUSTABLE_THEME
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const showEventIcons = useSettingsStore((s) => s.showEventIcons)
  const { loadedThemes, refetchThemes, effectiveMode } = useTheme()

  useEffect(() => {
    refetchThemes()
  }, [refetchThemes])

  // The tint levels live in built-in.css, so the setting only bites while a
  // built-in theme is actually in use. Show it if either slot uses one — which
  // slot is live depends on the current mode.
  const usesBuiltInTheme = lightTheme === 'built-in' || darkTheme === 'built-in-dark'
  const usesAdjustableTheme =
    effectiveMode === 'dark' ? darkTheme === 'adjustable-dark' : lightTheme === 'adjustable-light'

  const adjustableLast = (theme: { id: string }): number =>
    theme.id.startsWith('adjustable-') ? 1 : 0
  const lightThemes = loadedThemes
    .filter((t) => !t.isDark)
    .sort((a, b) => adjustableLast(a) - adjustableLast(b))
  const darkThemes = loadedThemes
    .filter((t) => t.isDark)
    .sort((a, b) => adjustableLast(a) - adjustableLast(b))
  const currentThemeId = effectiveMode === 'dark' ? darkTheme : lightTheme
  const catppuccinFlavor = catppuccinPickerFlavor({
    currentThemeId,
    lightTheme,
    darkTheme,
  })
  const catppuccinAccents = catppuccinFlavor
    ? CATPPUCCIN_ACCENTS.map((accent) => ({
        labelKey: accent.labelKey,
        value: accent[catppuccinFlavor],
      }))
    : []
  const activeCatppuccinAccent = catppuccinFlavor
    ? resolveCatppuccinAccent(mochaAccent, catppuccinFlavor)
    : ''

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="theme-settings"
    >
      <h1 className={styles.pageTitle}>{t('theme.title')}</h1>
      <div className={styles.group}>
        <div
          className={`${styles.row} ${styles.rowSubhead}`}
          data-component="setting-row"
          data-setting="theme-mode"
          data-value={themeMode}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('theme.appearance.label')}</div>
            <div className={styles.rowDesc}>{t('theme.appearance.desc')}</div>
          </div>
        </div>
        <div className={styles.themeCards}>
          {(THEME_MODE_OPTIONS as { value: ThemeMode; labelKey: string }[]).map((opt) => {
            const isActive = themeMode === opt.value
            const isLight = opt.value === 'light'
            const isDark = opt.value === 'dark'
            const isSystem = opt.value === 'auto'
            return (
              <button
                key={opt.value}
                className={`${styles.themeCard} ${isActive ? styles.themeCardActive : ''}`}
                onClick={() => updateSettings({ themeMode: opt.value })}
                data-component="theme-mode-option"
                data-value={opt.value}
                data-active={isActive ? 'true' : undefined}
                type="button"
              >
                <MiniCalendarPreview
                  themeId={
                    isLight
                      ? lightTheme
                      : isDark
                        ? darkTheme
                        : window.matchMedia('(prefers-color-scheme: dark)').matches
                          ? darkTheme
                          : lightTheme
                  }
                  variant={isLight ? 'light' : isDark ? 'dark' : 'system'}
                  profile={getAdjustableProfile(
                    isLight
                      ? lightTheme
                      : isDark
                        ? darkTheme
                        : effectiveMode === 'dark'
                          ? darkTheme
                          : lightTheme,
                    adjustableTheme
                  )}
                />
                <div className={styles.themeCardLabel}>
                  {isSystem ? t('theme.appearance.system') : t(opt.labelKey)}
                  <div className={styles.tcCheck}>
                    <svg
                      viewBox="0 0 9 9"
                      fill="none"
                      stroke="var(--accent-contrast, #fff)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M1.5 4.5l2 2L7.5 2" />
                    </svg>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div
          className={`${styles.row} ${styles.rowSubhead}`}
          data-component="setting-row"
          data-setting="light-theme"
          data-value={lightTheme}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('theme.lightTheme.label')}</div>
            <div className={styles.rowDesc}>{t('theme.lightTheme.desc')}</div>
          </div>
        </div>
        <div
          className={styles.themePreviewGrid}
          data-component="theme-preview-grid"
          data-theme-mode="light"
        >
          {lightThemes.map((t) => (
            <ThemePreviewCard
              key={t.id}
              name={t.name}
              css={getThemePreviewCSS(t.id)}
              profile={getAdjustableProfile(t.id, adjustableTheme)}
              isActive={lightTheme === t.id}
              onClick={() => updateSettings({ lightTheme: t.id })}
            />
          ))}
        </div>
        <div
          className={`${styles.row} ${styles.rowSubhead}`}
          data-component="setting-row"
          data-setting="dark-theme"
          data-value={darkTheme}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('theme.darkTheme.label')}</div>
            <div className={styles.rowDesc}>{t('theme.darkTheme.desc')}</div>
          </div>
        </div>
        <div
          className={styles.themePreviewGrid}
          data-component="theme-preview-grid"
          data-theme-mode="dark"
        >
          {darkThemes.map((t) => (
            <ThemePreviewCard
              key={t.id}
              name={t.name}
              css={getThemePreviewCSS(t.id)}
              profile={getAdjustableProfile(t.id, adjustableTheme)}
              isActive={darkTheme === t.id}
              onClick={() => updateSettings({ darkTheme: t.id })}
            />
          ))}
        </div>
        {catppuccinFlavor && (
          <div className={styles.row} data-component="setting-row" data-setting="mocha-accent">
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{t('theme.mochaAccent.label')}</div>
              <div className={styles.rowDesc}>{t('theme.mochaAccent.desc')}</div>
            </div>
            <div
              className={styles.mochaAccentOptions}
              role="group"
              aria-label={t('theme.mochaAccent.ariaLabel')}
            >
              {catppuccinAccents.map((accent) => (
                <button
                  key={accent.labelKey}
                  className={`${styles.mochaAccentOption} ${activeCatppuccinAccent === accent.value ? styles.mochaAccentOptionActive : ''}`}
                  style={{ '--mocha-accent': accent.value } as CSSProperties}
                  onClick={() => updateSettings({ mochaAccent: accent.value })}
                  aria-label={t('theme.mochaAccent.useAccent', { name: t(accent.labelKey) })}
                  aria-pressed={activeCatppuccinAccent === accent.value}
                  title={t(accent.labelKey)}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
        {usesBuiltInTheme && (
          <div
            className={styles.row}
            data-component="setting-row"
            data-setting="event-tint"
            data-value={eventTint}
          >
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{t('theme.eventTint.label')}</div>
              <div className={styles.rowDesc}>{t('theme.eventTint.desc')}</div>
            </div>
            <div className={styles.rowControl}>
              <select
                className={styles.select}
                style={{ minWidth: '120px' }}
                value={eventTint}
                aria-label={t('theme.eventTint.ariaLabel')}
                onChange={(e) => updateSettings({ eventTint: e.target.value as EventTint })}
              >
                <option value="subtle">{t('theme.eventTint.subtle')}</option>
                <option value="balanced">{t('theme.eventTint.balanced')}</option>
                <option value="vivid">{t('theme.eventTint.vivid')}</option>
              </select>
            </div>
          </div>
        )}
        {usesAdjustableTheme && (
          <AdjustableThemeControls
            mode={effectiveMode}
            profile={adjustableTheme[effectiveMode]}
            onChange={(profile) =>
              updateSettings({
                adjustableTheme: { ...adjustableTheme, [effectiveMode]: profile },
              })
            }
            onReset={() =>
              updateSettings({
                adjustableTheme: {
                  ...adjustableTheme,
                  [effectiveMode]: DEFAULT_ADJUSTABLE_THEME[effectiveMode],
                },
              })
            }
          />
        )}
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="show-event-icons"
          data-value={String(showEventIcons)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('theme.showEventIcons.label')}</div>
            <div className={styles.rowDesc}>{t('theme.showEventIcons.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="show-event-icons"
            >
              <input
                type="checkbox"
                checked={showEventIcons}
                aria-label={t('theme.showEventIcons.ariaLabel')}
                onChange={() => updateSettings({ showEventIcons: !showEventIcons })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={`${styles.row} ${styles.rowDisabled}`}
          title={t('theme.fontSize.notAvailable')}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('theme.fontSize.label')}</div>
            <div className={styles.rowDesc}>{t('theme.fontSize.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.seg}>
              <button className={`${styles.segTab} ${styles.segTabActive}`} type="button">
                {t('theme.fontSize.small')}
              </button>
              <button className={styles.segTab} type="button">
                {t('theme.fontSize.default')}
              </button>
              <button className={styles.segTab} type="button">
                {t('theme.fontSize.large')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
