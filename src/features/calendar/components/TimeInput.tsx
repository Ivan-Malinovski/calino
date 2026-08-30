import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { TimeFormat } from '@/types'
import { stepTimeStr } from '@/lib/datetime'
import styles from './EventModal.module.css'

/**
 * Minutes per scroll notch / arrow press. Matches the step `useScrollInput`
 * applies to native time inputs, so the two paths can't drift apart.
 */
const STEP_MINUTES = 15
const MINUTES_PER_DAY = 24 * 60
const TIME_OPTIONS = Array.from({ length: MINUTES_PER_DAY / STEP_MINUTES }, (_, index) => {
  const minutes = index * STEP_MINUTES
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

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

interface MenuPosition {
  left: number
  width: number
  top: number
  bottom: number
  maxHeight: number
  placement: 'above' | 'below'
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
  const [open, setOpen] = useState(false)
  const [hasTypedQuery, setHasTypedQuery] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [showTopFade, setShowTopFade] = useState(false)
  const [showBottomFade, setShowBottomFade] = useState(false)
  const listboxId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const optionRefs = useRef<Array<HTMLLIElement | null>>([])
  const alignHighlightToTopRef = useRef(false)
  const hasNavigatedRef = useRef(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    left: 0,
    width: 0,
    top: 0,
    bottom: 0,
    maxHeight: 280,
    placement: 'below',
  })

  useEffect(() => {
    setDraft(formattedValue)
  }, [formattedValue])

  const matchingOptions = useMemo(() => {
    if (!hasTypedQuery || draft.trim() === '') return TIME_OPTIONS
    const query = draft.trim().toLowerCase()
    return TIME_OPTIONS.filter((option) => {
      const display = formatTimeValue(option, resolvedTimeFormat).toLowerCase()
      return option.includes(query) || display.includes(query)
    })
  }, [draft, hasTypedQuery, resolvedTimeFormat])

  const listIsOpen = open && matchingOptions.length > 0

  const indexForValue = useCallback((time: string): number => {
    const [hours, minutes] = time.split(':').map(Number)
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return 0
    const nearest = Math.round((hours * 60 + minutes) / STEP_MINUTES) % TIME_OPTIONS.length
    return Math.max(0, nearest)
  }, [])

  const updateMenuPosition = useCallback((): void => {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const dialog = wrapperRef.current?.closest('[role="dialog"]')
    const footer = dialog?.querySelector('[data-component="modal-footer"]')
    const footerTop = footer?.getBoundingClientRect().top ?? window.innerHeight
    const gap = 4
    const spaceBelow = Math.max(0, Math.min(window.innerHeight, footerTop) - rect.bottom - gap)
    const spaceAbove = Math.max(0, rect.top - gap)
    const placement = spaceBelow < 100 && spaceAbove > spaceBelow ? 'above' : 'below'
    const availableSpace = placement === 'above' ? spaceAbove : spaceBelow

    setMenuPosition({
      left: rect.left,
      width: rect.width,
      top: rect.top,
      bottom: rect.bottom,
      maxHeight: Math.max(40, Math.min(280, availableSpace)),
      placement,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
        setHighlightedIndex(-1)
        setHasTypedQuery(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useLayoutEffect(() => {
    if (!listIsOpen) return
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    document.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      document.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [listIsOpen, updateMenuPosition])

  useLayoutEffect(() => {
    if (highlightedIndex < 0) return
    const option = optionRefs.current[highlightedIndex]
    const menu = menuRef.current
    if (!option || !menu) return
    if (alignHighlightToTopRef.current) {
      const menuRect = menu.getBoundingClientRect()
      const optionRect = option.getBoundingClientRect()
      menu.scrollTop = Math.max(0, menu.scrollTop + optionRect.top - menuRect.top - 4)
      alignHighlightToTopRef.current = false
      return
    }
    option.scrollIntoView?.({ block: 'nearest' })
  }, [highlightedIndex, matchingOptions])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!listIsOpen || !menu) {
      setShowTopFade(false)
      setShowBottomFade(false)
      return
    }

    const updateScrollFades = (): void => {
      setShowTopFade(menu.scrollTop > 0)
      setShowBottomFade(menu.scrollTop + menu.clientHeight < menu.scrollHeight - 1)
    }
    updateScrollFades()
    menu.addEventListener('scroll', updateScrollFades)
    return () => menu.removeEventListener('scroll', updateScrollFades)
  }, [listIsOpen, matchingOptions])

  const commit = (): void => {
    const parsed = parseTimeValue(draft, resolvedTimeFormat, true)
    if (parsed && parsed !== value) onChange(parsed)
    setDraft(formatTimeValue(parsed ?? value, resolvedTimeFormat))
  }

  const selectSuggestion = (suggestion: string): void => {
    setDraft(formatTimeValue(suggestion, resolvedTimeFormat))
    onChange(suggestion)
    setOpen(false)
    setHasTypedQuery(false)
    setHighlightedIndex(-1)
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

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      if (!open || matchingOptions.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setHasTypedQuery(false)
      setHighlightedIndex(-1)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      hasNavigatedRef.current = true
      if (!open) {
        setHasTypedQuery(false)
        setOpen(true)
      }
      const draftValue = parseTimeValue(draft, resolvedTimeFormat, true)
      const currentValue = draftValue ?? value
      const currentOption = TIME_OPTIONS[indexForValue(currentValue)]
      // Once a complete quarter-hour has been typed, keep the full list
      // available for arrow navigation so ArrowDown means "next" rather than
      // re-selecting the sole exact match.
      const options =
        matchingOptions.length === 1 && matchingOptions[0] === currentOption
          ? TIME_OPTIONS
          : matchingOptions.length > 0
            ? matchingOptions
            : TIME_OPTIONS
      setHighlightedIndex((current) => {
        const currentOptionIndex = options.indexOf(currentOption)
        const startingIndex = currentOptionIndex >= 0 ? currentOptionIndex : current
        if (event.key === 'ArrowDown')
          return startingIndex < options.length - 1 ? startingIndex + 1 : 0
        return startingIndex > 0 ? startingIndex - 1 : options.length - 1
      })
      return
    }

    if (event.key === 'Enter' && listIsOpen && highlightedIndex >= 0) {
      event.preventDefault()
      if (hasNavigatedRef.current || hasTypedQuery || TIME_OPTIONS[highlightedIndex] === value) {
        selectSuggestion(matchingOptions[highlightedIndex] ?? TIME_OPTIONS[highlightedIndex])
      }
      event.currentTarget.blur()
    }
  }

  // Attached natively rather than via React's `onWheel`: React registers wheel
  // listeners as passive, so preventDefault there is ignored (and warns) and
  // the page would scroll underneath the adjustment.
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
    <div ref={wrapperRef} className={styles.timeInputWrapper} data-component="time-picker">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={listIsOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          listIsOpen && highlightedIndex >= 0
            ? `${listboxId}-option-${highlightedIndex}`
            : undefined
        }
        value={draft}
        onFocus={(event) => {
          setOpen(true)
          setHasTypedQuery(false)
          hasNavigatedRef.current = false
          alignHighlightToTopRef.current = true
          setHighlightedIndex(indexForValue(value))
          event.currentTarget.select()
        }}
        onChange={(event) => {
          const nextDraft = event.target.value
          setDraft(nextDraft)
          setHasTypedQuery(true)
          hasNavigatedRef.current = false
          setOpen(true)
          setHighlightedIndex(0)
          const parsed = parseTimeValue(nextDraft, resolvedTimeFormat)
          if (parsed) onChange(parsed)
        }}
        onBlur={() => {
          commit()
          setOpen(false)
          setHasTypedQuery(false)
          setHighlightedIndex(-1)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            // Otherwise the caret jumps to one end of the text, and in the
            // preview popup the keydown reaches the dialog's own handlers.
            handleKeyDown(event)
            return
          }
          handleKeyDown(event)
          if (event.key === 'Enter' && !(listIsOpen && highlightedIndex >= 0)) {
            event.currentTarget.blur()
          }
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
      {listIsOpen &&
        createPortal(
          <div
            className={styles.timePickerViewport}
            data-component="time-picker-options"
            style={
              menuPosition.placement === 'above'
                ? {
                    left: menuPosition.left,
                    bottom: window.innerHeight - menuPosition.top + 4,
                    width: menuPosition.width,
                    height: menuPosition.maxHeight,
                  }
                : {
                    left: menuPosition.left,
                    top: menuPosition.bottom + 4,
                    width: menuPosition.width,
                    height: menuPosition.maxHeight,
                  }
            }
          >
            <ul ref={menuRef} id={listboxId} role="listbox" className={styles.timePickerOptions}>
              {matchingOptions.map((suggestion, index) => (
                <li
                  key={suggestion}
                  ref={(element) => {
                    optionRefs.current[index] = element
                  }}
                  role="option"
                  id={`${listboxId}-option-${index}`}
                  aria-selected={index === highlightedIndex}
                  className={`${styles.timePickerOption} ${
                    index === highlightedIndex ? styles.timePickerOptionActive : ''
                  }`}
                  data-component="time-picker-option"
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {formatTimeValue(suggestion, resolvedTimeFormat)}
                </li>
              ))}
            </ul>
            {showTopFade && <div className={styles.timePickerFadeTop} aria-hidden="true" />}
            {showBottomFade && <div className={styles.timePickerFadeBottom} aria-hidden="true" />}
          </div>,
          document.body
        )}
    </div>
  )
}
