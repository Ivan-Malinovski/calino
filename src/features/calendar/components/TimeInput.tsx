import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { TimeFormat } from '@/types'
import { stepTimeStr } from '@/lib/datetime'

/**
 * Minutes per scroll notch / arrow press. Matches the step `useScrollInput`
 * applies to native time inputs, so the two paths can't drift apart.
 */
const STEP_MINUTES = 15

interface TimeInputProps {
  value: string
  timeFormat: TimeFormat
  onChange: (value: string) => void
  className: string
  dataComponent: string
  ariaLabel: string
  id?: string
  autoFocus?: boolean
}

function formatTimeValue(value: string, timeFormat: TimeFormat): string {
  if (timeFormat === '24h') return value

  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value

  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

function parseTimeValue(
  value: string,
  timeFormat: TimeFormat,
  allowCompact = false
): string | null {
  if (timeFormat === '24h') {
    const trimmedValue = value.trim()
    const match = trimmedValue.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
    if (match) return `${match[1]}:${match[2]}`

    if (allowCompact) {
      const compactMatch = trimmedValue.match(/^(\d{1,2})([0-5]\d)$/)
      if (compactMatch && Number(compactMatch[1]) <= 23) {
        return `${compactMatch[1].padStart(2, '0')}:${compactMatch[2]}`
      }
    }

    return null
  }

  const match = value.trim().match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*([AP]M)$/i)
  if (!match) return null

  const hours = (Number(match[1]) % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

export function TimeInput({
  value,
  timeFormat,
  onChange,
  className,
  dataComponent,
  ariaLabel,
  id,
  autoFocus,
}: TimeInputProps): JSX.Element {
  const resolvedTimeFormat: TimeFormat = timeFormat === '12h' ? '12h' : '24h'
  const formattedValue = formatTimeValue(value, resolvedTimeFormat)
  const [draft, setDraft] = useState(formattedValue)

  useEffect(() => {
    setDraft(formattedValue)
  }, [formattedValue])

  const commit = (): void => {
    const parsed = parseTimeValue(draft, resolvedTimeFormat, true)
    if (parsed && parsed !== value) onChange(parsed)
    setDraft(formatTimeValue(parsed ?? value, resolvedTimeFormat))
  }

  // Scroll-to-adjust and arrow-key stepping, matching what the date fields
  // already do (natively for arrows, via `useScrollInput` for the wheel).
  // Neither comes for free here: this is a `type="text"` input, so the browser
  // gives it no stepper, and `useScrollInput` bails on anything that isn't a
  // native date/time input.
  //
  // Steps from the *draft* when it parses, so adjusting straight after typing
  // continues from what's on screen rather than the last committed value.
  const step = useCallback(
    (direction: 1 | -1): void => {
      const base = parseTimeValue(draft, resolvedTimeFormat, true) ?? value
      const next = stepTimeStr(base, direction * STEP_MINUTES)
      setDraft(formatTimeValue(next, resolvedTimeFormat))
      if (next !== value) onChange(next)
    },
    [draft, resolvedTimeFormat, value, onChange]
  )

  // Attached natively rather than via React's `onWheel`: React registers wheel
  // listeners as passive, so preventDefault there is ignored (and warns) and
  // the page would scroll underneath the adjustment.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      // Same normalisation as useScrollInput: trackpads fire deltas an order of
      // magnitude larger than a mouse wheel's notch, so divide before rounding.
      const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      const steps = Math.round(rawDelta / 100)
      if (steps === 0) return
      step(steps > 0 ? -1 : 1)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [step])

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(event) => {
        const nextDraft = event.target.value
        setDraft(nextDraft)
        const parsed = parseTimeValue(nextDraft, resolvedTimeFormat)
        if (parsed) onChange(parsed)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          // Otherwise the caret jumps to one end of the text, and in the
          // preview popup the keydown reaches the dialog's own handlers.
          event.preventDefault()
          event.stopPropagation()
          step(event.key === 'ArrowUp' ? 1 : -1)
          return
        }
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className={className}
      id={id}
      data-component={dataComponent}
      aria-label={ariaLabel}
      inputMode="text"
      autoComplete="off"
      autoFocus={autoFocus}
      required
    />
  )
}
