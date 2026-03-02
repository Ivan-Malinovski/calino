import type { JSX } from 'react'
import { useState, useRef } from 'react'
import { useCalendarStore } from '@/store/calendarStore'
import { parseICALEvent } from '@/features/caldav/adapter/iCalendarAdapter'
import styles from './Settings.module.css'

export function DataSettings(): JSX.Element {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const updateCalendar = useCalendarStore((state) => state.updateCalendar)

  const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]

  const handleSetDefaultCalendar = (calendarId: string): void => {
    calendars.forEach((cal) => {
      updateCalendar(cal.id, { isDefault: cal.id === calendarId })
    })
  }

  const handleExport = async (): Promise<void> => {
    setIsExporting(true)
    try {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        events,
        calendars,
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `goodcal-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportICS = async (): Promise<void> => {
    setIsExporting(true)
    try {
      const formatDate = (date: string): string => {
        const formatted = date.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
        return formatted.endsWith('Z') || formatted.endsWith('z') ? formatted : formatted + 'Z'
      }

      let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GoodCal//Calendar//EN\r\n'

      for (const event of events) {
        ics += 'BEGIN:VEVENT\r\n'
        ics += `UID:${event.id}\r\n`
        ics += `DTSTART:${formatDate(event.start)}\r\n`
        ics += `DTEND:${formatDate(event.end)}\r\n`
        ics += `SUMMARY:${event.title}\r\n`
        if (event.description) {
          ics += `DESCRIPTION:${event.description}\r\n`
        }
        if (event.location) {
          ics += `LOCATION:${event.location}\r\n`
        }
        ics += 'END:VEVENT\r\n'
      }

      ics += 'END:VCALENDAR\r\n'

      const blob = new Blob([ics], { type: 'text/calendar' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `goodcal-export-${new Date().toISOString().split('T')[0]}.ics`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
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
    try {
      const text = await file.text()
      const fileName = file.name.toLowerCase()

      if (fileName.endsWith('.json')) {
        const data = JSON.parse(text)

        if (data.events && Array.isArray(data.events)) {
          for (const event of data.events) {
            useCalendarStore.getState().addEvent(event)
          }
          setImportStatus({
            type: 'success',
            message: `Imported ${data.events.length} events from JSON`,
          })
        } else {
          setImportStatus({ type: 'error', message: 'No events found in JSON file' })
        }
      } else if (fileName.endsWith('.ics')) {
        const defaultCalendar = calendars.find((c) => c.isDefault) ?? calendars[0]
        const calendarId = defaultCalendar?.id ?? 'default'

        const importedEvents = parseICALEvent(text, calendarId)

        for (const event of importedEvents) {
          useCalendarStore.getState().addEvent(event)
        }
        setImportStatus({
          type: 'success',
          message: `Imported ${importedEvents.length} events from ICS`,
        })
      }
    } catch (error) {
      console.error('Failed to import file:', error)
      setImportStatus({ type: 'error', message: 'Failed to import file. Please check the format.' })
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setTimeout(() => setImportStatus(null), 3000)
    }
  }

  const handleClearData = async (): Promise<void> => {
    if (!confirm('Are you sure you want to delete all local data? This cannot be undone.')) {
      return
    }

    setIsClearing(true)
    try {
      localStorage.clear()
      sessionStorage.clear()
      window.location.reload()
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Data & Storage</h2>
      <p className={styles.sectionDescription}>Export, import, or clear your calendar data.</p>

      {calendars.length > 0 && (
        <div className={styles.settingRow}>
          <div className={styles.settingLabel}>
            <span className={styles.settingLabelText}>Default Calendar</span>
            <span className={styles.settingLabelHint}>Used when creating new events</span>
          </div>
          <select
            className={styles.select}
            value={defaultCalendar?.id || ''}
            onChange={(e) => handleSetDefaultCalendar(e.target.value)}
          >
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Export Calendar</span>
          <span className={styles.settingLabelHint}>Download your events as JSON or ICS file</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export JSON'}
          </button>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={handleExportICS}
            disabled={isExporting}
          >
            Export ICS
          </button>
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Import Calendar</span>
          <span className={styles.settingLabelHint}>Restore events from a JSON or ICS file</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleImport}
              disabled={isImporting}
            >
              {isImporting ? 'Importing...' : 'Import JSON'}
            </button>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleImport}
              disabled={isImporting}
            >
              {isImporting ? 'Importing...' : 'Import ICS'}
            </button>
          </div>
          {importStatus && (
            <span
              style={{
                fontSize: '13px',
                color: importStatus.type === 'success' ? '#1e8e3e' : '#d93025',
              }}
            >
              {importStatus.message}
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.ics"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Clear All Data</span>
          <span className={styles.settingLabelHint}>
            Delete all events, calendars, and settings
          </span>
        </div>
        <button
          className={`${styles.button} ${styles.buttonDanger}`}
          onClick={handleClearData}
          disabled={isClearing}
        >
          {isClearing ? 'Clearing...' : 'Clear All Data'}
        </button>
      </div>
    </div>
  )
}
