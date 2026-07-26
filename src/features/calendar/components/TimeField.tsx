import { type JSX, useRef } from 'react'
import type { TimeFormat } from '@/types'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useScrollInput } from '@/hooks/useScrollInput'
import { TimeInput } from './TimeInput'
import styles from './EventModal.module.css'

interface TimeFieldProps {
  value: string
  timeFormat: TimeFormat
  onChange: (value: string) => void
  className?: string
  dataComponent: string
  ariaLabel: string
  id?: string
  autoFocus?: boolean
}

/**
 * Issue #56 — Adaptive time input.
 *
 * Desktop: render the typeable `TimeInput` (compact typing is fastest).
 * Mobile: render a native `<input type="time">` so the OS wheel picker
 * appears on focus/tap. The native picker's hour cycle reflects the user's
 * locale (24h vs 12h) which is an accepted trade-off — the underlying value
 * is still stored as `HH:mm`, so display logic elsewhere is unaffected.
 *
 * On mobile we also wire `useScrollInput` so a wheel gesture over the input
 * (e.g. desktop browser dev-tools mobile emulation, or a Bluetooth mouse on
 * iPadOS) bumps the value in 15-minute steps. On real mobile, no scroll wheel
 * exists so the hook is a no-op.
 */
export function TimeField({
  value,
  timeFormat,
  onChange,
  className,
  dataComponent,
  ariaLabel,
  id,
  autoFocus,
}: TimeFieldProps): JSX.Element {
  const isMobile = useIsMobile()
  const ref = useRef<HTMLInputElement>(null)
  useScrollInput([ref])

  if (isMobile) {
    return (
      <input
        ref={ref}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className ?? styles.input}
        id={id}
        data-component={dataComponent}
        aria-label={ariaLabel}
        required={false}
        autoFocus={autoFocus}
      />
    )
  }

  return (
    <TimeInput
      value={value}
      timeFormat={timeFormat}
      onChange={onChange}
      className={className ?? styles.input}
      dataComponent={dataComponent}
      ariaLabel={ariaLabel}
      id={id}
      autoFocus={autoFocus}
    />
  )
}
