import { useMemo, useState, type JSX } from 'react'
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

const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: 'Free',
  busy: 'Busy',
  unknown: 'Unknown',
}

const AVAILABILITY_CLASSES: Record<Availability, string> = {
  available: styles.availabilityAvailable,
  busy: styles.availabilityBusy,
  unknown: styles.availabilityUnknown,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PARTSTAT_LABELS: Record<AttendeePartstat, string> = {
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  TENTATIVE: 'Tentative',
  'NEEDS-ACTION': 'Pending',
  DELEGATED: 'Delegated',
}

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
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')

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
      showToast('Description shortened to fit your mail client')
    }
    window.location.href = mailto.uri
  }

  const handleAdd = (): void => {
    const email = inputValue.trim().toLowerCase()
    if (!email) return

    if (!EMAIL_RE.test(email)) {
      setInputError('Invalid email address')
      return
    }

    if (attendees.some((a) => a.email.toLowerCase() === email)) {
      setInputError('Already added')
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
        <div className={styles.sectionLabel}>Attendees</div>
        {mailto && (
          <button
            type="button"
            className={styles.emailButton}
            onClick={handleEmailAttendees}
            data-component="email-attendees-btn"
            data-mailto={mailto.uri}
          >
            Email attendees
          </button>
        )}
      </div>

      {organizer && (
        <div className={styles.organizerBadge}>
          <span className={styles.organizerLabel}>Organizer</span>
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
                  aria-label={`${att.name || att.email}: ${AVAILABILITY_LABELS[availability.get(att.email)!]} at this time`}
                >
                  <span className={styles.availabilityDot} aria-hidden="true" />
                  {AVAILABILITY_LABELS[availability.get(att.email)!]}
                </span>
              )}
              {att.partstat && (
                <span
                  className={`${styles.partstatBadge} ${PARTSTAT_CLASSES[att.partstat]}`}
                  data-testid={`partstat-${att.partstat}`}
                >
                  {PARTSTAT_LABELS[att.partstat]}
                </span>
              )}
              <button
                type="button"
                className={styles.removeAttendeeButton}
                onClick={() => handleRemove(att.email)}
                aria-label={`Remove ${att.name || att.email}`}
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
          placeholder="Add attendee email..."
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className={styles.addAttendeeInput}
          aria-label="Add attendee email"
        />
        <button
          type="button"
          className={styles.addAttendeeButton}
          onClick={handleAdd}
          disabled={!inputValue.trim()}
        >
          Add
        </button>
      </div>
      {inputError && (
        <div style={{ color: 'var(--color-error)', fontSize: '12px', marginTop: '4px' }}>
          {inputError}
        </div>
      )}

      {conflictCount > 0 && (
        <div className={styles.conflictBanner} role="status" data-component="attendee-conflicts">
          {conflictCount === 1
            ? '1 attendee has a scheduling conflict at this time.'
            : `${conflictCount} attendees have scheduling conflicts at this time.`}{' '}
          You can still save.
        </div>
      )}

      {conflictCount > 0 && (
        <div className={styles.privacyNote}>
          Based on events in your own calendars that name this person.
        </div>
      )}
    </div>
  )
}
