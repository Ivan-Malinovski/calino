import type { JSX } from 'react'
import { useEffect, useCallback, useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/store/settingsStore'
import { useCommandPalette } from '../hooks/useCommandPalette'
import { renderCommandItemContent } from './CommandItem'
import { showToast } from '@/lib/toast'
import type { CommandPaletteItem, CommandPaletteItemGroup } from '../types'
import styles from './CommandPalette.module.css'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  toggleSidebar?: () => void
  sidebarOpen?: boolean
}

const TYPING_SPEED = 45
const PAUSE_AFTER_TYPING = 2000
const ERASING_SPEED = 25

// Group order for display. "quick-add" leads so that when a phrase is parsed
// as an event the create-action is the default selection (Enter creates it),
// while any matching existing events/calendars/commands still appear below.
const GROUP_ORDER: CommandPaletteItemGroup[] = [
  'quick-add',
  'navigation',
  'actions',
  'settings',
  'event',
  'task',
  'journal',
  'calendars',
]

function getCategoryLabel(
  t: (key: string) => string,
  category: CommandPaletteItemGroup
): string {
  const labels: Record<CommandPaletteItemGroup, string> = {
    navigation: t('palette.category.navigation'),
    actions: t('palette.category.actions'),
    settings: t('palette.category.settings'),
    calendars: t('palette.category.calendars'),
    event: t('palette.category.events'),
    task: t('palette.category.tasks'),
    journal: t('palette.category.journal'),
    'quick-add': t('palette.category.quickAdd'),
  }
  return labels[category] || category
}

export function CommandPalette({
  isOpen,
  onClose,
  toggleSidebar,
  sidebarOpen,
}: CommandPaletteProps): JSX.Element | null {
  const { t } = useTranslation('commands')
  const language = useSettingsStore((state) => state.language)
  const placeholders = useMemo(
    () => [
      ...(language === 'en' ? [t('palette.placeholder.hangOut')] : []),
      t('palette.placeholder.toggleDarkMode'),
      t('palette.placeholder.syncCalendars'),
      ...(language === 'en' ? [t('palette.placeholder.goToNextWeek')] : []),
      t('palette.placeholder.toggleSidebar'),
      t('palette.placeholder.newEvent'),
    ],
    [language, t]
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(true)
  // Internal visibility state: stays true for one extra frame after the
  // parent flips isOpen false, so the closing animation can play.
  const [rendered, setRendered] = useState(isOpen)
  const [closing, setClosing] = useState(false)
  const { query, setQuery, items } = useCommandPalette({
    isOpen: rendered && !closing,
    toggleSidebar,
    sidebarOpen,
  })

  const timeFormat = useSettingsStore((state) => state.timeFormat)

  // Group items by category, preserving order
  const groupedItems = useMemo(() => {
    const groups = new Map<CommandPaletteItemGroup, CommandPaletteItem[]>()
    for (const item of items) {
      const arr = groups.get(item.group) ?? []
      arr.push(item)
      groups.set(item.group, arr)
    }
    const ordered: { group: CommandPaletteItemGroup; items: CommandPaletteItem[] }[] = []
    for (const g of GROUP_ORDER) {
      const list = groups.get(g)
      if (list && list.length > 0) ordered.push({ group: g, items: list })
    }
    return ordered
  }, [items])

  // Sync internal rendered/closing state with the parent's isOpen prop.
  useEffect(() => {
    if (isOpen) {
      setRendered(true)
      setClosing(false)
    } else if (rendered) {
      setClosing(true)
    }
  }, [isOpen, rendered])

  // After the close animation finishes, unmount and call the parent's onClose
  // so it can clean up its own state.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Cancel any pending close when re-opening (fixes rapid open/close race)
  useEffect(() => {
    if (isOpen) {
      clearTimeout(closeTimerRef.current)
    }
  }, [isOpen])

  useEffect(() => {
    if (!closing) return
    closeTimerRef.current = setTimeout(() => {
      setRendered(false)
      setClosing(false)
      onCloseRef.current()
      setQuery('')
    }, 140) // matches .closing animation duration in CSS
    return () => clearTimeout(closeTimerRef.current)
  }, [closing])

  // Typewriter animation
  useEffect(() => {
    if (!isOpen || query) return

    const target = placeholders[placeholderIndex]
    let timeout: ReturnType<typeof setTimeout>

    if (isTyping) {
      if (displayedText.length < target.length) {
        timeout = setTimeout(() => {
          setDisplayedText(target.slice(0, displayedText.length + 1))
        }, TYPING_SPEED)
      } else {
        timeout = setTimeout(() => {
          setIsTyping(false)
        }, PAUSE_AFTER_TYPING)
      }
    } else {
      if (displayedText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayedText(displayedText.slice(0, -1))
        }, ERASING_SPEED)
      } else {
        setPlaceholderIndex((i) => (i + 1) % placeholders.length)
        setIsTyping(true)
      }
    }

    return () => clearTimeout(timeout)
  }, [isOpen, query, displayedText, isTyping, placeholderIndex])

  // Reset animation when opened
  useEffect(() => {
    if (isOpen) {
      setPlaceholderIndex(0)
      setDisplayedText('')
      setIsTyping(true)
    }
  }, [isOpen])

  // Auto-focus and select the input when the palette opens. The standard
  // command-palette UX: opening the palette highlights the existing query
  // (if any) so the user can type to replace it.
  //
  // Note: when the parent mounts the palette with isOpen=false and later
  // flips it to true, this component renders `null` on the first re-render
  // (because `rendered` is still false from `useState(isOpen)`), then the
  // effect above flips `rendered` to true, which causes a second re-render
  // where the input is actually in the DOM. The first time this effect runs
  // (isOpen flipping false→true) the input is not yet mounted, so we depend
  // on `rendered` to re-run once the palette is actually visible.
  useEffect(() => {
    if (!isOpen || !rendered) return
    const focusAndSelect = (): void => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      try {
        el.setSelectionRange(0, el.value.length)
      } catch {
        el.select()
      }
    }
    const t1 = setTimeout(focusAndSelect, 0)
    const t2 = setTimeout(focusAndSelect, 30)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [isOpen, rendered])

  // Trigger close-with-animation. Sets `closing` and lets the useEffect
  // run the exit transition before the parent unmounts the palette.
  const requestClose = useCallback(() => {
    setClosing(true)
  }, [])

  // Handle item selection: execute + toast + close
  const justSelectedRef = useRef(false)
  const handleSelect = useCallback(
    (item: CommandPaletteItem) => async () => {
      justSelectedRef.current = true
      try {
        const result = await item.onSelect()
        if (result?.success && result.message) {
          showToast(result.message, {
            linkText: result.linkText,
            onLinkClick: result.onLinkClick,
          })
        }
      } finally {
        requestClose()
      }
    },
    [requestClose]
  )

  // Bug 9 parity: Enter on the modal should close the palette even when
  // cmdk didn't fire onSelect (e.g. the list is empty). If onSelect just
  // fired in the same event tick, cmdk's onSelect already closed — don't
  // double-close.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return
      if (justSelectedRef.current) {
        justSelectedRef.current = false
        return
      }
      requestClose()
    },
    [requestClose]
  )

  // Global Ctrl+K / Cmd+K toggles, Escape closes (cmdk handles its own Esc too)
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) {
          requestClose()
        }
        return
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault()
        requestClose()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isOpen, requestClose])

  if (!rendered) return null

  const palette = (
    <div
      className={`${styles.container} ${closing ? styles.closing : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.commandPalette')}
      data-component="command-palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div className={styles.modal} onKeyDown={handleKeyDown}>
        <Command label={t('palette.commandPalette')} shouldFilter={false} loop className={styles.command}>
          <div className={styles.inputWrapper}>
            <svg
              className={styles.inputIcon}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <div className={styles.inputContainer}>
              {!query && displayedText && (
                <span className={styles.placeholder}>
                  {displayedText}
                  <span className={styles.cursor} />
                </span>
              )}
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                className={styles.input}
              />
            </div>
            {!query && <span className={styles.escBadge}>{t('palette.esc')}</span>}
          </div>

          <Command.List className={styles.results}>
            <Command.Empty className={styles.empty}>
              {query
                ? t('palette.noResults')
                : t('palette.typeToSearch')}
            </Command.Empty>

            {groupedItems.map(({ group, items: groupItems }, groupIdx) => (
              <Command.Group
                key={group}
                heading={getCategoryLabel(t, group)}
                value={group}
                className={styles.group}
              >
                {groupIdx > 0 && <Command.Separator className={styles.separator} />}
                {groupItems.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.value}
                    onSelect={handleSelect(item)}
                    className={styles.item}
                  >
                    {renderCommandItemContent({
                      item: item.data,
                      type: item.itemType,
                      timeFormat,
                      t,
                    })}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>

          <div className={styles.footer}>
            <span className={styles.hint}>
              <span className={styles.hintKbd}>↑↓</span>
              {t('palette.navigate')}
            </span>
            <span className={styles.hint}>
              <span className={styles.hintKbd}>↵</span>
              {t('palette.select')}
            </span>
            <span className={styles.hint}>
              <span className={styles.hintKbd}>Esc</span>
              {t('palette.close')}
            </span>
          </div>
        </Command>
      </div>
    </div>
  )

  return createPortal(palette, document.body)
}
