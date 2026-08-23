import type { CSSProperties, JSX } from 'react'
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

const COLOR_CONTROLS: { key: ColorKey; label: string; description: string }[] = [
  { key: 'canvas', label: 'Canvas', description: 'Main page background' },
  { key: 'panel', label: 'Surface', description: 'Cards, dialogs, and panels' },
  { key: 'accent', label: 'Accent', description: 'Actions, selection, and focus' },
  { key: 'accentContrast', label: 'Accent text', description: 'Text on accent fills' },
  { key: 'text', label: 'Primary text', description: 'Main readable text' },
  { key: 'mutedText', label: 'Muted text', description: 'Secondary and quiet text' },
  { key: 'border', label: 'Borders', description: 'Dividers and field outlines' },
]

const FONT_OPTIONS = [
  { value: 'system', label: 'System sans' },
  { value: 'serif', label: 'Newsreader serif' },
  { value: 'mono', label: 'Monospace' },
] as const

const PREVIEW_EVENTS = [
  { title: 'Design review', meta: '10:00 – 11:00 · Meeting room', color: 'var(--preview-accent)' },
  { title: 'Lunch with Alex', meta: '12:30 – 13:15 · Café Flora', color: '#6e9f84' },
  { title: 'Focus time', meta: '14:00 – 15:30', color: '#8c82b8' },
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
          <div className={styles.adjustableControlLabel}>Event card preview</div>
          <div className={styles.adjustableControlDescription}>
            See how this palette feels in the calendar.
          </div>
        </div>
        <span className={styles.adjustablePreviewLive}>Live</span>
      </div>
      <div className={styles.adjustablePreviewStage}>
        <div className={styles.adjustablePreviewDate}>
          <strong>Today</strong>
          <span>Tuesday, 23 August</span>
        </div>
        <div className={styles.adjustablePreviewCards}>
          {PREVIEW_EVENTS.map((event) => (
            <div
              className={styles.adjustablePreviewCard}
              key={event.title}
              style={{ '--preview-event-color': event.color } as CSSProperties}
            >
              <div className={styles.adjustablePreviewCardTitle}>{event.title}</div>
              <div className={styles.adjustablePreviewCardMeta}>{event.meta}</div>
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
  const update = (key: keyof AdjustableThemeProfile, value: string | number): void => {
    onChange({ ...profile, [key]: value } as AdjustableThemeProfile)
  }
  const contrastWarnings = [
    contrastRatio(profile.text, profile.canvas) < 4.5 &&
      'Primary text is below WCAG AA on the canvas.',
    contrastRatio(profile.text, profile.panel) < 4.5 &&
      'Primary text is below WCAG AA on surfaces.',
    contrastRatio(profile.mutedText, profile.canvas) < 4.5 &&
      'Muted text is below WCAG AA on the canvas.',
    contrastRatio(profile.accentContrast, profile.accent) < 4.5 &&
      'Accent text is below WCAG AA on accent fills.',
  ].filter((warning): warning is string => Boolean(warning))
  const contrastDetails =
    contrastWarnings.length > 0 ? contrastWarnings.join(' ') : 'Colours meet WCAG AA.'

  return (
    <div className={styles.adjustablePanel} data-component="adjustable-theme-controls">
      <div className={styles.adjustableHeader}>
        <div>
          <div className={styles.rowLabel}>Adjustable theme · {mode}</div>
          <div className={styles.rowDesc}>
            Tune the active palette live. Changes are saved automatically on this device.
          </div>
        </div>
        <button type="button" className={styles.adjustableReset} onClick={onReset}>
          Reset
        </button>
      </div>

      <AdjustableEventPreview profile={profile} />

      <label className={styles.adjustableFontControl}>
        <span className={styles.adjustableControlLabel}>Font</span>
        <span className={styles.adjustableControlDescription}>
          Typeface used across the interface
        </span>
        <select
          className={styles.select}
          value={profile.fontFamily}
          aria-label="Theme font"
          onChange={(event) => update('fontFamily', event.currentTarget.value)}
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.adjustableColorGrid}>
        {COLOR_CONTROLS.map(({ key, label, description }) => (
          <label className={styles.adjustableColorControl} key={key}>
            <span className={styles.adjustableControlLabel}>{label}</span>
            <span className={styles.adjustableControlDescription}>{description}</span>
            <span className={styles.adjustableColorInputRow}>
              <input
                type="color"
                value={profile[key]}
                onChange={(event) => update(key, event.currentTarget.value)}
                aria-label={`${label} color`}
              />
              <code>{profile[key]}</code>
            </span>
          </label>
        ))}
      </div>

      <div className={styles.adjustableRangeGrid}>
        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>Corner radius</span>
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
            aria-label="Corner radius"
          />
        </label>

        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>Density</span>
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
            aria-label="Theme density"
          />
        </label>

        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>Shadow strength</span>
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
            aria-label="Shadow strength"
          />
        </label>

        <label className={styles.adjustableRangeControl}>
          <span>
            <span className={styles.adjustableControlLabel}>Event tint</span>
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
            aria-label="Event tint strength"
          />
        </label>
      </div>
      <div
        className={styles.adjustableContrastWarning}
        data-status={contrastWarnings.length > 0 ? 'warning' : 'ok'}
        aria-label={`Contrast check: ${contrastDetails}`}
        title={contrastDetails}
      >
        <span className={styles.adjustableContrastDot} aria-hidden="true" />
        <span>
          {contrastWarnings.length > 0 ? 'Contrast needs attention' : 'Contrast looks good'}
        </span>
      </div>
    </div>
  )
}
