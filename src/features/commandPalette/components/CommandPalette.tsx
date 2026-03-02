import type { JSX } from 'react'
import { useRef, useEffect } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { useCommandPalette } from '../hooks/useCommandPalette'
import { CommandItem } from './CommandItem'
import styles from './CommandPalette.module.css'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    query,
    setQuery,
    results,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    executeSelected,
  } = useCommandPalette({ isOpen })

  const timeFormat = useSettingsStore((state) => state.timeFormat)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (!isOpen) {
          onClose()
        }
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleItemClick = (index: number) => {
    setSelectedIndex(index)
    const result = executeSelected()
    if (result?.success && result.message) {
      window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: result.message } }))
    }
    onClose()
  }

  const getCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      navigation: 'Navigation',
      actions: 'Actions',
      settings: 'Settings',
      search: 'Search Results',
      event: 'Events',
      'quick-add': 'Quick Add',
    }
    return labels[category] || category
  }

  const groupedResults = results.reduce(
    (acc, result, index) => {
      let category = 'command'
      if (result.type === 'event') category = 'event'
      if (result.type === 'calendar') category = 'calendar'
      if (result.type === 'quick-add') category = 'quick-add'
      if (result.type === 'command') {
        const cmd = result.item as { category: string }
        category = cmd.category
      }

      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push({ ...result, index })
      return acc
    },
    {} as Record<string, Array<{ type: string; item: unknown; score: number; index: number }>>
  )

  return (
    <div className={styles.container} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputWrapper}>
          <svg
            className={styles.inputIcon}
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
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, events, or type to navigate..."
          />
          {!query && <span className={styles.shortcut}>Esc</span>}
        </div>

        <div className={styles.results}>
          {results.length === 0 && query && (
            <div className={styles.empty}>No results found. Try a different search term.</div>
          )}
          {results.length === 0 && !query && (
            <div className={styles.empty}>Type to search commands, events, or calendars.</div>
          )}
          {Object.entries(groupedResults).map(([category, items]) => (
            <div key={category}>
              <div className={styles.categoryLabel}>{getCategoryLabel(category)}</div>
              {items.map((result) => (
                <CommandItem
                  key={result.index}
                  item={result.item as Parameters<typeof CommandItem>[0]['item']}
                  type={result.type as 'command' | 'event' | 'calendar' | 'quick-add'}
                  isSelected={selectedIndex === result.index}
                  onClick={() => handleItemClick(result.index)}
                  timeFormat={timeFormat}
                />
              ))}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <div className={styles.footerHints}>
            <span className={styles.hint}>
              <kbd>↑↓</kbd> Navigate
            </span>
            <span className={styles.hint}>
              <kbd>↵</kbd> Select
            </span>
            <span className={styles.hint}>
              <kbd>Esc</kbd> Close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
