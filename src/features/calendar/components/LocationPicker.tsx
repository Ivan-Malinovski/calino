import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent } from '@/types'
import { getLocationSuggestions } from '../lib/locationSuggestions'
import styles from './EventModal.module.css'

interface LocationPickerProps {
  value: string
  events: CalendarEvent[]
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  /** Selector for the editable combobox input. */
  'data-component'?: string
}

interface MenuPosition {
  left: number
  width: number
  top: number
  bottom: number
  maxHeight: number
  placement: 'above' | 'below'
}

export function LocationPicker({
  value,
  events,
  onChange,
  placeholder,
  id,
  'data-component': dataComponent = 'location-picker-input',
}: LocationPickerProps): JSX.Element {
  const listboxId = useId()
  const generatedInputId = useId()
  const inputId = id ?? generatedInputId
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    left: 0,
    width: 0,
    top: 0,
    bottom: 0,
    maxHeight: 200,
    placement: 'below',
  })
  const suggestions = useMemo(() => getLocationSuggestions(events, value), [events, value])
  const listIsOpen = open && suggestions.length > 0

  const updateMenuPosition = useCallback((): void => {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const dialog = containerRef.current?.closest('[role="dialog"]')
    const footer = dialog?.querySelector('[data-component="modal-footer"]')
    const footerTop = footer?.getBoundingClientRect().top ?? window.innerHeight
    const gap = 4
    const spaceBelow = Math.max(0, Math.min(window.innerHeight, footerTop) - rect.bottom - gap)
    const spaceAbove = Math.max(0, rect.top - gap)
    const placement = spaceBelow < 80 && spaceAbove > spaceBelow ? 'above' : 'below'
    const availableSpace = placement === 'above' ? spaceAbove : spaceBelow

    setMenuPosition({
      left: rect.left,
      width: rect.width,
      top: rect.top,
      bottom: rect.bottom,
      maxHeight: Math.max(40, Math.min(200, availableSpace)),
      placement,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
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

  useEffect(() => {
    if (highlightedIndex < 0) return
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const selectSuggestion = (suggestion: string): void => {
    onChange(suggestion)
    setOpen(false)
    setHighlightedIndex(-1)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      if (!open || suggestions.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setHighlightedIndex(-1)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (!open) setOpen(true)
      if (suggestions.length === 0) return
      setHighlightedIndex((current) => {
        if (event.key === 'ArrowDown') {
          return current < suggestions.length - 1 ? current + 1 : 0
        }
        return current > 0 ? current - 1 : suggestions.length - 1
      })
      return
    }

    if (event.key === 'Enter' && open && suggestions.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      selectSuggestion(suggestions[highlightedIndex >= 0 ? highlightedIndex : 0])
    }
  }

  return (
    <div ref={containerRef} className={styles.locationPicker} data-component="location-picker">
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
        id={inputId}
        placeholder={placeholder}
        value={value}
        onFocus={() => {
          setOpen(true)
          setHighlightedIndex(-1)
        }}
        onBlur={() => {
          setOpen(false)
          setHighlightedIndex(-1)
        }}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setHighlightedIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        className={styles.modalInput}
        data-component={dataComponent}
      />
      {listIsOpen &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            className={styles.locationSuggestions}
            data-component="location-picker-options"
            style={
              menuPosition.placement === 'above'
                ? {
                    left: menuPosition.left,
                    bottom: window.innerHeight - menuPosition.top + 4,
                    width: menuPosition.width,
                    maxHeight: menuPosition.maxHeight,
                  }
                : {
                    left: menuPosition.left,
                    top: menuPosition.bottom + 4,
                    width: menuPosition.width,
                    maxHeight: menuPosition.maxHeight,
                  }
            }
          >
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion}-${index}`} role="presentation">
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element
                  }}
                  type="button"
                  role="option"
                  id={`${listboxId}-option-${index}`}
                  aria-selected={index === highlightedIndex}
                  className={`${styles.locationSuggestion} ${
                    index === highlightedIndex ? styles.locationSuggestionActive : ''
                  }`}
                  data-component="location-picker-option"
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  )
}
