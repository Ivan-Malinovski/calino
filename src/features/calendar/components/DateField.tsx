import { type JSX, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, formatDateInput, parseDateInput } from '@/lib/datetime'
import { useSettingsStore } from '@/store/settingsStore'
import styles from './EventModal.module.css'

interface DateFieldProps {
  /** `yyyy-MM-dd`, or empty when no date is set. */
  value: string
  onChange: (value: string) => void
  className?: string
  dataComponent?: string
  ariaLabel?: string
  id?: string
  /** `yyyy-MM-dd` bounds for the calendar popup only; typed dates aren't clamped. */
  min?: string
  max?: string
  required?: boolean
  /** Marks the field invalid for reasons the field can't see (e.g. an inverted range). */
  invalid?: boolean
  describedBy?: string
}

/**
 * Date input that honours the "Date format" setting.
 *
 * A native `<input type="date">` renders in the browser's locale and can't be
 * told otherwise, so the field you type in is a text input in the configured
 * format. The calendar button opens the native picker through a hidden
 * `<input type="date">`; the value handed to `onChange` is always `yyyy-MM-dd`.
 */
export function DateField({
  value,
  onChange,
  className,
  dataComponent,
  ariaLabel,
  id,
  min,
  max,
  required,
  invalid,
  describedBy,
}: DateFieldProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const dateFormat = useSettingsStore((state) => state.dateFormat)
  const pickerRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLInputElement>(null)
  const formatted = formatDateInput(value, dateFormat)
  // `null` while the field mirrors `value`; the typed text while it is being edited.
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => {
    setDraft(null)
  }, [value, dateFormat])

  const commit = (text: string): boolean => {
    const parsed = parseDateInput(text, dateFormat)
    if (!parsed) return false
    if (parsed !== value) onChange(parsed)
    return true
  }

  const stepDay = (days: number): void => {
    const base = parseDateInput(draft ?? formatted, dateFormat) ?? (value ? value : null)
    if (base) onChange(addDays(base, days))
  }
  // The wheel listener is attached once, so it calls through a ref to see the
  // current value rather than the one from the render it was attached in.
  const stepDayRef = useRef(stepDay)
  useEffect(() => {
    stepDayRef.current = stepDay
  })

  // Wheel over the focused field steps the date a day, as the native date
  // inputs here used to via useScrollInput. React's onWheel is passive, so
  // preventDefault (needed to stop the page scrolling) takes a native listener.
  useEffect(() => {
    const input = textRef.current
    if (!input) return
    const onWheel = (event: WheelEvent): void => {
      if (document.activeElement !== input) return
      event.preventDefault()
      // Trackpads report deltas of 100-200 per notch and mouse wheels 3-5;
      // normalise the same way useScrollInput does so the two feel alike.
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const notches = Math.round(delta / 100)
      if (notches === 0) return
      stepDayRef.current(notches > 0 ? -1 : 1)
    }
    input.addEventListener('wheel', onWheel, { passive: false })
    return () => input.removeEventListener('wheel', onWheel)
  }, [])

  const step = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // Applying a typed date takes this keystroke; submitting the form now
      // would save the value from before it landed.
      if (draft === null) return
      event.preventDefault()
      if (!commit(draft)) setDraft(null)
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    stepDay(event.key === 'ArrowUp' ? 1 : -1)
  }

  const openPicker = (): void => {
    const picker = pickerRef.current
    if (!picker) return
    try {
      picker.showPicker()
    } catch {
      picker.focus()
    }
  }

  return (
    <div className={styles.dateFieldWrapper}>
      <input
        ref={textRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        id={id}
        value={draft ?? formatted}
        placeholder={dateFormat.replace('yyyy', 'YYYY').replace('dd', 'DD')}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          if (text.length >= 8) commit(text)
        }}
        onBlur={() => {
          if (draft === null) return
          if (!commit(draft)) setDraft(null)
        }}
        onKeyDown={step}
        className={`${className ?? styles.input} ${styles.dateFieldInput}`}
        data-component={dataComponent}
        aria-label={ariaLabel}
        required={required}
        aria-invalid={invalid || (draft !== null && parseDateInput(draft, dateFormat) === null)}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        className={styles.dateFieldButton}
        onClick={openPicker}
        aria-label={t('modals.eventForm.pickDate')}
        title={t('modals.eventForm.pickDate')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        className={styles.dateFieldNative}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value)
        }}
      />
    </div>
  )
}
