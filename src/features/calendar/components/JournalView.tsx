import type { JSX } from 'react'
import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { format, parseISO } from 'date-fns'
// useNavigate removed — unused
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { v4 as uuidv4 } from 'uuid'
import { MarkdownView } from '@/lib/markdown'
import { showToast } from '@/lib/toast'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import { buildEventIndex } from '@/lib/events'
import { putAttachments, getAttachments, deleteAttachments } from '@/lib/attachmentStore'
import type { CalendarEvent, CalendarAttachment } from '@/types'
import { AttachmentSection } from './AttachmentSection'
import styles from './JournalView.module.css'

// ── Shared compose form ──────────────────────────────────────────────────────

interface JournalComposeFormProps {
  editingId: string | null
  editingDate: string
  title: string
  body: string
  selectedCategories: string[]
  attachments: CalendarAttachment[]
  url: string
  relatedTo: string[]
  titleRef: React.RefObject<HTMLInputElement | null>
  bodyRef: React.RefObject<HTMLTextAreaElement | null>
  saveHint: string
  closing?: boolean
  formatEntryDate: (dateStr: string) => { day: string; weekday: string }
  onTitleChange: (value: string) => void
  onBodyChange: (value: string) => void
  onDateChange: (value: string) => void
  onCategoriesChange: (categories: string[]) => void
  onAttachmentsChange: (attachments: CalendarAttachment[]) => void
  onUrlChange: (url: string) => void
  onRelatedToChange: (ids: string[]) => void
  onSave: () => void
  onCancel: () => void
}

function JournalComposeForm({
  editingId,
  editingDate,
  title,
  body,
  selectedCategories,
  attachments,
  url,
  relatedTo,
  titleRef,
  bodyRef,
  // saveHint available but not rendered in compose form currently
  closing,
  formatEntryDate,
  onTitleChange,
  onBodyChange,
  onDateChange,
  onCategoriesChange,
  onAttachmentsChange,
  onUrlChange,
  onRelatedToChange,
  onSave,
  onCancel,
}: JournalComposeFormProps): JSX.Element {
  const categories = useCalendarStore((state) => state.categories)
  const events = useCalendarStore((state) => state.events)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const { day, weekday } = formatEntryDate(editingDate)

  // Determine which add sections have content
  const hasCategories = selectedCategories.length > 0
  const hasUrl = url.length > 0
  const hasRelated = relatedTo.length > 0
  // const hasAnyContent = hasCategories || hasUrl || hasAttachments || hasRelated

  // Non-journal events on the same day for linking
  const sameDayEvents = useMemo(() => {
    const dayKey = editingDate // yyyy-MM-dd
    return events.filter(
      (e) => e.type !== 'journal' && e.id !== editingId && e.start.startsWith(dayKey)
    )
  }, [events, editingId, editingDate])

  const otherDayEvents = useMemo(() => {
    const dayKey = editingDate
    return events.filter(
      (e) => e.type !== 'journal' && e.id !== editingId && !e.start.startsWith(dayKey)
    )
  }, [events, editingId, editingDate])

  const [showAllRelated, setShowAllRelated] = useState(false)
  const linkableEvents = showAllRelated ? [...sameDayEvents, ...otherDayEvents] : sameDayEvents

  return (
    <div className={`${styles.compose} ${closing ? styles.closing : ''}`}>
      <div className={styles.composeDateCol}>
        {showDatePicker ? (
          <input
            type="date"
            className={styles.dateInput}
            value={editingDate}
            onChange={(e) => {
              onDateChange(e.target.value)
              setShowDatePicker(false)
            }}
            onBlur={() => setShowDatePicker(false)}
            autoFocus
          />
        ) : (
          <button
            className={styles.dateButton}
            onClick={() => setShowDatePicker(true)}
            title="Click to change date"
          >
            <span className={styles.composeDay}>{day}</span>
            <span className={styles.composeWeekday}>{weekday}</span>
          </button>
        )}
      </div>
      <div className={styles.composeFields}>
        <input
          ref={titleRef}
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <textarea
          ref={bodyRef}
          placeholder="Write something…"
          rows={8}
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
        />
        {/* Add panel — categories, link, attachments */}
        {
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
                      {hasCategories && (
                        <button
                          type="button"
                          className={styles.removeFieldButton}
                          onClick={() => onCategoriesChange([])}
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
                            style={
                              {
                                '--chip-color': cat.color,
                              } as React.CSSProperties
                            }
                            onClick={() => {
                              if (isSelected) {
                                onCategoriesChange(selectedCategories.filter((c) => c !== cat.name))
                              } else {
                                onCategoriesChange([...selectedCategories, cat.name])
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
                    {hasUrl && (
                      <button
                        type="button"
                        className={styles.removeFieldButton}
                        onClick={() => onUrlChange('')}
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
                    onChange={(e) => onUrlChange(e.target.value)}
                  />
                </div>

                {/* Attachments */}
                <div className={styles.addSection}>
                  <AttachmentSection
                    attachments={attachments}
                    onAttachmentsChange={onAttachmentsChange}
                    eventId={editingId || 'new'}
                    showLabel={false}
                  />
                </div>

                {/* Related To */}
                <div className={styles.addSection}>
                  <div className={styles.addSectionHeader}>
                    <span className={styles.addSectionLabel}>Related to</span>
                    {hasRelated && (
                      <button
                        type="button"
                        className={styles.removeFieldButton}
                        onClick={() => onRelatedToChange([])}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {linkableEvents.length > 0 || (showAllRelated && otherDayEvents.length > 0) ? (
                    <>
                      <div className={styles.relatedList}>
                        {linkableEvents.map((event) => {
                          const isSelected = relatedTo.includes(event.id)
                          return (
                            <button
                              key={event.id}
                              type="button"
                              className={`${styles.relatedChip} ${isSelected ? styles.relatedChipActive : ''}`}
                              onClick={() => {
                                if (isSelected) {
                                  onRelatedToChange(relatedTo.filter((id) => id !== event.id))
                                } else {
                                  onRelatedToChange([...relatedTo, event.id])
                                }
                              }}
                            >
                              <span className={styles.relatedChipTitle}>
                                {event.title || '(untitled)'}
                              </span>
                              <span className={styles.relatedChipDate}>
                                {event.start.split('T')[1]?.slice(0, 5) || ''}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      {otherDayEvents.length > 0 && (
                        <button
                          type="button"
                          className={styles.relatedToggle}
                          onClick={() => setShowAllRelated(!showAllRelated)}
                        >
                          {showAllRelated
                            ? '↑ Hide other days'
                            : `+ ${otherDayEvents.length} other event${otherDayEvents.length === 1 ? '' : 's'}`}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className={styles.relatedEmpty}>No events on this day to link</div>
                  )}
                </div>
              </div>
            )}
          </div>
        }
        <div className={styles.composeActions}>
          <button className={styles.btnGhost} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.btnAccent} onClick={onSave}>
            {editingId ? 'Save changes' : 'Save entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function JournalView(): JSX.Element {
  // const navigate = useNavigate()
  const events = useCalendarStore((state) => state.events)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const calendars = useCalendarStore((state) => state.calendars)
  const {
    createEvent: createCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    deleteEvent: deleteCalDAVEvent,
  } = useCalDAV()

  const [isComposing, setIsComposing] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [editingDate, setEditingDate] = useState(new Date().toISOString().split('T')[0])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [attachments, setAttachments] = useState<CalendarAttachment[]>([])
  const [url, setUrl] = useState('')
  const [relatedTo, setRelatedTo] = useState<string[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'month' | 'all'>('month')
  const segmentedRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })

  // Use store's currentDate for month filtering
  const currentDate = useCalendarStore((state) => state.currentDate)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const bodyInputRef = useRef<HTMLTextAreaElement>(null)

  // Refs for stable values used in callbacks (#9)
  const eventsRef = useRef(events)
  const calendarsRef = useRef(calendars)
  // Keep refs in sync with state
  useEffect(() => {
    eventsRef.current = events
  })
  useEffect(() => {
    calendarsRef.current = calendars
  })

  // Group journal entries by month
  const groupedEntries = useMemo(() => {
    const journalEntries = events.filter((e) => e.type === 'journal')

    let filtered: typeof journalEntries
    if (viewMode === 'month') {
      const monthKey = currentDate.slice(0, 7) // yyyy-MM
      filtered = journalEntries.filter((e) => e.start.startsWith(monthKey))
    } else {
      filtered = [...journalEntries].sort((a, b) => b.start.localeCompare(a.start))
    }

    // Group by month
    const groups = new Map<string, typeof journalEntries>()
    for (const entry of filtered) {
      const monthKey = entry.start.slice(0, 7)
      const existing = groups.get(monthKey) || []
      existing.push(entry)
      groups.set(monthKey, existing)
    }

    return [...groups.entries()]
      .sort(([a], [b]) => b.localeCompare(a)) // newest month first
      .map(([monthKey, entries]) => ({
        monthKey,
        entries: entries.sort((a, b) => b.start.localeCompare(a.start)),
      }))
  }, [events, currentDate, viewMode])

  // Flat sorted list for virtualized 'all' mode
  const allEntries = useMemo(() => {
    if (viewMode !== 'all') return []
    return events.filter((e) => e.type === 'journal').sort((a, b) => b.start.localeCompare(a.start))
  }, [events, viewMode])

  // Virtualizer for 'all' mode
  const virtualizer = useVirtualizer({
    count: allEntries.length,
    getScrollElement: () => pageRef.current,
    estimateSize: () => 120,
    overscan: 5,
  })

  const totalCount = useMemo(() => events.filter((e) => e.type === 'journal').length, [events])

  // Index events by id so related-event lookups in the entry list are O(1).
  const eventIndex = useMemo(() => buildEventIndex(events), [events])

  // Focus input when composing
  useEffect(() => {
    if (isComposing) {
      setTimeout(() => titleInputRef.current?.focus(), 80)
    }
  }, [isComposing])

  // Reset confirmDeleteId when switching entries or entering/exiting compose
  useEffect(() => {
    setConfirmDeleteId(null)
  }, [editingId, isComposing])

  // Sliding indicator for view mode tabs
  useLayoutEffect(() => {
    const container = segmentedRef.current
    const activeTab = tabRefs.current.get(viewMode)
    if (container && activeTab) {
      const containerRect = container.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      setIndicatorStyle({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      })
    }
  }, [viewMode])

  const handleSaveEntry = (): void => {
    const trimmedBody = body.trim()
    if (!trimmedBody) {
      bodyInputRef.current?.focus()
      return
    }

    const trimmedTitle = title.trim()
    const now = new Date().toISOString()
    const currentEvents = eventsRef.current
    const currentCalendars = calendarsRef.current

    if (editingId) {
      // Update existing entry
      const existing = currentEvents.find((e) => e.id === editingId)
      if (existing) {
        const updates: Partial<CalendarEvent> = {
          title: trimmedTitle,
          description: trimmedBody,
          start: editingDate,
          end: editingDate,
          lastModified: now,
          categories: selectedCategories.length > 0 ? selectedCategories : undefined,
          url: url || undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
          relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
        }
        updateEvent(editingId, updates)
        // Sync attachments to IDB, then push to server
        if (attachments.length > 0) {
          putAttachments(editingId, attachments)
            .then(() => {
              if (existing.calendarId !== 'default') {
                updateCalDAVEvent(existing.calendarId, { ...existing, ...updates }).catch(() => {
                  showToast('Failed to sync update. It will be retried.')
                })
              }
            })
            .catch(() => {
              showToast('Failed to save attachments locally')
            })
        } else {
          deleteAttachments(editingId).catch(() => {})
          if (existing.calendarId !== 'default') {
            updateCalDAVEvent(existing.calendarId, { ...existing, ...updates }).catch(() => {
              showToast('Failed to sync update. It will be retried.')
            })
          }
        }
      }
    } else {
      // Create new entry
      const defaultCalendar = currentCalendars.find((c) => c.isDefault) || currentCalendars[0]
      const newId = uuidv4()
      const newEntry: CalendarEvent = {
        id: newId,
        calendarId: defaultCalendar?.id || 'default',
        title: trimmedTitle,
        description: trimmedBody,
        start: editingDate,
        end: editingDate,
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
        // Await IDB write before pushing to server (C2 race condition fix)
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

    setIsClosing(true)
    setTimeout(() => {
      setIsComposing(false)
      setIsClosing(false)
      setEditingId(null)
      setTitle('')
      setBody('')
      setSelectedCategories([])
      setAttachments([])
      setUrl('')
      setRelatedTo([])
    }, 200)
  }

  // Keyboard shortcuts — use ref for handleSaveEntry to avoid stale closure (#10)
  const handleSaveEntryRef = useRef(handleSaveEntry)
  useEffect(() => {
    handleSaveEntryRef.current = handleSaveEntry
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isComposing) {
        setIsClosing(true)
        setTimeout(() => {
          setIsComposing(false)
          setIsClosing(false)
          setTitle('')
          setBody('')
        }, 200)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isComposing) {
        e.preventDefault()
        handleSaveEntryRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isComposing])

  const handleStartEdit = useCallback((entry: CalendarEvent): void => {
    setEditingId(entry.id)
    setTitle(entry.title || '')
    setBody(entry.description || '')
    setEditingDate(entry.start)
    setSelectedCategories(entry.categories || [])
    setUrl(entry.url || '')
    setRelatedTo(entry.relatedTo || [])
    setIsComposing(true)
    // Open add panel if entry has any extra content
    // setShowAddPanel(hasExtra) — JournalComposeForm manages its own state
    // Load attachments from IndexedDB
    getAttachments(entry.id)
      .then((loaded) => {
        setAttachments(loaded.length > 0 ? loaded : entry.attachments || [])
      })
      .catch(() => {
        setAttachments(entry.attachments || [])
      })
  }, [])

  const handleStartCompose = useCallback((): void => {
    // If already composing, close with animation
    if (isComposing) {
      setIsClosing(true)
      setTimeout(() => {
        setIsComposing(false)
        setIsClosing(false)
        setEditingId(null)
        setTitle('')
        setBody('')
      }, 200)
      return
    }
    setEditingId(null)
    setTitle('')
    setBody('')
    setEditingDate(new Date().toISOString().split('T')[0])
    setSelectedCategories([])
    setAttachments([])
    setUrl('')
    setRelatedTo([])
    setIsComposing(true)
  }, [isComposing])

  const handleDelete = useCallback(
    (entryId: string): void => {
      if (confirmDeleteId === entryId) {
        const entry = eventsRef.current.find((e) => e.id === entryId)
        if (entry) {
          deleteEventWithUndo({
            event: entry,
            deleteEvent,
            addEvent,
            createCalDAVEvent,
            deleteCalDAVEvent,
          })
        }
        setConfirmDeleteId(null)
      } else {
        // First click — show confirm
        setConfirmDeleteId(entryId)
      }
    },
    [confirmDeleteId, deleteEvent, deleteCalDAVEvent, addEvent, createCalDAVEvent]
  )

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

  // Format date for display in entry
  const formatEntryDate = useCallback((dateStr: string): { day: string; weekday: string } => {
    const d = parseISO(dateStr)
    return {
      day: format(d, 'd'),
      weekday: format(d, 'EEE').toUpperCase(),
    }
  }, [])

  const handleCancel = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      setIsComposing(false)
      setIsClosing(false)
      setEditingId(null)
      setTitle('')
      setBody('')
      setSelectedCategories([])
      setAttachments([])
      setUrl('')
      setRelatedTo([])
    }, 200)
  }, [])

  // Renders a single journal entry card (or inline compose form when editing).
  // `isLast` suppresses the bottom divider — computed explicitly rather than
  // via CSS :last-child since 'all' mode wraps each entry in its own
  // virtualized container, which would make :last-child match every entry.
  const renderEntryCard = (entry: CalendarEvent, isLast = false): JSX.Element => {
    const { day, weekday } = formatEntryDate(entry.start)

    if (editingId === entry.id) {
      return (
        <JournalComposeForm
          editingId={editingId}
          editingDate={editingDate}
          title={title}
          body={body}
          selectedCategories={selectedCategories}
          attachments={attachments}
          url={url}
          relatedTo={relatedTo}
          titleRef={titleInputRef}
          bodyRef={bodyInputRef}
          saveHint={`${isMac ? '⌘' : 'Ctrl+'} Return to save · Esc to cancel`}
          formatEntryDate={formatEntryDate}
          onTitleChange={setTitle}
          onBodyChange={setBody}
          onDateChange={setEditingDate}
          onCategoriesChange={setSelectedCategories}
          onAttachmentsChange={setAttachments}
          onUrlChange={setUrl}
          onRelatedToChange={setRelatedTo}
          onSave={handleSaveEntry}
          onCancel={handleCancel}
        />
      )
    }

    return (
      <article
        key={entry.id}
        className={`${styles.entry} ${isLast ? styles.entryNoBorder : ''}`}
        data-date={entry.start}
        onDoubleClick={() => handleStartEdit(entry)}
      >
        <div className={styles.dateCol}>
          <span className={styles.dayNum}>{day}</span>
          <span className={styles.weekday}>{weekday}</span>
        </div>
        <div className={styles.content}>
          {entry.title && <div className={styles.summary}>{entry.title}</div>}
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
          {entry.relatedTo && entry.relatedTo.length > 0 && (
            <div className={styles.entryRelated}>
              {entry.relatedTo.map((relId) => {
                const relatedEvent = eventIndex.get(relId)
                if (!relatedEvent) return null
                return (
                  <span key={relId} className={styles.entryRelatedTag}>
                    ↗ {relatedEvent.title || '(untitled)'}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        <button
          className={`${styles.deleteBtn} ${confirmDeleteId === entry.id ? styles.deleteBtnConfirm : ''}`}
          title={confirmDeleteId === entry.id ? 'Click to confirm delete' : 'Delete entry'}
          onClick={(e) => {
            e.stopPropagation()
            handleDelete(entry.id)
          }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 4h12" />
            <path d="M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4" />
            <path d="M12.667 4v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4" />
          </svg>
        </button>
      </article>
    )
  }

  return (
    <div className={styles.page} ref={pageRef}>
      <div className={styles.inner}>
        {/* Top bar */}
        <div className={styles.bar}>
          <div className={styles.count}>
            <b>{totalCount}</b> {totalCount === 1 ? 'entry' : 'entries'}
          </div>
          <div className={styles.barControls}>
            <div className={styles.segmentedControl} ref={segmentedRef}>
              <div
                className={styles.tabIndicator}
                style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
              />
              <button
                ref={(el) => {
                  if (el) tabRefs.current.set('month', el)
                }}
                className={`${styles.segmentTab} ${viewMode === 'month' ? styles.segmentTabActive : ''}`}
                onClick={() => setViewMode('month')}
              >
                Month
              </button>
              <button
                ref={(el) => {
                  if (el) tabRefs.current.set('all', el)
                }}
                className={`${styles.segmentTab} ${viewMode === 'all' ? styles.segmentTabActive : ''}`}
                onClick={() => setViewMode('all')}
              >
                All
              </button>
            </div>
            <button className={styles.addEntry} onClick={handleStartCompose}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M7 1v12M1 7h12" />
              </svg>
              New<span className={styles.addEntryFull}> entry</span>
            </button>
          </div>
        </div>

        {/* Compose form (at top when composing new entry only) */}
        {isComposing && !editingId && (
          <JournalComposeForm
            editingId={editingId}
            editingDate={editingDate}
            title={title}
            body={body}
            selectedCategories={selectedCategories}
            attachments={attachments}
            url={url}
            relatedTo={relatedTo}
            titleRef={titleInputRef}
            bodyRef={bodyInputRef}
            saveHint={`${isMac ? '⌘' : 'Ctrl+'} Return to save · Esc to cancel`}
            closing={isClosing}
            formatEntryDate={formatEntryDate}
            onTitleChange={setTitle}
            onBodyChange={setBody}
            onDateChange={setEditingDate}
            onCategoriesChange={setSelectedCategories}
            onAttachmentsChange={setAttachments}
            onUrlChange={setUrl}
            onRelatedToChange={setRelatedTo}
            onSave={handleSaveEntry}
            onCancel={handleCancel}
          />
        )}

        {/* Entry list */}
        {groupedEntries.length === 0 && !isComposing ? (
          <div className={styles.empty}>
            <strong>Nothing written yet</strong>
            Start capturing your days — one entry at a time.
          </div>
        ) : viewMode === 'month' ? (
          /* Month mode — bounded, no virtualization needed */
          groupedEntries.map(({ monthKey, entries }) => (
            <section key={monthKey} className={styles.monthGroup}>
              {entries.map((entry, index) => (
                <React.Fragment key={entry.id}>
                  {renderEntryCard(entry, index === entries.length - 1)}
                </React.Fragment>
              ))}
            </section>
          ))
        ) : (
          /* All mode — virtualized flat list */
          <div style={{ position: 'relative', height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = allEntries[virtualRow.index]
              return (
                <div
                  key={entry.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {renderEntryCard(entry, virtualRow.index === allEntries.length - 1)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
