import type { JSX } from 'react'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { format, parseISO } from 'date-fns'
import { useCalendarStore, getJournalEntriesForDate } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { v4 as uuidv4 } from 'uuid'
import { MarkdownView } from '@/lib/markdown'
import { showToast } from '@/lib/toast'
import { putAttachments, getAttachments, deleteAttachments } from '@/lib/attachmentStore'
import type { CalendarEvent, CalendarAttachment } from '@/types'
import { AttachmentSection } from './AttachmentSection'
import { syncJournalEntryToServer } from '../lib/journalSync'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useSheetSwipeDismiss } from '@/hooks/useSheetSwipeDismiss'
import styles from './JournalDayModal.module.css'

interface JournalDayModalProps {
  isOpen: boolean
  date: string // ISO date string (yyyy-MM-dd)
  startInCompose?: boolean
  onClose: () => void
}

type ModalMode = 'view' | 'compose' | 'edit'

/** Roughly how long the mobile sheet's slide-up takes to settle. */
const SHEET_ENTRANCE_MS = 340

export function JournalDayModal({
  isOpen,
  date,
  startInCompose = false,
  onClose,
}: JournalDayModalProps): JSX.Element | null {
  const events = useCalendarStore((state) => state.events)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const calendars = useCalendarStore((state) => state.calendars)
  const categories = useCalendarStore((state) => state.categories)
  const {
    createEvent: createCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    deleteEvent: deleteCalDAVEvent,
    deleteEventByHref: deleteCalDAVEventByHref,
  } = useCalDAV()

  const [mode, setMode] = useState<ModalMode>('view')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [attachments, setAttachments] = useState<CalendarAttachment[]>([])
  const [url, setUrl] = useState('')
  const [relatedTo, setRelatedTo] = useState<string[]>([])
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [focusedEntryIndex, setFocusedEntryIndex] = useState<number>(-1)
  const [calendarId, setCalendarId] = useState<string>('')

  const panelRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const bodyInputRef = useRef<HTMLTextAreaElement>(null)

  // Refs for stable values used in callbacks (#9)
  const eventsRef = useRef(events)
  const calendarsRef = useRef(calendars)
  useEffect(() => {
    eventsRef.current = events
  })
  useEffect(() => {
    calendarsRef.current = calendars
  })

  // Get journal entries for this date, scoped to the calendars the user has
  // ticked in the sidebar — same rule as events and tasks (issue #88).
  const visibleCalendarIds = useMemo(
    () => new Set(calendars.filter((c) => c.isVisible).map((c) => c.id)),
    [calendars]
  )
  const entries = useMemo(
    () => getJournalEntriesForDate(events, date, visibleCalendarIds),
    [events, date, visibleCalendarIds]
  )

  const writableCalendars = useMemo(() => calendars.filter((c) => !c.readOnly), [calendars])
  const defaultCalendarId = useMemo(() => {
    const preferred = writableCalendars.find((c) => c.isDefault) ?? writableCalendars[0]
    return preferred?.id ?? 'default'
  }, [writableCalendars])

  // Parse the date for display
  const dateObj = parseISO(date)
  const dayNum = format(dateObj, 'd')
  const weekday = format(dateObj, 'EEEE')
  const monthYear = format(dateObj, 'MMMM yyyy')

  // Reset mode when modal opens
  useEffect(() => {
    if (isOpen) {
      if (startInCompose) {
        setMode('compose')
      } else {
        setMode('view')
      }
      setEditingId(null)
      setTitle('')
      setBody('')
      setSelectedCategories([])
      setAttachments([])
      setUrl('')
      setRelatedTo([])
      setCalendarId(defaultCalendarId)
      setShowAddPanel(false)
      setConfirmDeleteId(null)
    }
  }, [isOpen, date, startInCompose, defaultCalendarId])

  // Focus input when entering compose/edit mode. When that mode change is the
  // one that opened the sheet, the focus waits for the entrance to land:
  // focusing mid-flight raises the keyboard, which resizes the `dvh`-sized
  // sheet while it's still travelling and reads as a stutter. Switching modes
  // on an already-open sheet keeps the original snappy delay.
  const isMobile = useIsMobile()
  const prefersReducedMotion = useReducedMotion()
  const openedAtRef = useRef(0)
  useEffect(() => {
    if (isOpen) openedAtRef.current = Date.now()
  }, [isOpen])

  useEffect(() => {
    if (mode !== 'compose' && mode !== 'edit') return
    const sinceOpen = Date.now() - openedAtRef.current
    const animating = isMobile && !prefersReducedMotion && sinceOpen < SHEET_ENTRANCE_MS
    const timer = setTimeout(
      () => titleInputRef.current?.focus(),
      animating ? SHEET_ENTRANCE_MS - sinceOpen : 80
    )
    return () => clearTimeout(timer)
  }, [mode, isMobile, prefersReducedMotion])

  // Reset focused entry index when entries change or modal opens
  useEffect(() => {
    setFocusedEntryIndex(-1)
  }, [entries.length, isOpen])

  const handleSave = useCallback((): void => {
    const trimmedBody = body.trim()
    if (!trimmedBody) {
      bodyInputRef.current?.focus()
      return
    }

    const trimmedTitle = title.trim()
    const now = new Date().toISOString()
    const currentEvents = eventsRef.current
    const currentCalendars = calendarsRef.current

    if (mode === 'edit' && editingId) {
      // Update existing entry
      const existing = currentEvents.find((e) => e.id === editingId)
      if (existing) {
        const updates: Partial<CalendarEvent> = {
          title: trimmedTitle,
          description: trimmedBody,
          lastModified: now,
          calendarId,
          categories: selectedCategories.length > 0 ? selectedCategories : undefined,
          url: url || undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
          relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
          // Moving to the Offline calendar deletes the server resource; drop
          // the now-stale server metadata so the entry is a clean local-only
          // record (no dangling href/etag/syncStatus pointing at a 404).
          ...(calendarId === 'default'
            ? { resourceHref: undefined, etag: undefined, syncStatus: undefined }
            : {}),
        }
        updateEvent(editingId, updates)

        // Push to the server, routing by where the entry came from and where
        // it is going (see syncJournalEntryToServer — shared with JournalView
        // so the branches can't drift apart).
        const syncedEntry: CalendarEvent = { ...existing, ...updates }
        const syncToServer = (): void =>
          syncJournalEntryToServer({
            existing,
            targetCalendarId: calendarId,
            syncedEntry,
            updateCalDAVEvent,
            createCalDAVEvent,
            deleteCalDAVEventByHref,
            showToast,
          })

        // Sync attachments to IDB, then push to server
        if (attachments.length > 0) {
          putAttachments(editingId, attachments)
            .then(() => syncToServer())
            .catch(() => {
              showToast('Failed to save attachments locally')
            })
        } else {
          deleteAttachments(editingId).catch(() => {})
          syncToServer()
        }
      }
    } else {
      // Create new entry — honour the picker, falling back to the default
      // calendar when it was never shown (single writable calendar).
      const defaultCalendar =
        currentCalendars.find((c) => c.id === calendarId) ??
        currentCalendars.find((c) => c.isDefault) ??
        currentCalendars[0]
      const newId = uuidv4()
      const newEntry: CalendarEvent = {
        id: newId,
        calendarId: defaultCalendar?.id || 'default',
        title: trimmedTitle,
        description: trimmedBody,
        start: date,
        end: date,
        isAllDay: true,
        type: 'journal',
        created: now,
        lastModified: now,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        url: url || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
      }
      addEvent(newEntry)
      if (attachments.length > 0) {
        // Await IDB write before pushing to server (race condition fix)
        putAttachments(newId, attachments)
          .then(() => {
            // Clean up the 'new' key used during composition
            deleteAttachments('new').catch(() => {})
            if (defaultCalendar?.id !== 'default') {
              createCalDAVEvent(newEntry.calendarId, newEntry).catch(() => {
                showToast('Failed to sync entry. It will be retried.')
              })
            }
          })
          .catch(() => {
            showToast('Failed to save attachments locally')
          })
      } else {
        deleteAttachments('new').catch(() => {})
        if (defaultCalendar?.id !== 'default') {
          createCalDAVEvent(newEntry.calendarId, newEntry).catch(() => {
            showToast('Failed to sync entry. It will be retried.')
          })
        }
      }
    }

    setMode('view')
    setEditingId(null)
    setTitle('')
    setBody('')
    setSelectedCategories([])
    setAttachments([])
    setUrl('')
    setRelatedTo([])
    setShowAddPanel(false)
  }, [
    mode,
    editingId,
    title,
    body,
    date,
    selectedCategories,
    attachments,
    url,
    relatedTo,
    calendarId,
    addEvent,
    updateEvent,
    createCalDAVEvent,
    updateCalDAVEvent,
    deleteCalDAVEventByHref,
  ])

  // Ref for handleSave to avoid stale closure in keyboard effect (#10)
  const handleSaveRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    handleSaveRef.current = handleSave
  })

  const handleStartEdit = useCallback((entry: CalendarEvent): void => {
    setEditingId(entry.id)
    setCalendarId(entry.calendarId)
    setTitle(entry.title || '')
    setBody(entry.description || '')
    setSelectedCategories(entry.categories || [])
    setUrl(entry.url || '')
    setRelatedTo(entry.relatedTo || [])
    setMode('edit')
    // Load attachments from IndexedDB
    getAttachments(entry.id)
      .then((loaded) => {
        setAttachments(loaded.length > 0 ? loaded : entry.attachments || [])
      })
      .catch(() => {
        setAttachments(entry.attachments || [])
      })
    // Always start with add panel collapsed
    setShowAddPanel(false)
  }, [])

  const handleStartCompose = useCallback((): void => {
    setEditingId(null)
    setTitle('')
    setBody('')
    setSelectedCategories([])
    setAttachments([])
    setUrl('')
    setRelatedTo([])
    setCalendarId(defaultCalendarId)
    setShowAddPanel(false)
    setMode('compose')
  }, [defaultCalendarId])

  const handleDelete = useCallback(
    (entryId: string): void => {
      if (confirmDeleteId === entryId) {
        // Actually delete
        const entry = eventsRef.current.find((e) => e.id === entryId)
        // Sync CalDAV first so it can capture the etag before the local delete
        if (entry && entry.calendarId !== 'default') {
          deleteCalDAVEvent(entry.calendarId, entry.id).catch(() => {
            showToast('Failed to sync deletion. It will be retried.')
          })
        }
        deleteEvent(entryId)
        setConfirmDeleteId(null)
        setMode('view')
        setEditingId(null)
        setTitle('')
        setBody('')

        // Show undo toast (#17)
        if (entry) {
          showToast('Entry deleted', {
            duration: 8000,
            onUndo: () => {
              addEvent(entry)
              if (entry.calendarId !== 'default') {
                createCalDAVEvent(entry.calendarId, entry).catch(() => {
                  showToast('Failed to restore entry.')
                })
              }
            },
          })
        }
      } else {
        // First click — show confirm
        setConfirmDeleteId(entryId)
      }
    },
    [confirmDeleteId, deleteEvent, deleteCalDAVEvent, addEvent, createCalDAVEvent]
  )

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (mode === 'view') {
          onClose()
        } else {
          setMode('view')
          setEditingId(null)
          setTitle('')
          setBody('')
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (mode === 'compose' || mode === 'edit') {
          handleSaveRef.current?.()
        }
      }
      // Arrow key navigation between entries (#19)
      if (mode === 'view' && entries.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'j') {
          e.preventDefault()
          setFocusedEntryIndex((prev) => (prev < 0 ? 0 : Math.min(prev + 1, entries.length - 1)))
        } else if (e.key === 'ArrowUp' || e.key === 'k') {
          e.preventDefault()
          setFocusedEntryIndex((prev) => Math.max(prev - 1, 0))
        } else if ((e.key === 'Enter' || e.key === 'o') && focusedEntryIndex >= 0) {
          e.preventDefault()
          const entry = entries[focusedEntryIndex]
          if (entry) handleStartEdit(entry)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, mode, onClose, entries, focusedEntryIndex, handleStartEdit])

  // Close on Escape only (no click-outside — same as EventModal)
  useFocusTrap(panelRef, isOpen)

  // Swipe-down-to-dismiss, matching the event modal. The panel is its own
  // scroll container, so it doubles as the scroll region the gesture defers
  // to while there's still content to scroll up into.
  const sheetY = useSheetSwipeDismiss({
    enabled: isMobile,
    open: isOpen,
    sheetRef: panelRef,
    scrollRef: panelRef,
    onDismiss: onClose,
    reducedMotion: prefersReducedMotion,
  })

  if (!isOpen) return null

  return (
    <div className={styles.scrim}>
      <motion.div
        className={styles.panel}
        ref={panelRef}
        style={{ y: sheetY }}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.dragHandle} aria-hidden="true" />
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>

        <div className={styles.dateCol}>
          <span className={styles.day}>{dayNum}</span>
          <span className={styles.weekday}>{weekday}</span>
          <span className={styles.month}>{monthYear}</span>
        </div>

        <div className={styles.content}>
          {mode === 'view' && (
            <>
              <div className={styles.entries}>
                {entries.length === 0 && (
                  <div className={styles.emptyState}>
                    <p>No entries for this day</p>
                    <button className={styles.btnAccent} onClick={handleStartCompose}>
                      Write something
                    </button>
                  </div>
                )}
                {entries.map((entry, index) => (
                  <React.Fragment key={entry.id}>
                    {index > 0 && (
                      <div className={styles.entrySep}>
                        <span>· · ·</span>
                      </div>
                    )}
                    <div
                      className={`${styles.entry} ${focusedEntryIndex === index ? styles.entryFocused : ''}`}
                      tabIndex={0}
                      role="button"
                      onClick={() => handleStartEdit(entry)}
                    >
                      {entry.title && (
                        <div className={styles.entryHeader}>
                          <span className={styles.summary}>{entry.title}</span>
                          <button
                            className={styles.entryEditBtn}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStartEdit(entry)
                            }}
                            aria-label="Edit entry"
                          >
                            <svg
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              width="14"
                              height="14"
                            >
                              <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                            </svg>
                          </button>
                        </div>
                      )}
                      <MarkdownView className={styles.body} text={entry.description || ''} />
                      {entry.categories && entry.categories.length > 0 && (
                        <div className={styles.entryCategories}>
                          {entry.categories.map((cat) => (
                            <span key={cat} className={styles.entryCategoryTag}>
                              {cat}
                            </span>
                          ))}
                        </div>
                      )}
                      {entry.url && (
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.entryLink}
                        >
                          🔗 {entry.url}
                        </a>
                      )}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </>
          )}

          {(mode === 'compose' || mode === 'edit') && (
            <>
              <input
                ref={titleInputRef}
                className={styles.inputTitle}
                type="text"
                placeholder="Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                ref={bodyInputRef}
                className={styles.inputBody}
                placeholder="Write something…"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              {/* #89: the picker appears when composing AND when editing an
                  existing entry — moving an entry between collections works
                  end-to-end via the #86 CalDAV move machinery. */}
              {writableCalendars.length > 1 && (
                <div className={styles.calendarRow}>
                  <label className={styles.calendarLabel} htmlFor="journal-day-calendar-select">
                    Calendar
                  </label>
                  <select
                    id="journal-day-calendar-select"
                    className={styles.calendarSelect}
                    data-component="journal-day-calendar-select"
                    value={calendarId}
                    onChange={(e) => setCalendarId(e.target.value)}
                  >
                    {writableCalendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {/* Add panel — categories, link, attachments */}
              <div className={styles.addPanel}>
                {!showAddPanel ? (
                  <button
                    type="button"
                    className={styles.addToggle}
                    onClick={() => setShowAddPanel(true)}
                  >
                    + Add
                  </button>
                ) : (
                  <div className={styles.addPanelContent}>
                    <button
                      type="button"
                      className={styles.addToggle}
                      onClick={() => setShowAddPanel(false)}
                    >
                      − Hide
                    </button>

                    {/* Categories */}
                    {categories.length > 0 && (
                      <div className={styles.addSection}>
                        <div className={styles.addSectionHeader}>
                          <span className={styles.addSectionLabel}>Categories</span>
                          {selectedCategories.length > 0 && (
                            <button
                              type="button"
                              className={styles.removeFieldButton}
                              onClick={() => setSelectedCategories([])}
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <div className={styles.categoryPicker}>
                          {categories.map((cat) => {
                            const isSelected = selectedCategories.includes(cat.name)
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                className={`${styles.categoryChip} ${isSelected ? styles.categoryChipActive : ''}`}
                                style={{ '--chip-color': cat.color } as React.CSSProperties}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedCategories(
                                      selectedCategories.filter((c) => c !== cat.name)
                                    )
                                  } else {
                                    setSelectedCategories([...selectedCategories, cat.name])
                                  }
                                }}
                              >
                                <span
                                  className={styles.categoryDot}
                                  style={{ backgroundColor: cat.color }}
                                />
                                {cat.name}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* URL */}
                    <div className={styles.addSection}>
                      <div className={styles.addSectionHeader}>
                        <span className={styles.addSectionLabel}>Link</span>
                        {url.length > 0 && (
                          <button
                            type="button"
                            className={styles.removeFieldButton}
                            onClick={() => setUrl('')}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <input
                        type="url"
                        className={styles.urlInput}
                        placeholder="https://example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </div>

                    {/* Attachments */}
                    <div className={styles.addSection}>
                      <AttachmentSection
                        attachments={attachments}
                        onAttachmentsChange={setAttachments}
                        eventId={editingId || 'new'}
                        showLabel={false}
                      />
                    </div>

                    {/* Related To */}
                    {(() => {
                      const sameDayEvents = events.filter(
                        (e) =>
                          e.type !== 'journal' && e.id !== editingId && e.start.startsWith(date)
                      )
                      if (sameDayEvents.length === 0) return null
                      return (
                        <div className={styles.addSection}>
                          <div className={styles.addSectionHeader}>
                            <span className={styles.addSectionLabel}>Related to</span>
                            {relatedTo.length > 0 && (
                              <button
                                type="button"
                                className={styles.removeFieldButton}
                                onClick={() => setRelatedTo([])}
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <div className={styles.relatedList}>
                            {sameDayEvents.map((ev) => {
                              const isSelected = relatedTo.includes(ev.id)
                              return (
                                <button
                                  key={ev.id}
                                  type="button"
                                  className={`${styles.relatedChip} ${isSelected ? styles.relatedChipActive : ''}`}
                                  onClick={() => {
                                    if (isSelected) {
                                      setRelatedTo(relatedTo.filter((id) => id !== ev.id))
                                    } else {
                                      setRelatedTo([...relatedTo, ev.id])
                                    }
                                  }}
                                >
                                  <span className={styles.relatedChipTitle}>
                                    {ev.title || '(untitled)'}
                                  </span>
                                  <span className={styles.relatedChipDate}>
                                    {ev.start.split('T')[1]?.slice(0, 5) || ''}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer — always at bottom */}
        <div className={styles.footer}>
          {mode === 'edit' && editingId && (
            <button
              className={`${styles.btnDelete} ${confirmDeleteId === editingId ? styles.btnDeleteConfirm : ''}`}
              onClick={() => handleDelete(editingId)}
            >
              {confirmDeleteId === editingId ? 'Click again to confirm' : 'Delete'}
            </button>
          )}
          {mode !== 'view' ? (
            <>
              <button
                className={styles.btnGhost}
                onClick={() => {
                  setMode('view')
                  setEditingId(null)
                  setTitle('')
                  setBody('')
                }}
              >
                Cancel
              </button>
              <button className={styles.btnAccent} onClick={handleSave}>
                {mode === 'edit' ? 'Save changes' : 'Save entry'}
              </button>
            </>
          ) : (
            <button className={styles.btnGhost} onClick={onClose}>
              Close
            </button>
          )}
          {mode === 'view' && (
            <button className={styles.addEntry} onClick={handleStartCompose}>
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M6 1v10M1 6h10" />
              </svg>
              Add entry
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
