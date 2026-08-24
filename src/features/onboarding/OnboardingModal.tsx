import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useSettingsStore, EVENT_COLORS } from '@/store/settingsStore'
import { useCalendarStore } from '@/store/calendarStore'
import { useContactStore } from '@/store/contactStore'
import { useConfigStore } from '@/store/configStore'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import { parseVCard } from '@/features/carddav/adapter/vCardAdapter'
import { requestNativeReminderPermission } from '@/lib/nativeReminders'
import { config } from '@/config'
import { createUuid } from '@/lib/uuid'
import styles from './OnboardingModal.module.css'

const isNative = Capacitor.isNativePlatform()

interface OnboardingModalProps {
  onAddCalendar: () => void
}

export function OnboardingModal({ onAddCalendar }: OnboardingModalProps): JSX.Element | null {
  const [isLoadingDemo, setIsLoadingDemo] = useState(false)
  const [demoError, setDemoError] = useState('')

  const hasCompletedOnboarding = useSettingsStore((state) => state.hasCompletedOnboarding)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const addCategory = useCalendarStore((state) => state.addCategory)
  const categories = useCalendarStore((state) => state.categories)
  const calendars = useCalendarStore((state) => state.calendars)
  const addContact = useContactStore((state) => state.addContact)
  const addAddressBook = useContactStore((state) => state.addAddressBook)
  const hasPreconfiguredAccounts = useConfigStore((state) => state.hasPreconfiguredAccounts)

  // Open state is derived from settings; every dismiss path flips it closed,
  // which the hook detects and animates out before unmounting.
  const isOpen = !(hasCompletedOnboarding || hasPreconfiguredAccounts)
  const noop = useCallback(() => {}, [])
  const { rendered, closing } = useAnimatedClose(isOpen, noop, 200)
  const contentRef = useRef<HTMLDivElement>(null)

  useFocusTrap(contentRef, rendered && !closing)

  // Escape dismisses the onboarding modal — the generic Modal component
  // handles this for itself, but OnboardingModal uses a custom backdrop
  // so it needs its own keydown handler.
  useEffect(() => {
    if (!rendered || closing) return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Update the setting so the closing animation runs; the hook
        // detects the open→close transition and unmounts.
        useSettingsStore.getState().updateSettings({ hasCompletedOnboarding: true })
        if (isNative) {
          void requestNativeReminderPermission()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [rendered, closing])

  if (!rendered) {
    return null
  }

  // Asking here (right after the onboarding copy explaining reminders) rather
  // than on cold app launch gives the system dialog context — Android only
  // lets a denied permission be re-requested programmatically once, so a
  // blank prompt with no explanation risks burning that shot on a reflexive
  // "deny". requestNativeReminderPermission() is a no-op dialog-wise if the
  // user already granted/denied it in a previous session.
  const completeOnboarding = (): void => {
    updateSettings({ hasCompletedOnboarding: true })
    if (isNative) {
      void requestNativeReminderPermission()
    }
  }

  const handleDismiss = (): void => {
    completeOnboarding()
  }

  const handleAddCalendar = (): void => {
    completeOnboarding()
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

      const events = parseICALData(icsData, calendarId)

      // Auto-create missing categories (mirrors useCalDAV.ts auto-creation logic)
      const newCategoryNames: string[] = []
      for (const event of events) {
        if (event.categories) {
          for (const catName of event.categories) {
            const existingCat = categories.find((c) => c.name === catName)
            if (!existingCat && !newCategoryNames.includes(catName)) {
              newCategoryNames.push(catName)
            }
          }
        }
      }

      for (const catName of newCategoryNames) {
        addCategory({
          id: createUuid(),
          name: catName,
          color: EVENT_COLORS[Math.floor(Math.random() * EVENT_COLORS.length)],
        })
      }

      events.forEach((event) => addEvent(event))

      // Enable journal feature if sample data contains journal entries
      const hasJournals = events.some((e) => e.type === 'journal')
      if (hasJournals) {
        const { journalEnabled } = useSettingsStore.getState()
        if (!journalEnabled) {
          updateSettings({ journalEnabled: true })
        }
      }

      // Load sample contacts
      try {
        const vcfResponse = await fetch('/sample-contacts.vcf')
        if (vcfResponse.ok) {
          const vcfData = await vcfResponse.text()
          const vcards = vcfData.split(/(?=BEGIN:VCARD)/).filter(Boolean)

          // Create a sample address book
          const sampleAddressBook = {
            id: 'sample-addressbook',
            accountId: 'sample',
            url: 'sample://addressbook',
            name: 'Sample Contacts',
            ctag: null,
            syncToken: null,
            isVisible: true,
          }
          addAddressBook(sampleAddressBook)

          for (const vcard of vcards) {
            const contact = parseVCard(vcard.trim(), 'sample-addressbook', 'sample')
            if (contact) {
              addContact(contact)
            }
          }

          // Enable contacts feature
          const { contactsEnabled } = useSettingsStore.getState()
          if (!contactsEnabled) {
            updateSettings({ contactsEnabled: true })
          }
        }
      } catch {
        // Sample contacts are optional, ignore errors
      }

      completeOnboarding()
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
    <div
      className={`${styles.modal} ${closing ? styles.closing : ''}`}
      onClick={handleBackdropClick}
    >
      <div
        ref={contentRef}
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <h2 className={styles.title} id="onboarding-title">
          Start with your calendar
        </h2>

        <p className={styles.description}>
          Try Calino with sample events, or connect your own CalDAV account. Your data stays in your
          browser and Calino does not send it to external servers.
        </p>

        <details className={styles.details}>
          <summary>How your data stays safe</summary>
          <p>
            Connect a CalDAV account (iCloud, Nextcloud, FastMail) to sync your calendar to your own
            server. You can also back up and transfer your data using export/import in Settings.
          </p>
        </details>

        {isNative && (
          <p className={`${styles.description} ${styles.secondaryDescription}`}>
            Calino can remind you before events start. Continuing will ask for notification
            permission.
          </p>
        )}

        {!isNative && (
          <p className={`${styles.description} ${styles.secondaryDescription}`}>
            There's also an{' '}
            <a
              href={`https://github.com/${config.githubRepo}/releases`}
              target="_blank"
              rel="noreferrer"
            >
              Android app
            </a>
            , with camera-based event import and reminder notifications.
          </p>
        )}

        {demoError && <p className={styles.errorMessage}>{demoError}</p>}

        <div className={styles.footer}>
          {!__CALINO_SELF_HOSTED__ && (
            <button
              className={styles.demoButton}
              onClick={handleLoadDemoData}
              disabled={isLoadingDemo}
              data-component="demo-button"
            >
              {isLoadingDemo && (
                <svg
                  className={styles.demoButtonSpinner}
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  data-component="demo-spinner"
                >
                  <circle
                    cx="7"
                    cy="7"
                    r="5.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray="20 12"
                  />
                </svg>
              )}
              {isLoadingDemo ? 'Loading…' : 'Try with sample data'}
            </button>
          )}
          <button className={styles.addButton} onClick={handleAddCalendar}>
            Add CalDAV Account
          </button>
          <button className={styles.skipButton} onClick={handleDismiss}>
            I'll do it later
          </button>
        </div>
      </div>
    </div>
  )
}
