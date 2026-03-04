import type { JSX } from 'react'
import { useState } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalendarStore } from '@/store/calendarStore'
import { parseICALEvent } from '@/features/caldav/adapter/iCalendarAdapter'
import styles from './OnboardingModal.module.css'

interface OnboardingModalProps {
  onAddCalendar: () => void
}

export function OnboardingModal({ onAddCalendar }: OnboardingModalProps): JSX.Element | null {
  const [isLoadingDemo, setIsLoadingDemo] = useState(false)
  const [demoError, setDemoError] = useState('')

  const hasCompletedOnboarding = useSettingsStore((state) => state.hasCompletedOnboarding)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const calendars = useCalendarStore((state) => state.calendars)

  if (hasCompletedOnboarding) {
    return null
  }

  const handleDismiss = (): void => {
    updateSettings({ hasCompletedOnboarding: true })
  }

  const handleAddCalendar = (): void => {
    updateSettings({ hasCompletedOnboarding: true })
    onAddCalendar()
  }

  const handleLoadDemoData = async (): Promise<void> => {
    setIsLoadingDemo(true)
    setDemoError('')

    try {
      const response = await fetch('/sample-events.ics')
      if (!response.ok) {
        throw new Error('Failed to load demo data')
      }

      const icsData = await response.text()
      const defaultCalendar = calendars.find((c) => c.isDefault) ?? calendars[0]
      const calendarId = defaultCalendar?.id ?? 'default'

      const events = parseICALEvent(icsData, calendarId)
      events.forEach((event) => addEvent(event))

      updateSettings({ hasCompletedOnboarding: true })
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : 'Failed to load demo data')
    } finally {
      setIsLoadingDemo(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) {
      handleDismiss()
    }
  }

  return (
    <div className={styles.modal} onClick={handleBackdropClick}>
      <div className={styles.modalContent} role="dialog" aria-modal="true">
        <div className={styles.icon}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="24" fill="#e8f0fe" />
            <path
              d="M24 14C19.5817 14 16 17.5817 16 22C16 26.4183 19.5817 30 24 30C28.4183 30 32 26.4183 32 22C32 17.5817 28.4183 14 24 14ZM24 18C22.3431 18 21 19.3431 21 21C21 22.6569 22.3431 24 24 24C25.6569 24 27 22.6569 27 21C27 19.3431 25.6569 18 24 18ZM24 28C21.7909 28 20 26.2091 20 24C20 22.2203 21.1857 20.7202 22.8617 20.2551C23.4033 20.0926 24 20.5184 24 21.0909V24C24 24.5523 24.4477 25 25 25C25.5523 25 26 24.5523 26 24V18H27C27.5523 18 28 17.5523 28 17C28 16.4477 27.5523 16 27 16H21C20.4477 16 20 16.4477 20 17C20 17.5523 20.4477 18 21 18H22V21.0909C22.0562 21.6484 22.6236 22.0848 23.1867 21.8556C24.4579 21.4011 25.5362 20.4831 26.1486 19.2824C26.4779 18.5945 27.1668 18.1393 27.914 18.1393H28C28.5523 18.1393 29 18.5869 29 19.1393C29 19.6917 28.5523 20.1393 28 20.1393H27.8857C27.0121 21.6276 25.6318 22.7529 24 23.4749V28C24 28.5523 23.5523 29 23 29C22.4477 29 22 28.5523 22 28V27C22 26.4477 22.4477 26 23 26H25C25.5523 26 26 25.5523 26 25C26 24.4477 25.5523 24 25 24H23V21.0909C23 20.5184 23.5967 20.0926 24.1383 20.2551C25.8143 20.7202 27 22.2203 27 24C27 26.2091 25.2091 28 24 28Z"
              fill="#1a73e8"
            />
          </svg>
        </div>

        <h2 className={styles.title}>Your calendar stays private</h2>

        <p className={styles.description}>
          All your events are stored locally in your browser. GoodCal doesn't send any data to
          external servers.
        </p>

        <p className={styles.description}>
          <strong>To keep your events safe</strong>, connect a CalDAV account (iCloud, Nextcloud,
          FastMail) — this syncs your calendar to your own server, so your data is never lost if you
          clear browser data. Alternatively, you can back up and transfer your data using the
          export/import feature in Settings.
        </p>

        {demoError && <p className={styles.errorMessage}>{demoError}</p>}

        <div className={styles.footer}>
          <button className={styles.addButton} onClick={handleAddCalendar}>
            Add CalDAV Account
          </button>
          <button
            className={styles.demoButton}
            onClick={handleLoadDemoData}
            disabled={isLoadingDemo}
          >
            {isLoadingDemo ? 'Loading...' : 'Try with sample data'}
          </button>
          <button className={styles.skipButton} onClick={handleDismiss}>
            I'll do it later
          </button>
        </div>
      </div>
    </div>
  )
}
