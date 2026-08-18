import type { JSX } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore, EVENT_COLORS } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import { showToast } from '@/lib/toast'
import type { CalendarEvent } from '@/types'
import shell from './AddCalendarModal.module.css'
import styles from './IcsImportModal.module.css'

export const NEW_CALENDAR_OPTION = '__new__'

/** How many parsed items we list before collapsing into a "+N more" line. */
const PREVIEW_LIMIT = 8

interface IcsImportModalProps {
  isOpen: boolean
  /** Raw .ics text. `null` while nothing is pending. */
  icsText: string | null
  /** Source filename, used to seed the new-calendar name. */
  fileName?: string
  onClose: () => void
  onImported?: (count: number, calendarName: string) => void
}

function describeWhen(event: CalendarEvent, timeFormat: string): string {
  const iso = event.type === 'task' ? (event.dueDate ?? event.start) : event.start
  if (!iso) return ''
  try {
    const date = parseISO(iso)
    if (Number.isNaN(date.getTime())) return ''
    if (event.isAllDay) return format(date, 'd MMM yyyy')
    return format(date, timeFormat === '12h' ? 'd MMM yyyy, h:mm a' : 'd MMM yyyy, HH:mm')
  } catch {
    return ''
  }
}

const KIND_LABELS: Record<string, string> = {
  task: 'Task',
  journal: 'Journal',
}

/**
 * Review-and-confirm step for an .ics file, shared by the Settings importer and
 * the drag-and-drop drop zone. Parsing happens twice on purpose: once against a
 * throwaway id for the preview, and again against the chosen calendar on
 * confirm, so the stored events carry the right `calendarId` from the start.
 */
export function IcsImportModal({
  isOpen,
  icsText,
  fileName,
  onClose,
  onImported,
}: IcsImportModalProps): JSX.Element | null {
  const calendars = useCalendarStore((state) => state.calendars)
  const writableCalendars = useMemo(() => calendars.filter((c) => !c.readOnly), [calendars])

  const defaultCalendarId =
    writableCalendars.find((c) => c.isDefault)?.id ??
    writableCalendars[0]?.id ??
    NEW_CALENDAR_OPTION

  const [targetCalendarId, setTargetCalendarId] = useState<string>(defaultCalendarId)
  const [newCalendarName, setNewCalendarName] = useState('')
  const [newCalendarColor, setNewCalendarColor] = useState<string>(EVENT_COLORS[0])
  const [error, setError] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const isImportingRef = useRef(false)

  const caldav = useCalDAV()
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  // Closed synchronously rather than through useAnimatedClose: the parent
  // unmounts this on close anyway, and a deferred close leaves the dialog in
  // the tree for the animation window after the user has already dismissed it.
  const requestClose = useCallback((): void => {
    setError('')
    setIsImporting(false)
    isImportingRef.current = false
    onClose()
  }, [onClose])

  const dialogRef = useRef<HTMLDivElement>(null)
  useModalDismiss(dialogRef, isOpen, requestClose)

  // Parsed once per file, not per render — parseICALData walks the whole
  // document three times (events, tasks, journals). parseICALData already
  // catches ICAL.parse failures per-component internally, but a malformed
  // file can still hit an unexpected exception path (e.g. inside a type
  // mapper) — this MUST NOT throw during render, or the whole modal tree
  // (and anything above it) unmounts. Any parse failure degrades to "0
  // items found" rather than a crash.
  const { parsed, parseFailed } = useMemo((): {
    parsed: CalendarEvent[]
    parseFailed: boolean
  } => {
    if (!icsText) return { parsed: [], parseFailed: false }
    try {
      return { parsed: parseICALData(icsText, 'preview'), parseFailed: false }
    } catch (e) {
      console.error('Failed to parse .ics file for import preview:', e)
      return { parsed: [], parseFailed: true }
    }
  }, [icsText])

  // Recomputed as the target changes: an incoming UID only counts as a
  // duplicate if it already exists in the calendar we're about to write to.
  const duplicateCount = useMemo(() => {
    if (targetCalendarId === NEW_CALENDAR_OPTION) return 0
    const existing = new Set(
      useCalendarStore
        .getState()
        .events.filter((e) => e.calendarId === targetCalendarId)
        .map((e) => e.uid ?? e.id)
    )
    return parsed.filter((e) => existing.has(e.uid ?? e.id)).length
  }, [parsed, targetCalendarId])

  // "events" while the file is only VEVENTs — which is the overwhelmingly
  // common case — and the broader "items" once tasks or journals are in play.
  const noun = parsed.some((e) => e.type === 'task' || e.type === 'journal') ? 'item' : 'event'
  const plural = (n: number): string => (n === 1 ? noun : `${noun}s`)

  const handleConfirm = async (): Promise<void> => {
    if (!icsText || isImportingRef.current) return

    let calendarId = targetCalendarId
    let calendarName: string

    if (targetCalendarId === NEW_CALENDAR_OPTION) {
      const name = newCalendarName.trim() || fileName?.replace(/\.ics$/i, '').trim() || ''
      if (!name) {
        setError('Enter a name for the new calendar')
        return
      }
      calendarId = crypto.randomUUID()
      calendarName = name
      useCalendarStore.getState().addCalendar({
        id: calendarId,
        name,
        color: newCalendarColor,
        isVisible: true,
        isDefault: false,
        showTasksInViews: true,
        source: 'local',
      })
    } else {
      calendarName = calendars.find((c) => c.id === calendarId)?.name ?? 'calendar'
    }

    isImportingRef.current = true
    setIsImporting(true)
    setError('')

    try {
      const existing = new Set(
        useCalendarStore
          .getState()
          .events.filter((e) => e.calendarId === calendarId)
          .map((e) => e.uid ?? e.id)
      )

      const incoming = parseICALData(icsText, calendarId).filter(
        (e) => !existing.has(e.uid ?? e.id)
      )

      for (const event of incoming) {
        useCalendarStore.getState().addEvent(event)
      }

      // Group by UID before pushing: a recurring series' master and its
      // overrides share one UID and MUST live in a single calendar object
      // resource (RFC 4791 §4.1), not one PUT per component. All group
      // members go out in one `createEventGroup` PUT per UID. This is a
      // no-op for local (non-CalDAV) calendars and falls back to
      // pendingChanges when offline, same as the previous per-event push.
      const groups = new Map<string, CalendarEvent[]>()
      for (const event of incoming) {
        const key = event.uid ?? event.id
        const group = groups.get(key)
        if (group) group.push(event)
        else groups.set(key, [event])
      }

      for (const group of groups.values()) {
        await caldav.createEventGroup(calendarId, group)
      }

      const skipped = parsed.length - incoming.length
      showToast(
        skipped > 0
          ? `Imported ${incoming.length} into ${calendarName} (${skipped} already there)`
          : `Imported ${incoming.length} ${plural(incoming.length)} into ${calendarName}`
      )
      onImported?.(incoming.length, calendarName)
      requestClose()
    } catch {
      setError('Failed to import. Please check the file and try again.')
    } finally {
      isImportingRef.current = false
      setIsImporting(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) requestClose()
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className={shell.modal}
      onClick={handleBackdropClick}
      data-component="ics-import-modal"
    >
      <div
        ref={dialogRef}
        className={shell.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ics-import-modal-title"
      >
        <div className={shell.modalHeader}>
          <h3 className={shell.modalTitle} id="ics-import-modal-title">
            Import {parsed.length} {plural(parsed.length)}
          </h3>
          <button className={shell.modalClose} onClick={requestClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className={styles.summary}>
          {fileName && <span className={styles.fileName}>{fileName}</span>}
          {fileName && ' — '}
          Choose which calendar these should be added to.
        </p>

        {parseFailed ? (
          <p className={shell.errorMessage} data-component="ics-import-parse-error">
            This file could not be read as a calendar file. Please check it and try again.
          </p>
        ) : parsed.length === 0 ? (
          <p className={styles.emptyState} data-component="ics-import-empty">
            No events, tasks, or journal entries were found in this file.
          </p>
        ) : (
          <div className={styles.previewList} data-component="ics-import-preview">
            {parsed.slice(0, PREVIEW_LIMIT).map((event, i) => (
              <div key={`${event.id}-${i}`} className={styles.previewRow}>
                <span className={styles.previewTitle}>{event.title || '(untitled)'}</span>
                {event.type && KIND_LABELS[event.type] && (
                  <span className={styles.previewKind}>{KIND_LABELS[event.type]}</span>
                )}
                <span className={styles.previewWhen}>{describeWhen(event, timeFormat)}</span>
              </div>
            ))}
            {parsed.length > PREVIEW_LIMIT && (
              <div className={styles.previewMore}>+{parsed.length - PREVIEW_LIMIT} more</div>
            )}
          </div>
        )}

        <div className={shell.formGroup}>
          <label htmlFor="icsImportTarget" className={shell.formLabel}>
            Add to
          </label>
          <select
            id="icsImportTarget"
            className={shell.input}
            value={targetCalendarId}
            onChange={(e) => {
              setTargetCalendarId(e.target.value)
              setError('')
            }}
            data-component="ics-target-calendar-select"
            data-testid="ics-import-calendar-select"
          >
            <option value={NEW_CALENDAR_OPTION}>New calendar…</option>
            {writableCalendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {targetCalendarId === NEW_CALENDAR_OPTION && (
          <>
            <div className={shell.formGroup}>
              <label htmlFor="icsImportNewName" className={shell.formLabel}>
                Calendar name
              </label>
              <input
                id="icsImportNewName"
                className={shell.input}
                placeholder={fileName?.replace(/\.ics$/i, '') || 'Imported calendar'}
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
                data-testid="ics-import-new-calendar-name"
              />
            </div>
            <div className={shell.formGroup}>
              <label className={shell.formLabel}>Color</label>
              <div className={shell.colorGrid}>
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${shell.colorOption} ${newCalendarColor === c ? shell.colorSelected : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewCalendarColor(c)}
                    aria-label={`Select color ${c}`}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {duplicateCount > 0 && (
          <p className={styles.duplicateNote} data-component="ics-import-duplicates">
            {duplicateCount} of these {duplicateCount === 1 ? 'is' : 'are'} already in this calendar
            and will be skipped.
          </p>
        )}

        {error && <p className={shell.errorMessage}>{error}</p>}

        <div className={shell.modalFooter}>
          <button
            type="button"
            className={`${shell.button} ${shell.buttonSecondary}`}
            onClick={requestClose}
            disabled={isImporting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${shell.button} ${shell.buttonPrimary}`}
            onClick={handleConfirm}
            disabled={isImporting || parseFailed}
            aria-busy={isImporting}
            data-testid="ics-import-confirm"
          >
            {isImporting ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
