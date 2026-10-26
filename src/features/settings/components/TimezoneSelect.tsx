import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { getSupportedTimezones, TIMEZONE_PRESETS } from '@/lib/timezoneHelper'
import styles from './Settings.module.css'

interface Option {
  /** Stored value; '' means follow the browser. */
  value: string
  label: string
  /** Lower-cased text the query is matched against. */
  haystack: string
}

interface TimezoneSelectProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

const normalize = (text: string): string => text.toLowerCase().replace(/[_/]+/g, ' ')

export function TimezoneSelect({ value, onChange, ariaLabel }: TimezoneSelectProps): JSX.Element {
  const { t } = useTranslation('settings')
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLLIElement | null)[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)

  const options = useMemo<Option[]>(() => {
    const presets = new Set(TIMEZONE_PRESETS.map((tz) => tz.value))
    const automatic = t('general.homeTimezone.automatic')
    return [
      { value: '', label: automatic, haystack: normalize(automatic) },
      ...TIMEZONE_PRESETS.map((tz) => ({
        value: tz.value,
        label: tz.label,
        haystack: normalize(`${tz.label} ${tz.value}`),
      })),
      ...getSupportedTimezones()
        .filter((tz) => !presets.has(tz))
        .map((tz) => ({ value: tz, label: tz, haystack: normalize(tz) })),
    ]
  }, [t])

  const selected = options.find((option) => option.value === value)
  const selectedLabel = selected?.label ?? value

  const results = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean)
    if (terms.length === 0) return options
    return options.filter((option) => terms.every((term) => option.haystack.includes(term)))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    optionRefs.current[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [open, highlighted])

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  const choose = (option: Option): void => {
    onChange(option.value)
    close()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (results.length === 0) return
      setHighlighted((current) =>
        event.key === 'ArrowDown'
          ? (current + 1) % results.length
          : (current - 1 + results.length) % results.length
      )
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = results[highlighted]
      if (option) choose(option)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  return (
    <div
      ref={containerRef}
      className={styles.timezoneSelect}
      data-component="timezone-select"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) close()
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && results[highlighted] ? `${listboxId}-${highlighted}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        className={`${styles.select} ${styles.timezoneSelectInput}`}
        placeholder={open ? t('general.homeTimezone.search') : undefined}
        value={open ? query : selectedLabel}
        onFocus={(event) => {
          setOpen(true)
          setHighlighted(
            Math.max(
              0,
              options.findIndex((option) => option.value === value)
            )
          )
          event.target.select()
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setHighlighted(0)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul id={listboxId} role="listbox" className={styles.timezoneList} aria-label={ariaLabel}>
          {results.length === 0 && (
            <li role="presentation" className={styles.timezoneEmpty}>
              {t('general.homeTimezone.noResults')}
            </li>
          )}
          {results.map((option, index) => (
            <li
              key={option.value || 'automatic'}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`${styles.timezoneOption} ${
                index === highlighted ? styles.timezoneOptionActive : ''
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => choose(option)}
            >
              {option.label}
              {option.label !== option.value && option.value && (
                <span className={styles.timezoneOptionZone}>{option.value}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
