import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { CalendarAttendee, CalendarOrganizer, AttendeePartstat, CalendarEvent } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useContactStore } from '@/store/contactStore'
import { getAllAccounts, getAllCalendars } from '@/features/caldav/sync/accountStorage'
import {
  collectAttendeeSuggestions,
  contactPeople,
  matchAttendeeSuggestions,
  ownAddressesOf,
  type AttendeeSuggestion,
} from '../lib/attendeeSuggestions'
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
  /** Told whether the field holds typed text not yet added as an attendee. */
  onDraftChange?: (hasDraft: boolean) => void
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
  onDraftChange,
}: AttendeeSectionProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')
  // The suggestion list: open while the field has focus, `active` the option
  // the arrow keys are on (-1: none, Enter adds what is typed).
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [listStyle, setListStyle] = useState<CSSProperties>({})

  // A half-typed address is an unsaved change too: the form around it must
  // not close on an outside click and lose it. A layout effect, so the form
  // knows before the next click lands.
  const hasDraft = inputValue.trim() !== ''
  useLayoutEffect(() => {
    onDraftChange?.(hasDraft)
    return () => onDraftChange?.(false)
  }, [hasDraft, onDraftChange])

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
  const calendars = useCalendarStore((state) => state.calendars)
  const contacts = useContactStore((state) => state.contacts)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  // Everyone met in an event or task, owning a shared calendar, or in the
  // address book, best first. Built only while the list is open, from what the
  // browser already holds: typing never makes a request.
  const organizerEmail = organizer?.email
  const suggestions = useMemo((): AttendeeSuggestion[] => {
    if (!suggestionsOpen) return []
    const ownAddresses = ownAddressesOf(getAllAccounts())
    if (organizerEmail) ownAddresses.push(organizerEmail)
    // Owners are kept with the stored collections; only calendars still in
    // the list count.
    const listed = new Set(calendars.map((calendar) => calendar.id))
    const calendarOwners = getAllCalendars().flatMap((calendar) =>
      calendar.owner && listed.has(calendar.id) ? [calendar.owner] : []
    )
    return collectAttendeeSuggestions({
      events,
      calendarOwners,
      contacts: contactPeople(contacts),
      ownAddresses,
    })
  }, [suggestionsOpen, events, calendars, contacts, organizerEmail])

  const matches = useMemo(
    () =>
      matchAttendeeSuggestions(
        suggestions,
        inputValue,
        attendees.map((attendee) => attendee.email)
      ),
    [suggestions, inputValue, attendees]
  )
  const listShown = suggestionsOpen && matches.length > 0
  const activeOption = listShown && active >= 0 && active < matches.length ? active : -1

  // The list is portaled to the body and placed against the field, as the
  // location suggestions are: inside the form it would be clipped by the
  // scrolling body and drawn under the fields that follow. It opens upwards
  // when the room left above the modal footer is too short.
  const placeList = useCallback((): void => {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const dialog = input.closest('[role="dialog"]')
    const footer = dialog?.querySelector('[data-component="modal-footer"]')
    const floor = Math.min(window.innerHeight, footer?.getBoundingClientRect().top ?? Infinity)
    const gap = 2
    const below = Math.max(0, floor - rect.bottom - gap)
    const above = Math.max(0, rect.top - gap)
    const upwards = below < 80 && above > below
    setListStyle({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(40, Math.min(240, upwards ? above : below)),
      ...(upwards ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    })
  }, [])

  useLayoutEffect(() => {
    if (!listShown) return
    placeList()
    window.addEventListener('resize', placeList)
    document.addEventListener('scroll', placeList, true)
    return () => {
      window.removeEventListener('resize', placeList)
      document.removeEventListener('scroll', placeList, true)
    }
  }, [listShown, placeList])

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
    addAttendee(inputValue)
  }

  const addAttendee = (value: string, name?: string): void => {
    const email = value.trim().toLowerCase()
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
      ...(name ? { name } : {}),
      role: 'REQ-PARTICIPANT',
      partstat: 'NEEDS-ACTION',
      rsvp: true,
    }

    onAttendeesChange([...attendees, newAttendee])
    setInputValue('')
    setInputError('')
    setActive(-1)
  }

  const pick = (suggestion: AttendeeSuggestion): void => {
    addAttendee(suggestion.email, suggestion.name)
  }

  const handleRemove = (email: string): void => {
    onAttendeesChange(attendees.filter((a) => a.email !== email))
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSuggestionsOpen(true)
      setActive((index) => Math.min(index + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((index) => Math.max(index - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = activeOption >= 0 ? matches[activeOption] : undefined
      if (chosen) pick(chosen)
      else handleAdd()
    } else if (e.key === 'Escape' && listShown) {
      // Closes the list only, not the event form around it.
      e.preventDefault()
      e.stopPropagation()
      setSuggestionsOpen(false)
      setActive(-1)
    }
  }

  const handleInputChange = (val: string): void => {
    setInputValue(val)
    setSuggestionsOpen(true)
    setActive(-1)
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
        <div className={styles.addAttendeeField}>
          <input
            ref={inputRef}
            type="email"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listShown}
            aria-controls={listId}
            aria-activedescendant={activeOption >= 0 ? `${listId}-${activeOption}` : undefined}
            autoComplete="off"
            placeholder={t('modals.attendees.addAttendeePlaceholder')}
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => {
              setSuggestionsOpen(false)
              setActive(-1)
            }}
            className={styles.addAttendeeInput}
            aria-label={t('modals.attendees.addAttendeeAria')}
            data-component="attendee-input"
          />
          {listShown &&
            createPortal(
              <ul
                id={listId}
                role="listbox"
                aria-label={t('modals.attendees.suggestionsAria')}
                className={styles.suggestionList}
                style={listStyle}
                data-component="attendee-suggestions"
              >
                {matches.map((suggestion, index) => (
                  <li
                    key={suggestion.email}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeOption}
                    className={`${styles.suggestionOption} ${index === activeOption ? styles.suggestionActive : ''}`}
                    data-component="attendee-suggestion"
                    data-email={suggestion.email}
                    // Keeps the focus in the field, so the click lands before blur.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(suggestion)}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className={styles.attendeeAvatar} aria-hidden="true">
                      {getInitials(suggestion.email, suggestion.name)}
                    </span>
                    <span className={styles.attendeeInfo}>
                      <span className={styles.attendeeName}>
                        {getDisplayName(suggestion.email, suggestion.name)}
                      </span>
                      <span className={styles.attendeeEmail}>{suggestion.email}</span>
                    </span>
                  </li>
                ))}
              </ul>,
              document.body
            )}
        </div>
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
