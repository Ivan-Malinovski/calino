import type { JSX } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore, EVENT_COLORS } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import { showToast } from '@/lib/toast'
import { withProgress } from '@/store/progressStore'
import { formatDisplayDate } from '@/lib/datetime'
import i18n from '@/lib/i18n'
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
    if (event.isAllDay) return formatDisplayDate(date, 'd MMM yyyy')
    return formatDisplayDate(date, timeFormat === '12h' ? 'd MMM yyyy, h:mm a' : 'd MMM yyyy, HH:mm')
  } catch {
    return ''
  }
}

function kindLabel(type: string): string | undefined {
  if (type === 'task') return i18n.t('modals.icsImport.kindTask', { ns: 'calendar' })
  if (type === 'journal') return i18n.t('modals.icsImport.kindJournal', { ns: 'calendar' })
  return undefined
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
  const { t } = useTranslation(['calendar', 'common'])
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

  const handleConfirm = async (): Promise<void> => {
    if (!icsText || isImportingRef.current) return

    let calendarId = targetCalendarId
    let calendarName: string

    if (targetCalendarId === NEW_CALENDAR_OPTION) {
      const name = newCalendarName.trim() || fileName?.replace(/\.ics$/i, '').trim() || ''
      if (!name) {
        setError(t('modals.icsImport.enterCalendarName'))
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
      calendarName = calendars.find((c) => c.id === calendarId)?.name ?? t('modals.icsImport.calendarFallback')
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

      // One task for the whole import, not one per group: `createEventGroup`
      // tracks itself, and a few hundred short-lived tasks would flicker the
      // pill instead of showing steady progress. `owned` silences those.
      await withProgress(
        i18n.t('modals.icsImport.importingProgress', {
          count: incoming.length,
          context: noun,
          ns: 'calendar',
        }),
        async (report) => {
          let done = 0
          report({ done, total: groups.size })
          for (const group of groups.values()) {
            await caldav.createEventGroup(calendarId, group)
            report({ done: ++done, total: groups.size })
          }
        },
        { owned: true }
      )

      const skipped = parsed.length - incoming.length
      showToast(
        skipped > 0
          ? i18n.t('modals.icsImport.importedSkipped', {
              count: incoming.length,
              calendarName,
              skipped,
              ns: 'calendar',
            })
          : i18n.t('modals.icsImport.imported', {
              count: incoming.length,
              context: noun,
              calendarName,
              ns: 'calendar',
            })
      )
      onImported?.(incoming.length, calendarName)
      requestClose()
    } catch {
      setError(t('modals.icsImport.importFailed'))
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
            {t('modals.icsImport.title', { count: parsed.length, context: noun })}
          </h3>
          <button
            className={shell.modalClose}
            onClick={requestClose}
            aria-label={t('common:actions.close')}
          >
            ✕
          </button>
        </div>

        <p className={styles.summary}>
          {fileName && <span className={styles.fileName}>{fileName}</span>}
          {fileName && ' — '}
          {t('modals.icsImport.chooseCalendar')}
        </p>

        {parseFailed ? (
          <p className={shell.errorMessage} data-component="ics-import-parse-error">
            {t('modals.icsImport.parseError')}
          </p>
        ) : parsed.length === 0 ? (
          <p className={styles.emptyState} data-component="ics-import-empty">
            {t('modals.icsImport.emptyResult')}
          </p>
        ) : (
          <div className={styles.previewList} data-component="ics-import-preview">
            {parsed.slice(0, PREVIEW_LIMIT).map((event, i) => (
              <div key={`${event.id}-${i}`} className={styles.previewRow}>
                <span className={styles.previewTitle}>
                  {event.title || t('modals.icsImport.untitled')}
                </span>
                {event.type && kindLabel(event.type) && (
                  <span className={styles.previewKind}>{kindLabel(event.type)}</span>
                )}
                <span className={styles.previewWhen}>{describeWhen(event, timeFormat)}</span>
              </div>
            ))}
            {parsed.length > PREVIEW_LIMIT && (
              <div className={styles.previewMore}>
                {t('modals.icsImport.moreCount', { count: parsed.length - PREVIEW_LIMIT })}
              </div>
            )}
          </div>
        )}

        <div className={shell.formGroup}>
          <label htmlFor="icsImportTarget" className={shell.formLabel}>
            {t('modals.icsImport.addTo')}
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
            <option value={NEW_CALENDAR_OPTION}>{t('modals.icsImport.newCalendarOption')}</option>
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
                {t('modals.icsImport.calendarNameLabel')}
              </label>
              <input
                id="icsImportNewName"
                className={shell.input}
                placeholder={
                  fileName?.replace(/\.ics$/i, '') || t('modals.icsImport.importedCalendarPlaceholder')
                }
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
                data-testid="ics-import-new-calendar-name"
              />
            </div>
            <div className={shell.formGroup}>
              <label className={shell.formLabel}>{t('modals.icsImport.colorLabel')}</label>
              <div className={shell.colorGrid}>
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${shell.colorOption} ${newCalendarColor === c ? shell.colorSelected : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewCalendarColor(c)}
                    aria-label={t('modals.icsImport.selectColor', { color: c })}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {duplicateCount > 0 && (
          <p className={styles.duplicateNote} data-component="ics-import-duplicates">
            {t('modals.icsImport.duplicateNote', { count: duplicateCount })}
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
            {t('common:actions.cancel')}
          </button>
          <button
            type="button"
            className={`${shell.button} ${shell.buttonPrimary}`}
            onClick={handleConfirm}
            disabled={isImporting || parseFailed}
            aria-busy={isImporting}
            data-testid="ics-import-confirm"
          >
            {isImporting ? t('modals.icsImport.importing') : t('modals.icsImport.importAction')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
