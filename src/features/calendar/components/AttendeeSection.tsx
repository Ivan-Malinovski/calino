import { useState, type JSX } from 'react'
import type { CalendarAttendee, CalendarOrganizer, AttendeePartstat } from '@/types'
import styles from './AttendeeSection.module.css'

interface AttendeeSectionProps {
  attendees: CalendarAttendee[]
  onAttendeesChange: (attendees: CalendarAttendee[]) => void
  organizer: CalendarOrganizer | undefined
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
}: AttendeeSectionProps): JSX.Element {
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')

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
      <div className={styles.sectionLabel}>Attendees</div>

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
        <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>{inputError}</div>
      )}
    </div>
  )
}
