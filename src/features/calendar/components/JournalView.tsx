import type { JSX } from 'react'
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { parseISO } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { useCalendarStore, isJournalEntryVisible } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { v4 as uuidv4 } from 'uuid'
import { MarkdownView } from '@/lib/markdown'
import { wrapMarkdownSelection } from '@/lib/markdownHelpers'
import { showToast } from '@/lib/toast'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import { formatDisplayDate, formatMonthYear, toLocalDateString } from '@/lib/datetime'
import { putAttachments, getAttachments } from '@/lib/attachmentStore'
import type { Calendar, CalendarAttachment, CalendarEvent } from '@/types'
import { AttachmentSection } from './AttachmentSection'
import { syncJournalEntryToServer } from '../lib/journalSync'
import { useTranslation } from 'react-i18next'
import styles from './JournalView.module.css'

type EditorMode = 'write' | 'read'
type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

interface DateParts {
  day: string
  weekday: string
  monthYear: string
}

function formatEntryDate(dateStr: string): DateParts {
  const date = parseISO(dateStr)
  return {
    day: formatDisplayDate(date, 'd'),
    weekday: formatDisplayDate(date, 'EEE').toUpperCase(),
    monthYear: formatDisplayDate(date, 'MMM yyyy').toUpperCase(),
  }
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/u).length : 0
}

interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
  className?: string
}

function TagEditor({ tags, onChange, className }: TagEditorProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const [value, setValue] = useState('')
  const commit = (): void => {
    const tag = value.trim().toLowerCase()
    if (tag) onChange([...new Set([...tags, tag])])
    setValue('')
  }

  return (
    <div className={`${styles.tags} ${className || ''}`} data-component="journal-tags">
      {tags.map((tag) => (
        <span className={styles.tag} key={tag}>
          {tag}
          <button
            type="button"
            aria-label={t('surface.journalRemoveTag', { tag })}
            onClick={() => onChange(tags.filter((item) => item !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className={styles.tagInput}
        aria-label={t('surface.journalAddTag')}
        placeholder={t('surface.journalTagPlaceholder')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
      />
    </div>
  )
}

interface JournalEditorProps {
  entry: CalendarEvent
  writableCalendars: Calendar[]
  events: CalendarEvent[]
  mode: EditorMode
  status: SaveStatus
  focusVersion: number
  overlayOpen: boolean
  onChange: (updates: Partial<CalendarEvent>) => void
  onModeChange: (mode: EditorMode) => void
  onNavigate: (direction: -1 | 1) => void
  onDelete: () => void
  onCloseNarrow: () => void
}

function JournalEditor({
  entry,
  writableCalendars,
  events,
  mode,
  status,
  focusVersion,
  overlayOpen,
  onChange,
  onModeChange,
  onNavigate,
  onDelete,
  onCloseNarrow,
}: JournalEditorProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showMore, setShowMore] = useState(
    Boolean(entry.url || entry.attachments?.length || entry.relatedTo?.length)
  )
  const [attachments, setAttachments] = useState<CalendarAttachment[]>(entry.attachments || [])
  const { day, weekday, monthYear } = formatEntryDate(entry.start)

  const relatedEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          event.type !== 'journal' && event.id !== entry.id && event.start.startsWith(entry.start)
      ),
    [events, entry.id, entry.start]
  )

  useEffect(() => {
    let active = true
    setAttachments(entry.attachments || [])
    getAttachments(entry.id)
      .then((loaded) => {
        if (active && loaded.length > 0) setAttachments(loaded)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [entry.id, entry.attachments])

  useEffect(() => {
    setShowMore(Boolean(entry.url || entry.attachments?.length || entry.relatedTo?.length))
  }, [entry.id, entry.url, entry.attachments, entry.relatedTo])

  useEffect(() => {
    if (focusVersion > 0) requestAnimationFrame(() => titleRef.current?.focus())
  }, [focusVersion])

  useEffect(() => {
    if (mode !== 'read') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key !== 'ArrowLeft' &&
        event.key !== 'ArrowRight' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'ArrowDown'
      )
        return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      event.preventDefault()
      onNavigate(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, onNavigate])

  const updateBody = (value: string): void => onChange({ description: value })
  const updateTags = (tags: string[]): void =>
    onChange({ categories: tags.length ? tags : undefined })
  const wrapSelection = (marker: string): void => {
    const textarea = bodyRef.current
    if (!textarea) return
    const result = wrapMarkdownSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      marker
    )
    updateBody(result.value)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }
  const handleBodyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && (event.key === 'b' || event.key === 'i')) {
      event.preventDefault()
      wrapSelection(event.key === 'b' ? '**' : '*')
    }
  }
  const handleAttachmentsChange = (next: CalendarAttachment[]): void => {
    setAttachments(next)
    onChange({ attachments: next.length ? next : undefined })
    putAttachments(entry.id, next).catch(() => showToast('Failed to save attachments locally'))
  }
  const statusLabel =
    status === 'unsaved'
      ? 'Unsaved changes'
      : status === 'saving'
        ? 'Saving…'
        : status === 'error'
          ? 'Sync failed'
          : (entry.calendarId !== 'default' || entry.resourceHref) && status === 'saved'
            ? 'Saved'
            : 'Draft saved locally'

  return (
    <section
      className={`${styles.editorPane} ${overlayOpen ? styles.editorOpen : ''}`}
      data-component="journal-editor"
    >
      <div className={styles.editorTopbar}>
        <button className={styles.backButton} type="button" onClick={onCloseNarrow}>
          ← All entries
        </button>
      </div>

      <div className={styles.editorHeader} data-component="journal-editor-header">
        <div className={styles.editorDateRow}>
          {showDatePicker ? (
            <input
              type="date"
              className={styles.dateInput}
              value={entry.start}
              onChange={(event) => {
                onChange({ start: event.target.value, end: event.target.value })
                setShowDatePicker(false)
              }}
              onBlur={() => setShowDatePicker(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setShowDatePicker(false)
                }
              }}
              autoFocus
            />
          ) : (
            <button
              className={styles.dateButton}
              type="button"
              title={t('surface.journalChangeDate')}
              onClick={() => setShowDatePicker(true)}
            >
              <span className={styles.editorDay}>{day}</span>
              <span className={styles.editorWeekday}>{weekday}</span>
              <span className={styles.editorMonthYear}>{monthYear}</span>
            </button>
          )}
        </div>
        <div className={styles.editorHeading}>
          {mode === 'write' ? (
            <input
              ref={titleRef}
              className={styles.titleInput}
              data-component="journal-title-input"
              placeholder={t('surface.journalTitlePlaceholder')}
              value={entry.title || ''}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          ) : (
            <h1 className={styles.editorTitle}>{entry.title || t('surface.journalUntitled')}</h1>
          )}
          <TagEditor
            tags={entry.categories || []}
            onChange={updateTags}
            className={styles.headerTags}
          />
          {writableCalendars.length > 1 && (
            <div className={styles.calendarRow} role="radiogroup" aria-label={t('surface.journalCalendar')}>
              {writableCalendars.map((calendar) => {
                const selected = calendar.id === entry.calendarId
                return (
                  <button
                    key={calendar.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`${styles.calendarChip} ${selected ? styles.calendarChipActive : ''}`}
                    data-component="journal-calendar-chip"
                    data-calendar-id={calendar.id}
                    style={{ '--chip-color': calendar.color } as React.CSSProperties}
                    onClick={() => onChange({ calendarId: calendar.id })}
                  >
                    <span
                      className={styles.calendarDot}
                      style={{ backgroundColor: selected ? calendar.color : 'transparent' }}
                    />
                    {calendar.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button
          className={styles.editorDelete}
          type="button"
          onClick={onDelete}
          aria-label={t('surface.journalDeleteEntry')}
          title={t('surface.journalDeleteEntry')}
        >
          <Trash2 size={15} strokeWidth={1.8} />
        </button>
      </div>

      <div className={styles.editorScroll}>
        {mode === 'write' ? (
          <textarea
            ref={bodyRef}
            className={styles.bodyInput}
            data-component="journal-body-input"
            placeholder={t('surface.journalWritePlaceholder')}
            value={entry.description || ''}
            onChange={(event) => updateBody(event.target.value)}
            onKeyDown={handleBodyKeyDown}
          />
        ) : (
          <article
            className={styles.readView}
            data-component="journal-read-view"
            onDoubleClick={() => {
              onModeChange('write')
              requestAnimationFrame(() => bodyRef.current?.focus())
            }}
          >
            <MarkdownView text={entry.description || ''} />
          </article>
        )}

        <div className={styles.moreSection}>
          <button
            type="button"
            className={styles.moreToggle}
            onClick={() => setShowMore((value) => !value)}
          >
            {showMore ? '− Less' : '+ More'}
          </button>
          {showMore && (
            <div className={styles.moreContent}>
              <input
                type="url"
                className={styles.urlInput}
                aria-label={t('surface.journalEntryLink')}
                placeholder="https://example.com"
                value={entry.url || ''}
                onChange={(event) => onChange({ url: event.target.value || undefined })}
              />
              <AttachmentSection
                attachments={attachments}
                onAttachmentsChange={handleAttachmentsChange}
                eventId={entry.id}
                showLabel={false}
              />
              {relatedEvents.length > 0 && (
                <div className={styles.relatedList}>
                  {relatedEvents.map((event) => {
                    const selected = entry.relatedTo?.includes(event.id) ?? false
                    return (
                      <button
                        type="button"
                        key={event.id}
                        className={`${styles.relatedChip} ${selected ? styles.relatedChipActive : ''}`}
                        onClick={() => {
                          const related = entry.relatedTo || []
                          onChange({
                            relatedTo: selected
                              ? related.filter((id) => id !== event.id)
                              : [...related, event.id],
                          })
                        }}
                      >
                        {event.title || '(untitled)'}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.editorBottom} data-component="journal-editor-footer">
        <div className={styles.editorBottomInfo}>
          <div className={styles.modeSwitch} role="group" aria-label={t('surface.journalEditorMode')}>
            <button
              type="button"
              className={mode === 'write' ? styles.modeActive : ''}
              onClick={() => onModeChange('write')}
            >
              Write
            </button>
            <button
              type="button"
              className={mode === 'read' ? styles.modeActive : ''}
              onClick={() => onModeChange('read')}
            >
              Read
            </button>
          </div>
          {mode === 'write' && (
            <>
              <span>{wordCount(entry.description || '')} words</span>
              <span>{navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'} + B / I to format</span>
            </>
          )}
          {mode === 'read' && <span>{t('surface.journalMarkdownSupported')}</span>}
        </div>
        <div className={styles.editorBottomActions}>
          <span className={styles.saveStatus} data-component="journal-save-status">
            <span className={`${styles.statusDot} ${styles[`status${status}`]}`} />
            {statusLabel}
          </span>
        </div>
      </div>
    </section>
  )
}

interface JournalEntryRowProps {
  entry: CalendarEvent
  selected: boolean
  removing: boolean
  confirmDelete: boolean
  onSelect: () => void
  onDelete: () => void
}

const JournalEntryRow = memo(function JournalEntryRow({
  entry,
  selected,
  removing,
  confirmDelete,
  onSelect,
  onDelete,
}: JournalEntryRowProps): JSX.Element {
  const date = formatEntryDate(entry.start)
  return (
    <article
      className={`${styles.entryRow} ${selected ? styles.entrySelected : ''} ${removing ? styles.entryRemoving : ''}`}
      data-component="journal-entry-row"
      data-date={entry.start}
      data-entry-id={entry.id}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${entry.title || 'Untitled entry'}, ${date.monthYear}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className={styles.rowDate}>
        <strong>{date.day}</strong>
        <span>{date.weekday}</span>
        <small>{date.monthYear}</small>
      </div>
      <div className={styles.rowContent}>
        <div className={styles.rowTitle}>{entry.title || 'Untitled entry'}</div>
        <div className={styles.rowSnippet}>{entry.description || 'No text yet'}</div>
        {entry.categories && entry.categories.length > 0 && (
          <div className={styles.rowTags}>
            {entry.categories.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className={`${styles.rowDelete} ${confirmDelete ? styles.rowDeleteConfirm : ''}`}
        aria-label={confirmDelete ? 'Confirm delete entry' : 'Delete entry'}
        title={confirmDelete ? 'Click to confirm delete' : 'Delete entry'}
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
      >
        ×
      </button>
    </article>
  )
})

export function JournalView(): JSX.Element {
  const { t } = useTranslation('calendar')
  const events = useCalendarStore((state) => state.events)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const calendars = useCalendarStore((state) => state.calendars)
  const currentDate = useCalendarStore((state) => state.currentDate)
  const {
    createEvent: createCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    deleteEvent: deleteCalDAVEvent,
    deleteEventByHref: deleteCalDAVEventByHref,
  } = useCalDAV()

  const [viewMode, setViewMode] = useState<'month' | 'all'>('month')
  const [editorMode, setEditorMode] = useState<EditorMode>('read')
  const [listOnly, setListOnly] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [focusVersion, setFocusVersion] = useState(0)
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({})
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [listFade, setListFade] = useState({ top: false, bottom: false })
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  const segmentedRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const eventsRef = useRef(events)
  const calendarsRef = useRef(calendars)
  const syncBaseRef = useRef<Map<string, CalendarEvent>>(new Map())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const removalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const removingIdsRef = useRef<Set<string>>(new Set())
  const draftIdsRef = useRef<Set<string>>(new Set())
  const flushPendingRef = useRef<() => void>(() => {})

  useEffect(() => {
    eventsRef.current = events
  }, [events])
  useEffect(() => {
    calendarsRef.current = calendars
  }, [calendars])

  const visibleCalendarIds = useMemo(
    () =>
      new Set(calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id)),
    [calendars]
  )
  const visibleEntries = useMemo(
    () => events.filter((event) => isJournalEntryVisible(event, visibleCalendarIds)),
    [events, visibleCalendarIds]
  )
  const entries = useMemo(() => {
    const filtered =
      viewMode === 'month'
        ? visibleEntries.filter((entry) => entry.start.startsWith(currentDate.slice(0, 7)))
        : visibleEntries
    return [...filtered].sort((a, b) => b.start.localeCompare(a.start) || b.id.localeCompare(a.id))
  }, [currentDate, viewMode, visibleEntries])
  const updateListFade = useCallback((): void => {
    const element = listScrollRef.current
    if (!element) return
    const top = element.scrollTop > 1
    const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 1
    setListFade((current) =>
      current.top === top && current.bottom === bottom ? current : { top, bottom }
    )
  }, [])
  const activeId = selectedId
  const selectedEntry = entries.find((entry) => entry.id === activeId) || null
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => !calendar.readOnly),
    [calendars]
  )
  const defaultCalendarId = useMemo(
    () =>
      (writableCalendars.find((calendar) => calendar.isDefault) || writableCalendars[0])?.id ||
      'default',
    [writableCalendars]
  )

  const setStatus = useCallback(
    (id: string, status: SaveStatus) =>
      setSaveStatuses((current) => ({ ...current, [id]: status })),
    []
  )
  const syncEntry = useCallback(
    (id: string): void => {
      timersRef.current.delete(id)
      const entry = eventsRef.current.find((event) => event.id === id)
      if (!entry) return
      const existing = syncBaseRef.current.get(id)
      const isEmptyNewDraft =
        draftIdsRef.current.has(id) &&
        !existing &&
        !entry.title.trim() &&
        !entry.url &&
        !entry.attachments?.length &&
        !entry.categories?.length &&
        !entry.relatedTo?.length &&
        !entry.description?.trim()
      if (isEmptyNewDraft) {
        setStatus(id, 'saved')
        return
      }
      const targetCalendar = calendarsRef.current.find(
        (calendar) => calendar.id === entry.calendarId
      )
      if (!targetCalendar || (entry.calendarId === 'default' && !existing?.resourceHref)) {
        syncBaseRef.current.set(id, { ...entry })
        setStatus(id, 'saved')
        return
      }
      setStatus(id, 'saving')
      if (!existing) {
        createCalDAVEvent(entry.calendarId, entry)
          .then(() => {
            syncBaseRef.current.set(id, {
              ...(eventsRef.current.find((item) => item.id === id) || entry),
            })
            setStatus(id, 'saved')
          })
          .catch(() => setStatus(id, 'error'))
        return
      }
      syncJournalEntryToServer({
        existing,
        targetCalendarId: entry.calendarId,
        syncedEntry: entry,
        updateCalDAVEvent,
        createCalDAVEvent,
        deleteCalDAVEventByHref,
        showToast: (message) => {
          showToast(message)
        },
      }).then((synced) => {
        if (!synced) {
          setStatus(id, 'error')
          return
        }
        syncBaseRef.current.set(id, { ...entry })
        setStatus(id, 'saved')
      })
    },
    [createCalDAVEvent, deleteCalDAVEventByHref, setStatus, updateCalDAVEvent]
  )
  const scheduleSync = useCallback(
    (id: string): void => {
      const timer = timersRef.current.get(id)
      if (timer) clearTimeout(timer)
      setStatus(id, 'unsaved')
      timersRef.current.set(
        id,
        setTimeout(() => syncEntry(id), 500)
      )
    },
    [setStatus, syncEntry]
  )
  const flushEntry = useCallback(
    (id: string): void => {
      const timer = timersRef.current.get(id)
      if (timer) {
        clearTimeout(timer)
        syncEntry(id)
      }
    },
    [syncEntry]
  )
  useEffect(() => {
    flushPendingRef.current = () => {
      for (const id of timersRef.current.keys()) flushEntry(id)
    }
    return () => flushPendingRef.current()
  }, [flushEntry])
  useEffect(
    () => () => {
      for (const timer of removalTimersRef.current.values()) clearTimeout(timer)
    },
    []
  )

  useEffect(() => {
    if (selectedId && !selectedEntry) {
      setSelectedId(entries[0]?.id || null)
      setOverlayOpen(false)
    }
  }, [entries, selectedEntry, selectedId])
  useEffect(() => {
    setConfirmDeleteId(null)
  }, [selectedId])
  useLayoutEffect(() => {
    const element = listScrollRef.current
    updateListFade()
    window.addEventListener('resize', updateListFade)
    if (!element || typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', updateListFade)
    }
    const observer = new ResizeObserver(updateListFade)
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateListFade)
    }
  }, [entries.length, listOnly, updateListFade, viewMode])
  useLayoutEffect(() => {
    const container = segmentedRef.current
    const tab = tabRefs.current.get(viewMode)
    if (container && tab) {
      const containerRect = container.getBoundingClientRect()
      const tabRect = tab.getBoundingClientRect()
      setIndicatorStyle({ left: tabRect.left - containerRect.left, width: tabRect.width })
    }
  }, [viewMode])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && overlayOpen) {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
          return
        event.preventDefault()
        flushPendingRef.current()
        setOverlayOpen(false)
        setListOnly(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlayOpen])

  const handleSelect = useCallback(
    (id: string): void => {
      if (selectedId === id) {
        flushEntry(id)
        const open = listOnly
        setListOnly(!open)
        setOverlayOpen(open)
        if (open) setEditorMode('read')
        return
      }
      if (selectedId && selectedId !== id) flushEntry(selectedId)
      if (!draftIdsRef.current.has(id) && !syncBaseRef.current.has(id)) {
        const entry = eventsRef.current.find((event) => event.id === id)
        if (entry) syncBaseRef.current.set(id, { ...entry })
      }
      setSelectedId(id)
      setOverlayOpen(true)
      setEditorMode('read')
      setListOnly(false)
    },
    [flushEntry, listOnly, selectedId]
  )
  const handleCreate = useCallback((): void => {
    flushPendingRef.current()
    const today = toLocalDateString(new Date())
    const date =
      viewMode === 'month' && !today.startsWith(currentDate.slice(0, 7))
        ? `${currentDate.slice(0, 7)}-01`
        : today
    const now = new Date().toISOString()
    const id = uuidv4()
    addEvent({
      id,
      calendarId: defaultCalendarId,
      title: '',
      description: '',
      start: date,
      end: date,
      isAllDay: true,
      type: 'journal',
      created: now,
      lastModified: now,
    })
    draftIdsRef.current.add(id)
    syncBaseRef.current.delete(id)
    setSaveStatuses((current) => ({ ...current, [id]: 'unsaved' }))
    setSelectedId(id)
    setOverlayOpen(true)
    setEditorMode('write')
    setListOnly(false)
    setFocusVersion((version) => version + 1)
  }, [addEvent, currentDate, defaultCalendarId, viewMode])
  const handleChange = useCallback(
    (updates: Partial<CalendarEvent>): void => {
      const activeId = selectedId || entries[0]?.id
      if (!activeId) return
      if (!draftIdsRef.current.has(activeId) && !syncBaseRef.current.has(activeId)) {
        const entry = eventsRef.current.find((event) => event.id === activeId)
        if (entry) syncBaseRef.current.set(activeId, { ...entry })
      }
      const safeUpdates: Partial<CalendarEvent> = {
        ...updates,
        lastModified: new Date().toISOString(),
      }
      if (safeUpdates.categories)
        safeUpdates.categories = [
          ...new Set(safeUpdates.categories.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
        ]
      updateEvent(activeId, safeUpdates)
      scheduleSync(activeId)
    },
    [entries, scheduleSync, selectedId, updateEvent]
  )
  const handleDeleteSelected = useCallback(
    (entryId: string): void => {
      if (removingIdsRef.current.has(entryId)) return
      removingIdsRef.current.add(entryId)
      setRemovingIds(new Set(removingIdsRef.current))
      const index = entries.findIndex((entry) => entry.id === entryId)
      const next = entries[index + 1] || entries[index - 1]
      setOverlayOpen(false)
      const timer = setTimeout(() => {
        removalTimersRef.current.delete(entryId)
        removingIdsRef.current.delete(entryId)
        setRemovingIds(new Set(removingIdsRef.current))
        flushEntry(entryId)
        const entry = eventsRef.current.find((event) => event.id === entryId)
        if (entry)
          deleteEventWithUndo({
            event: entry,
            deleteEvent,
            addEvent,
            createCalDAVEvent,
            deleteCalDAVEvent,
          })
        const pendingTimer = timersRef.current.get(entryId)
        if (pendingTimer) clearTimeout(pendingTimer)
        timersRef.current.delete(entryId)
        syncBaseRef.current.delete(entryId)
        draftIdsRef.current.delete(entryId)
        setSelectedId(next?.id || null)
      }, 220)
      removalTimersRef.current.set(entryId, timer)
    },
    [addEvent, createCalDAVEvent, deleteCalDAVEvent, deleteEvent, entries, flushEntry]
  )
  const handleListDelete = useCallback(
    (entryId: string): void => {
      if (confirmDeleteId !== entryId) {
        setConfirmDeleteId(entryId)
        return
      }
      handleDeleteSelected(entryId)
      setConfirmDeleteId(null)
    },
    [confirmDeleteId, handleDeleteSelected]
  )
  const handleNavigate = useCallback(
    (direction: -1 | 1): void => {
      const index = entries.findIndex((entry) => entry.id === activeId)
      const next = entries[index + direction]
      if (next) handleSelect(next.id)
    },
    [activeId, entries, handleSelect]
  )
  const editorEntry = selectedEntry && (!listOnly || overlayOpen) ? selectedEntry : null
  const editorVisible = Boolean(editorEntry)

  return (
    <div
      className={`${styles.page} ${editorVisible ? styles.pageEditorOpen : ''}`}
      data-component="journal-view"
    >
      <div className={styles.inner}>
        <div className={styles.bar} data-component="journal-toolbar">
          <div className={styles.count}>
            <b>{visibleEntries.length}</b> {visibleEntries.length === 1 ? 'entry' : 'entries'}
          </div>
          <div className={styles.barControls}>
            <div className={styles.segmentedControl} ref={segmentedRef}>
              <div className={styles.tabIndicator} style={indicatorStyle} />
              {(['month', 'all'] as const).map((mode) => (
                <button
                  key={mode}
                  ref={(element) => {
                    if (element) tabRefs.current.set(mode, element)
                  }}
                  className={`${styles.segmentTab} ${viewMode === mode ? styles.segmentTabActive : ''}`}
                  data-component={`journal-mode-${mode}`}
                  type="button"
                  onClick={() => setViewMode(mode)}
                >
                  {mode === 'month' ? 'Month' : 'All'}
                </button>
              ))}
            </div>
            <button
              className={styles.addEntry}
              data-component="journal-new-entry"
              type="button"
              onClick={handleCreate}
            >
              <span aria-hidden="true">+</span> New
              <span className={styles.addEntryFull}> entry</span>
            </button>
          </div>
        </div>
        <div className={`${styles.layout} ${listOnly ? styles.layoutListOnly : ''}`}>
          <aside className={styles.listPane} data-component="journal-entry-list">
            <div className={styles.listHeader} data-component="journal-list-header">
              <span>
                {viewMode === 'month'
                  ? formatMonthYear(`${currentDate.slice(0, 7)}-01`)
                  : t('surface.journalAllEntries')}
              </span>
            </div>
            <div
              ref={listScrollRef}
              className={`${styles.listScroll} ${listFade.top ? styles.listScrollFadeTop : ''} ${listFade.bottom ? styles.listScrollFadeBottom : ''}`}
              data-component="journal-list-scroll"
              data-fade-top={listFade.top ? 'true' : 'false'}
              data-fade-bottom={listFade.bottom ? 'true' : 'false'}
              onScroll={updateListFade}
            >
              {entries.length === 0 ? (
                <div className={styles.empty}>
                  <h2>{t('surface.journalEmptyTitle')}</h2>{t('surface.journalEmptyDescription')}
                </div>
              ) : (
                entries.map((entry) => (
                  <JournalEntryRow
                    key={entry.id}
                    entry={entry}
                    selected={entry.id === activeId}
                    removing={removingIds.has(entry.id)}
                    confirmDelete={confirmDeleteId === entry.id}
                    onSelect={() => handleSelect(entry.id)}
                    onDelete={() => handleListDelete(entry.id)}
                  />
                ))
              )}
            </div>
          </aside>
          {editorEntry ? (
            <JournalEditor
              key={editorEntry.id}
              entry={editorEntry}
              writableCalendars={writableCalendars}
              events={events}
              mode={editorMode}
              status={saveStatuses[editorEntry.id] || 'saved'}
              focusVersion={focusVersion}
              overlayOpen={overlayOpen}
              onChange={handleChange}
              onModeChange={setEditorMode}
              onNavigate={handleNavigate}
              onDelete={() => handleDeleteSelected(editorEntry.id)}
              onCloseNarrow={() => {
                flushPendingRef.current()
                setOverlayOpen(false)
                setListOnly(true)
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
