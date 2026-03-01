import type { JSX } from 'react'
import { useEffect, useRef, useCallback, type KeyboardEvent } from 'react'
import styles from './SearchBar.module.css'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onOpen: () => void
  onClose: () => void
  isOpen: boolean
  placeholder?: string
}

export function SearchBar({
  value,
  onChange,
  onClear,
  onOpen,
  onClose,
  isOpen,
  placeholder = 'Search events...',
}: SearchBarProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        if (!isOpen) {
          onOpen()
          setTimeout(() => inputRef.current?.focus(), 0)
        }
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)

    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [isOpen, onOpen])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  return (
    <div className={styles.searchBar}>
      <div className={styles.searchInputWrapper}>
        <svg
          className={styles.searchIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search events"
        />
        {value && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={onClear}
            aria-label="Clear search"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
        {!value && isOpen && <span className={styles.shortcutHint}>Esc</span>}
        {!value && !isOpen && <span className={styles.shortcutHint}>⌘K</span>}
      </div>
    </div>
  )
}
