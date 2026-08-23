import { useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarAttendee, CalendarOrganizer, AttendeePartstat, CalendarEvent } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { checkAttendeeAvailability, type Availability } from '@/lib/freeBusyCalculator'
import { buildMailtoUri } from '@/lib/mailtoInvite'
import { showToast } from '@/lib/toast'
import styles from './AttendeeSection.module.css'

interface AttendeeSectionProps {
  attendees: CalendarAttendee[]
  onAttendeesChange: (attendees: CalendarAttendee[]) => void
  organizer: CalendarOrganizer | undefined
  /** Window the availability check runs against. Omit to skip the check. */
  startIso?: string
  endIso?: string
  /** Excluded from the local scan so an event never conflicts with itself. */
  excludeEventId?: string
  /** Seeds the mailto: subject/body. Omit while composing a brand-new event. */
  event?: CalendarEvent
}

const AVAILABILITY_CLASSES: Record<Availability, string> = {
  available: styles.availabilityAvailable,
  busy: styles.availabilityBusy,
  unknown: styles.availabilityUnknown,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PARTSTAT_CLASSES: Record<AttendeePartstat, string> = {
  ACCEPTED: styles.partstatAccepted,
  DECLINED: styles.partstatDeclined,
  TENTATIVE: styles.partstatTentative,
  'NEEDS-ACTION': styles.partstatNeedsAction,
  DELEGATED: styles.partstatDelegated,
}

function getInitials(email: string, name?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
      return (parts[0][0] + parts[parts.length - 1]![0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

function getDisplayName(email: string, name?: string): string {
  if (name) return name
  const local = email.split('@')[0] || email
  return local.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function AttendeeSection({
  attendees,
  onAttendeesChange,
  organizer,
  startIso,
  endIso,
  excludeEventId,
  event,
}: AttendeeSectionProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')

  const availabilityLabels: Record<Availability, string> = {
    available: t('modals.attendees.availability.free'),
    busy: t('modals.attendees.availability.busy'),
    unknown: t('modals.attendees.availability.unknown'),
  }

  const partstatLabels: Record<AttendeePartstat, string> = {
    ACCEPTED: t('modals.attendees.partstat.accepted'),
    DECLINED: t('modals.attendees.partstat.declined'),
    TENTATIVE: t('modals.attendees.partstat.tentative'),
    'NEEDS-ACTION': t('modals.attendees.partstat.pending'),
    DELEGATED: t('modals.attendees.partstat.delegated'),
  }

  const events = useCalendarStore((state) => state.events)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  // Local-store availability only. The CalDAV path (RFC 6638 Outbox) is wired
  // in CalDAVClient but not driven from here: it needs a scheduling-capable
  // server sharing a domain with the attendee, which is the rare case, and a
  // per-keystroke network probe is worse than an honest "Unknown".
  const availability = useMemo(() => {
    const result = new Map<string, Availability>()
    if (!startIso || !endIso) return result
    for (const attendee of attendees) {
      result.set(
        attendee.email,
        checkAttendeeAvailability(attendee.email, startIso, endIso, events, null, excludeEventId)
      )
    }
    return result
  }, [attendees, startIso, endIso, events, excludeEventId])

  const conflictCount = [...availability.values()].filter((a) => a === 'busy').length

  const mailto = useMemo(() => {
    if (attendees.length === 0) return null
    const source: CalendarEvent = event ?? {
      id: 'draft',
      calendarId: '',
      title: '',
      start: startIso ?? '',
      end: endIso ?? '',
      isAllDay: false,
    }
    return buildMailtoUri(source, attendees, organizer, {
      use24Hour: timeFormat !== '12h',
      selfEmail: organizer?.email,
    })
  }, [attendees, organizer, event, startIso, endIso, timeFormat])

  const handleEmailAttendees = (): void => {
    if (!mailto) return
    if (mailto.truncated) {
      showToast(t('modals.attendees.descriptionShortened'))
    }
    window.location.href = mailto.uri
  }

  const handleAdd = (): void => {
    const email = inputValue.trim().toLowerCase()
    if (!email) return

    if (!EMAIL_RE.test(email)) {
      setInputError(t('modals.attendees.invalidEmail'))
      return
    }

    if (attendees.some((a) => a.email.toLowerCase() === email)) {
      setInputError(t('modals.attendees.alreadyAdded'))
      return
    }

    const newAttendee: CalendarAttendee = {
      email,
      role: 'REQ-PARTICIPANT',
      partstat: 'NEEDS-ACTION',
      rsvp: true,
    }

    onAttendeesChange([...attendees, newAttendee])
    setInputValue('')
    setInputError('')
  }

  const handleRemove = (email: string): void => {
    onAttendeesChange(attendees.filter((a) => a.email !== email))
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const handleInputChange = (val: string): void => {
    setInputValue(val)
    if (inputError) setInputError('')
  }

  return (
    <div className={styles.attendeeSection}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionLabel}>{t('modals.attendees.sectionLabel')}</div>
        {mailto && (
          <button
            type="button"
            className={styles.emailButton}
            onClick={handleEmailAttendees}
            data-component="email-attendees-btn"
            data-mailto={mailto.uri}
          >
            {t('modals.attendees.emailAttendees')}
          </button>
        )}
      </div>

      {organizer && (
        <div className={styles.organizerBadge}>
          <span className={styles.organizerLabel}>{t('modals.attendees.organizer')}</span>
          <span className={styles.organizerName}>
            {organizer.name || getDisplayName(organizer.email, organizer.name)}
          </span>
          <span className={styles.organizerEmail}>{organizer.email}</span>
        </div>
      )}

      {attendees.length > 0 && (
        <div className={styles.attendeeList}>
          {attendees.map((att) => (
            <div key={att.email} className={styles.attendeeRow}>
              <div className={styles.attendeeAvatar}>{getInitials(att.email, att.name)}</div>
              <div className={styles.attendeeInfo}>
                <span className={styles.attendeeName}>{getDisplayName(att.email, att.name)}</span>
                <span className={styles.attendeeEmail}>{att.email}</span>
              </div>
              {availability.has(att.email) && (
                <span
                  className={`${styles.availabilityBadge} ${AVAILABILITY_CLASSES[availability.get(att.email)!]}`}
                  data-component="attendee-availability"
                  data-availability={availability.get(att.email)}
                  aria-label={t('modals.attendees.availabilityAt', {
                    name: att.name || att.email,
                    status: availabilityLabels[availability.get(att.email)!],
                  })}
                >
                  <span className={styles.availabilityDot} aria-hidden="true" />
                  {availabilityLabels[availability.get(att.email)!]}
                </span>
              )}
              {att.partstat && (
                <span
                  className={`${styles.partstatBadge} ${PARTSTAT_CLASSES[att.partstat]}`}
                  data-testid={`partstat-${att.partstat}`}
                >
                  {partstatLabels[att.partstat]}
                </span>
              )}
              <button
                type="button"
                className={styles.removeAttendeeButton}
                onClick={() => handleRemove(att.email)}
                aria-label={t('modals.attendees.removeAttendee', { name: att.name || att.email })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.addAttendeeRow}>
        <input
          type="email"
          placeholder={t('modals.attendees.addAttendeePlaceholder')}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className={styles.addAttendeeInput}
          aria-label={t('modals.attendees.addAttendeeAria')}
        />
        <button
          type="button"
          className={styles.addAttendeeButton}
          onClick={handleAdd}
          disabled={!inputValue.trim()}
        >
          {t('modals.attendees.add')}
        </button>
      </div>
      {inputError && (
        <div style={{ color: 'var(--color-error)', fontSize: '12px', marginTop: '4px' }}>
          {inputError}
        </div>
      )}

      {conflictCount > 0 && (
        <div className={styles.conflictBanner} role="status" data-component="attendee-conflicts">
          {t('modals.attendees.conflictWarning', { count: conflictCount })}{' '}
          {t('modals.attendees.canStillSave')}
        </div>
      )}

      {conflictCount > 0 && (
        <div className={styles.privacyNote}>{t('modals.attendees.privacyNote')}</div>
      )}
    </div>
  )
}
