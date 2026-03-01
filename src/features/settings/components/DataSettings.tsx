import type { JSX } from 'react'
import { useState, useRef } from 'react'
import { useCalendarStore } from '@/store/calendarStore'
import styles from './Settings.module.css'

export function DataSettings(): JSX.Element {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)

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
        return date.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
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
      const data = JSON.parse(text)

      if (data.events && Array.isArray(data.events)) {
        for (const event of data.events) {
          useCalendarStore.getState().addEvent(event)
        }
      }
    } catch {
      console.error('Failed to import file')
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
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
          <span className={styles.settingLabelHint}>Restore events from a JSON backup</span>
        </div>
        <button
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={handleImport}
          disabled={isImporting}
        >
          {isImporting ? 'Importing...' : 'Import JSON'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
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
