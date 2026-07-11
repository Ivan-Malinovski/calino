import { useEffect, useState, type JSX } from 'react'
import type { TimeFormat } from '@/types'

interface TimeInputProps {
  value: string
  timeFormat: TimeFormat
  onChange: (value: string) => void
  className: string
  dataComponent: string
  ariaLabel: string
  id?: string
}

function formatTimeValue(value: string, timeFormat: TimeFormat): string {
  if (timeFormat === '24h') return value

  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value

  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

function parseTimeValue(value: string, timeFormat: TimeFormat): string | null {
  if (timeFormat === '24h') {
    const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
    return match ? `${match[1]}:${match[2]}` : null
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
}: TimeInputProps): JSX.Element {
  const resolvedTimeFormat: TimeFormat = timeFormat === '12h' ? '12h' : '24h'
  const formattedValue = formatTimeValue(value, resolvedTimeFormat)
  const [draft, setDraft] = useState(formattedValue)

  useEffect(() => {
    setDraft(formattedValue)
  }, [formattedValue])

  const commit = (): void => {
    const parsed = parseTimeValue(draft, resolvedTimeFormat)
    setDraft(formatTimeValue(parsed ?? value, resolvedTimeFormat))
  }

  return (
    <input
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
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className={className}
      id={id}
      data-component={dataComponent}
      aria-label={ariaLabel}
      inputMode="text"
      autoComplete="off"
      required
    />
  )
}
