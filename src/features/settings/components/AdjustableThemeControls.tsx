import type { CSSProperties, JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdjustableThemeProfile } from '@/types'
import { ADJUSTABLE_FONT_STACKS } from '@/lib/themes/adjustableFonts'
import styles from './Settings.module.css'

type ColorKey = 'canvas' | 'panel' | 'accent' | 'accentContrast' | 'text' | 'mutedText' | 'border'

interface AdjustableThemeControlsProps {
  mode: 'light' | 'dark'
  profile: AdjustableThemeProfile
  onChange: (profile: AdjustableThemeProfile) => void
  onReset: () => void
}

const COLOR_CONTROLS: { key: ColorKey; labelKey: string; descKey: string }[] = [
  { key: 'canvas', labelKey: 'theme.adjustable.colors.canvas.label', descKey: 'theme.adjustable.colors.canvas.desc' },
  { key: 'panel', labelKey: 'theme.adjustable.colors.panel.label', descKey: 'theme.adjustable.colors.panel.desc' },
  { key: 'accent', labelKey: 'theme.adjustable.colors.accent.label', descKey: 'theme.adjustable.colors.accent.desc' },
  { key: 'accentContrast', labelKey: 'theme.adjustable.colors.accentContrast.label', descKey: 'theme.adjustable.colors.accentContrast.desc' },
  { key: 'text', labelKey: 'theme.adjustable.colors.text.label', descKey: 'theme.adjustable.colors.text.desc' },
  { key: 'mutedText', labelKey: 'theme.adjustable.colors.mutedText.label', descKey: 'theme.adjustable.colors.mutedText.desc' },
  { key: 'border', labelKey: 'theme.adjustable.colors.border.label', descKey: 'theme.adjustable.colors.border.desc' },
]

const FONT_OPTIONS = [
  { value: 'system', labelKey: 'theme.adjustable.font.system' },
  { value: 'serif', labelKey: 'theme.adjustable.font.serif' },
  { value: 'mono', labelKey: 'theme.adjustable.font.mono' },
] as const

const PREVIEW_EVENTS = [
  {
    titleKey: 'theme.adjustable.previewEvent1Title',
    metaKey: 'theme.adjustable.previewEvent1Meta',
    color: 'var(--preview-accent)',
  },
  {
    titleKey: 'theme.adjustable.previewEvent2Title',
    metaKey: 'theme.adjustable.previewEvent2Meta',
    color: '#6e9f84',
  },
  {
    titleKey: 'theme.adjustable.previewEvent3Title',
    metaKey: 'theme.adjustable.previewEvent3Meta',
    color: '#8c82b8',
  },
]

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

function contrastRatio(foreground: string, background: string): number {
  const [first, second] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a
  )
  return (first + 0.05) / (second + 0.05)
}

function AdjustableEventPreview({ profile }: { profile: AdjustableThemeProfile }): JSX.Element {
  const { t } = useTranslation('settings')
  const previewStyle = {
    '--preview-canvas': profile.canvas,
    '--preview-panel': profile.panel,
    '--preview-accent': profile.accent,
    '--preview-border': profile.border,
    '--preview-text': profile.text,
    '--preview-muted-text': profile.mutedText,
    '--preview-radius': `${profile.cornerRadius}px`,
    '--preview-density': profile.density / 100,
    '--preview-shadow-strength': profile.shadowStrength / 100,
    '--preview-event-tint': `${profile.eventTint}%`,
  } as CSSProperties

  return (
    <div
      className={styles.adjustablePreview}
      style={{ ...previewStyle, fontFamily: ADJUSTABLE_FONT_STACKS[profile.fontFamily] }}
      data-component="adjustable-event-preview"
    >
      <div className={styles.adjustablePreviewHeader}>
        <div>
          <div className={styles.adjustableControlLabel}>{t('theme.adjustable.previewLabel')}</div>
          <div className={styles.adjustableControlDescription}>
            {t('theme.adjustable.previewDesc')}
          </div>
        </div>
        <span className={styles.adjustablePreviewLive}>{t('theme.adjustable.live')}</span>
      </div>
      <div className={styles.adjustablePreviewStage}>
        <div className={styles.adjustablePreviewDate}>
          <strong>{t('theme.adjustable.previewToday')}</strong>
          <span>{t('theme.adjustable.previewDate')}</span>
        </div>
        <div className={styles.adjustablePreviewCards}>
          {PREVIEW_EVENTS.map((event) => (
            <div
              className={styles.adjustablePreviewCard}
              key={event.titleKey}
              style={{ '--preview-event-color': event.color } as CSSProperties}
            >
              <div className={styles.adjustablePreviewCardTitle}>{t(event.titleKey)}</div>
              <div className={styles.adjustablePreviewCardMeta}>{t(event.metaKey)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AdjustableThemeControls({
  mode,
  profile,
  onChange,
  onReset,
}: AdjustableThemeControlsProps): JSX.Element {
  const { t } = useTranslation('settings')
  const update = (key: keyof AdjustableThemeProfile, value: string | number): void => {
    onChange({ ...profile, [key]: value } as AdjustableThemeProfile)
  }
  const contrastWarnings = [
    contrastRatio(profile.text, profile.canvas) < 4.5 && t('theme.adjustable.contrast.textCanvas'),
    contrastRatio(profile.text, profile.panel) < 4.5 && t('theme.adjustable.contrast.textPanel'),
    contrastRatio(profile.mutedText, profile.canvas) < 4.5 &&
      t('theme.adjustable.contrast.mutedTextCanvas'),
    contrastRatio(profile.accentContrast, profile.accent) < 4.5 &&
      t('theme.adjustable.contrast.accentContrast'),
  ].filter((warning): warning is string => Boolean(warning))
  const contrastDetails =
    contrastWarnings.length > 0
      ? contrastWarnings.join(' ')
      : t('theme.adjustable.contrast.meetsAA')

  return (
    <div className={styles.adjustablePanel} data-component="adjustable-theme-controls">
      <div className={styles.adjustableHeader}>
        <div>
          <div className={styles.rowLabel}>{t('theme.adjustable.headerLabel', { mode })}</div>
          <div className={styles.rowDesc}>{t('theme.adjustable.desc')}</div>
        </div>
        <button type="button" className={styles.adjustableReset} onClick={onReset}>
          {t('theme.adjustable.reset')}
        </button>
      </div>

      <AdjustableEventPreview profile={profile} />

      <label className={styles.adjustableFontControl}>
        <span className={styles.adjustableControlLabel}>{t('theme.adjustable.font.label')}</span>
        <span className={styles.adjustableControlDescription}>
          {t('theme.adjustable.font.desc')}
        </span>
        <select
          className={styles.select}
          value={profile.fontFamily}
          aria-label={t('theme.adjustable.font.ariaLabel')}
          onChange={(event) => update('fontFamily', event.currentTarget.value)}
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.value} value={font.value}>
              {t(font.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.adjustableColorGrid}>
        {COLOR_CONTROLS.map(({ key, labelKey, descKey }) => (
          <label className={styles.adjustableColorControl} key={key}>
            <span className={styles.adjustableControlLabel}>{t(labelKey)}</span>
            <span className={styles.adjustableControlDescription}>{t(descKey)}</span>
            <span className={styles.adjustableColorInputRow}>
              <input
                type="color"
                value={profile[key]}
                onChange={(event) => update(key, event.currentTarget.value)}
                aria-label={t('theme.adjustable.colors.colorAriaLabel', { label: t(labelKey) })}
              />
              <code>{profile[key]}</code>
            </span>
          </label>
        ))}
      </div>

      <div className={styles.adjustableRangeGrid}>
        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>{t('theme.adjustable.cornerRadius')}</span>
            <output>{profile.cornerRadius}px</output>
          </span>
          <input
            className={styles.adjustableSlider}
            type="range"
            min="0"
            max="24"
            step="1"
            value={profile.cornerRadius}
            onChange={(event) => update('cornerRadius', event.currentTarget.valueAsNumber)}
            aria-label={t('theme.adjustable.cornerRadiusAriaLabel')}
          />
        </label>

        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>{t('theme.adjustable.density')}</span>
            <output>{profile.density}%</output>
          </span>
          <input
            className={styles.adjustableSlider}
            type="range"
            min="80"
            max="120"
            step="5"
            value={profile.density}
            onChange={(event) => update('density', event.currentTarget.valueAsNumber)}
            aria-label={t('theme.adjustable.densityAriaLabel')}
          />
        </label>

        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>
              {t('theme.adjustable.shadowStrength')}
            </span>
            <output>{profile.shadowStrength}%</output>
          </span>
          <input
            className={styles.adjustableSlider}
            type="range"
            min="0"
            max="100"
            step="5"
            value={profile.shadowStrength}
            onChange={(event) => update('shadowStrength', event.currentTarget.valueAsNumber)}
            aria-label={t('theme.adjustable.shadowStrengthAriaLabel')}
          />
        </label>

        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>{t('theme.adjustable.eventTint')}</span>
            <output>{profile.eventTint}%</output>
          </span>
          <input
            className={styles.adjustableSlider}
            type="range"
            min="4"
            max="30"
            step="1"
            value={profile.eventTint}
            onChange={(event) => update('eventTint', event.currentTarget.valueAsNumber)}
            aria-label={t('theme.adjustable.eventTintAriaLabel')}
          />
        </label>
      </div>
      <div
        className={styles.adjustableContrastWarning}
        data-status={contrastWarnings.length > 0 ? 'warning' : 'ok'}
        aria-label={t('theme.adjustable.contrast.ariaLabel', { details: contrastDetails })}
        title={contrastDetails}
      >
        <span className={styles.adjustableContrastDot} aria-hidden="true" />
        <span>
          {contrastWarnings.length > 0
            ? t('theme.adjustable.contrast.needsAttention')
            : t('theme.adjustable.contrast.looksGood')}
        </span>
      </div>
    </div>
  )
}
