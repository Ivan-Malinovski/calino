import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useState, useRef } from 'react'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useContactStore } from '@/store/contactStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useCardDAV } from '@/features/carddav/hooks/useCardDAV'
import { exportAllEventsIcs } from '@/lib/icsExport'
import { IcsImportModal } from '@/features/calendar/components/IcsImportModal'
import {
  parseVCardFile,
  contactsToVCardFile,
  downloadFile,
  readFileAsText,
} from '@/features/carddav/lib/vCardFileUtils'
import { showToast } from '@/lib/toast'
import { MergeDuplicatesModal } from '@/features/carddav/components/MergeDuplicatesModal'
import { ImportExportModal } from '@/features/carddav/components/ImportExportModal'
import { formatBrokenEventDate as formatDate } from '../lib/format'
import { useBrokenEventsActions } from '../hooks/useBrokenEventsActions'
import type { Contact } from '@/features/carddav/types'
import styles from './Settings.module.css'

export function DataSettings(): JSX.Element {
  const { t } = useTranslation('settings')
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pendingIcs, setPendingIcs] = useState<{ text: string; fileName: string } | null>(null)

  const events = useCalendarStore((state) => state.events)
  const brokenEvents = useCalendarStore((state) => state.brokenEvents)
  const duplicateUidIssues = useCalendarStore((state) => state.duplicateUidIssues)
  const clearDuplicateUidIssues = useCalendarStore((state) => state.clearDuplicateUidIssues)
  const removeDuplicateUidResource = useCalendarStore((state) => state.removeDuplicateUidResource)
  const [deletingHref, setDeletingHref] = useState<string | null>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const caldav = useCalDAV()
  const { handleFix, handleDelete, handleFixAll, handleDeleteAll } = useBrokenEventsActions(
    'caldav',
    {
      updateEvent: caldav.updateEvent,
      deleteEvent: caldav.deleteEvent,
    }
  )

  const handleExportICS = async (): Promise<void> => {
    setIsExporting(true)
    try {
      exportAllEventsIcs(events)
    } finally {
      setIsExporting(false)
    }
  }

  const handleImport = (): void => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    const fileName = file.name.toLowerCase()
    try {
      const text = await file.text()

      if (fileName.endsWith('.json')) {
        const data = JSON.parse(text)
        if (data.events && Array.isArray(data.events)) {
          for (const event of data.events) {
            useCalendarStore.getState().addEvent(event)
          }
          setImportStatus({ type: 'success', message: t('data.importedEvents', { count: data.events.length }) })
        } else {
          setImportStatus({ type: 'error', message: t('data.noEventsInJson') })
        }
      } else if (fileName.endsWith('.ics')) {
        // Don't import directly — hand off to the shared review modal so the
        // user picks (or creates) the target calendar first, rather than
        // silently dropping events into whatever calendar happens to be
        // default. Same component the drag-and-drop drop zone uses.
        setPendingIcs({ text, fileName: file.name })
      }
    } catch {
      setImportStatus({ type: 'error', message: t('data.importFailed') })
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (!fileName.endsWith('.ics')) {
        setTimeout(() => setImportStatus(null), 3000)
      }
    }
  }

  const handleIcsImported = (count: number): void => {
    setImportStatus({ type: 'success', message: t('data.importedEvents', { count }) })
    setTimeout(() => setImportStatus(null), 3000)
  }

  const handleDeleteDuplicateResource = async (
    issue: { uid: string; calendarId: string },
    href: string
  ): Promise<void> => {
    setDeletingHref(href)
    try {
      await caldav.deleteEventByHref(issue.calendarId, href)
      removeDuplicateUidResource(issue.uid, issue.calendarId, href)
      showToast(t('data.duplicateDeleted'))
    } catch {
      showToast(t('data.duplicateDeleteFailed'))
    } finally {
      setDeletingHref(null)
    }
  }

  const handleClearData = async (): Promise<void> => {
    if (!confirm(t('data.resetApp.confirm'))) return
    localStorage.clear()
    sessionStorage.clear()
    window.location.reload()
  }

  // --------------------------------------------------------------------------
  // Contacts import/export
  // --------------------------------------------------------------------------
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [parsedImportContacts, setParsedImportContacts] = useState<Contact[]>([])
  const [isMergeOpen, setIsMergeOpen] = useState(false)
  const contactFileInputRef = useRef<HTMLInputElement>(null)
  const contacts = useContactStore((s) => s.contacts)
  const { syncAccount } = useCardDAV()

  const handleContactImportClick = (): void => {
    contactFileInputRef.current?.click()
  }

  const handleContactImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const content = await readFileAsText(file)
      const addressBooks = useContactStore.getState().addressBooks
      const visibleAbs = addressBooks.filter((ab) => ab.isVisible)
      const targetAbId = visibleAbs[0]?.id ?? ''
      const accountId = visibleAbs[0]?.accountId ?? ''
      const parsed = parseVCardFile(content, targetAbId, accountId)

      if (parsed.length === 0) {
        showToast(t('data.noContactsInFile'))
        return
      }

      setParsedImportContacts(parsed)
      setIsImportOpen(true)
    } catch {
      showToast(t('data.failedToParseVCard'))
    } finally {
      if (contactFileInputRef.current) contactFileInputRef.current.value = ''
    }
  }

  const handleContactExport = (): void => {
    if (contacts.length === 0) {
      showToast(t('data.noContactsToExport'))
      return
    }
    const vcf = contactsToVCardFile(contacts)
    downloadFile(vcf, 'contacts.vcf')
    showToast(t('data.exportedContacts', { count: contacts.length }))
  }

  return (
    <section className={`${styles.section} ${styles.sectionActive}`} data-component="data-settings">
      <h1 className={styles.pageTitle}>{t('data.title')}</h1>

      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('data.importExport')}</div>
        <div className={styles.actionRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('data.exportCalendar.label')}</div>
            <div className={styles.rowDesc}>{t('data.exportCalendar.desc')}</div>
          </div>
          <button
            className={styles.actionBtn}
            onClick={handleExportICS}
            disabled={isExporting}
            data-component="action-button"
            data-action="export-ics"
            type="button"
          >
            {isExporting ? t('data.exportCalendar.exporting') : t('data.exportCalendar.export')}
          </button>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('data.importCalendar.label')}</div>
            <div className={styles.rowDesc}>{t('data.importCalendar.desc')}</div>
          </div>
          <button
            className={styles.actionBtn}
            onClick={handleImport}
            disabled={isImporting}
            data-component="action-button"
            data-action="import-calendar"
            type="button"
          >
            {isImporting ? t('data.importCalendar.importing') : t('data.importCalendar.chooseFile')}
          </button>
        </div>
        {importStatus && (
          <div
            className={`${styles.importStatus} ${importStatus.type === 'success' ? styles.importStatusSuccess : styles.importStatusError}`}
            data-component="import-status"
          >
            {importStatus.message}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.ics"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          data-testid="import-calendar-input"
        />
      </div>

      {pendingIcs !== null && (
        <IcsImportModal
          isOpen
          icsText={pendingIcs.text}
          fileName={pendingIcs.fileName}
          onClose={() => setPendingIcs(null)}
          onImported={handleIcsImported}
        />
      )}

      {/* Contacts */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('data.contacts')}</div>
        <div className={styles.actionRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('data.exportContacts.label')}</div>
            <div className={styles.rowDesc}>{t('data.exportContacts.desc')}</div>
          </div>
          <button className={styles.actionBtn} onClick={handleContactExport} type="button">
            {t('data.exportContacts.export')}
          </button>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('data.importContacts.label')}</div>
            <div className={styles.rowDesc}>{t('data.importContacts.desc')}</div>
          </div>
          <button className={styles.actionBtn} onClick={handleContactImportClick} type="button">
            {t('data.importContacts.chooseFile')}
          </button>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('data.mergeDuplicates.label')}</div>
            <div className={styles.rowDesc}>{t('data.mergeDuplicates.desc')}</div>
          </div>
          <button className={styles.actionBtn} onClick={() => setIsMergeOpen(true)} type="button">
            {t('data.mergeDuplicates.merge')}
          </button>
        </div>
        <input
          ref={contactFileInputRef}
          type="file"
          accept=".vcf,text/vcard"
          onChange={handleContactImportFile}
          style={{ display: 'none' }}
          data-testid="import-contacts-input"
        />
      </div>

      {/* Broken Events */}
      <div className={styles.group} data-component="broken-events">
        <div className={styles.groupLabel}>{t('data.dataIssues')}</div>
        {brokenEvents.length === 0 && duplicateUidIssues.length === 0 && (
          <div className={styles.rowDesc} style={{ padding: '12px 20px 16px' }}>
            {t('data.noIssues')}
          </div>
        )}
        {brokenEvents.length > 0 && (
          <>
            <p className={styles.rowDesc} style={{ padding: '12px 20px 0' }}>
              {t('data.brokenEventsIntro')}
            </p>

            <div className={styles.brokenList}>
              {brokenEvents.map((broken) => (
                <div
                  key={broken.event.id}
                  className={styles.brokenItem}
                  data-component="broken-event-row"
                  data-event-id={broken.event.id}
                >
                  <div className={styles.brokenInfo}>
                    <div className={styles.brokenTitle}>
                      {broken.event.title || 'Untitled Event'}
                    </div>
                    <div className={styles.brokenDates}>
                      <span>Start: {formatDate(broken.event.start, timeFormat)}</span>
                      <span className={styles.brokenArrow}>→</span>
                      <span>End: {formatDate(broken.event.end, timeFormat)}</span>
                    </div>
                    <div className={styles.brokenReason}>{broken.reason}</div>
                  </div>
                  <div className={styles.brokenActions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => void handleFix(broken)}
                      data-component="action-button"
                      data-action="fix-broken-event"
                      type="button"
                    >
                      Fix
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => void handleDelete(broken)}
                      data-component="action-button"
                      data-action="delete-broken-event"
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {brokenEvents.length > 1 && (
              <div className={styles.brokenBatchActions}>
                <button
                  className={styles.actionBtn}
                  onClick={() => void handleFixAll(brokenEvents)}
                  data-component="action-button"
                  data-action="fix-all-broken"
                  type="button"
                >
                  Fix All ({brokenEvents.length})
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                  onClick={() => void handleDeleteAll(brokenEvents)}
                  data-component="action-button"
                  data-action="delete-all-broken"
                  type="button"
                >
                  Delete All
                </button>
              </div>
            )}
          </>
        )}

        {duplicateUidIssues.length > 0 && (
          <div data-component="duplicate-uid-issues">
            <p className={styles.rowDesc} style={{ padding: '16px 20px 0' }}>
              These events share the same unique ID (UID) on your server but are stored as separate
              items. Calino can only show one of each set — the others are hidden to keep your
              calendar stable. This usually comes from a bulk copy made in another app. To fix it,
              give each event a unique UID on your server, then sync again.
            </p>

            <div className={styles.brokenList}>
              {duplicateUidIssues.map((issue) => (
                <div
                  key={`${issue.calendarId}-${issue.uid}`}
                  className={styles.brokenItem}
                  data-component="duplicate-uid-row"
                  data-uid={issue.uid}
                >
                  <div className={styles.brokenInfo}>
                    <div className={styles.brokenTitle}>Duplicate UID: {issue.uid}</div>
                    {issue.resources.map((res) => (
                      <div
                        key={res.href}
                        className={styles.brokenDates}
                        data-component="duplicate-uid-resource"
                        data-href={res.href}
                      >
                        <span>{res.title || 'Untitled Event'}</span>
                        <span className={styles.brokenArrow}>·</span>
                        <span>{formatDate(res.start, timeFormat)}</span>
                        <span className={styles.brokenArrow}>·</span>
                        <span>{res.kept ? 'Kept' : 'Hidden'}</span>
                        <button
                          className={styles.duplicateResourceDeleteBtn}
                          onClick={() => void handleDeleteDuplicateResource(issue, res.href)}
                          disabled={deletingHref === res.href}
                          data-component="action-button"
                          data-action="delete-duplicate-uid-resource"
                          type="button"
                        >
                          {deletingHref === res.href ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className={styles.brokenActions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => clearDuplicateUidIssues()}
                      data-component="action-button"
                      data-action="dismiss-duplicate-uid"
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={`${styles.group} ${styles.dangerZone}`}>
        <div className={`${styles.groupLabel} ${styles.dangerZoneLabel}`}>{t('data.dangerZone')}</div>
        <div className={styles.actionRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('data.deleteAllEvents.label')}</div>
            <div className={styles.rowDesc}>{t('data.deleteAllEvents.desc')}</div>
          </div>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            onClick={() => {
              if (confirm(t('data.deleteAllEvents.confirm'))) {
                const allEvents = useCalendarStore.getState().events
                allEvents.forEach((e) => useCalendarStore.getState().deleteEvent(e.id))
              }
            }}
            data-component="action-button"
            data-action="delete-all-events"
            type="button"
          >
            {t('data.deleteAllEvents.action')}
          </button>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('data.resetApp.label')}</div>
            <div className={styles.rowDesc}>{t('data.resetApp.desc')}</div>
          </div>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            onClick={handleClearData}
            data-component="action-button"
            data-action="reset-app"
            type="button"
          >
            {t('data.resetApp.action')}
          </button>
        </div>
      </div>

      {/* Import contacts modal */}
      <ImportExportModal
        isOpen={isImportOpen}
        onClose={() => {
          setIsImportOpen(false)
          setParsedImportContacts([])
        }}
        parsedContacts={parsedImportContacts}
        onImportComplete={() => {
          const addressBooks = useContactStore.getState().addressBooks
          const ab = addressBooks.find((a) => a.isVisible)
          if (ab?.accountId) syncAccount(ab.accountId).catch(() => {})
        }}
      />

      {/* Merge duplicates modal */}
      <MergeDuplicatesModal isOpen={isMergeOpen} onClose={() => setIsMergeOpen(false)} />
    </section>
  )
}
