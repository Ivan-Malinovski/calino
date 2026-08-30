import type { JSX } from 'react'
import { useId, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createUuid } from '@/lib/uuid'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  RecurrenceRule,
  Reminder,
  CalendarEvent,
  CalendarAttachment,
  CalendarAttendee,
  CalendarOrganizer,
} from '@/types'
import { useSettingsStore } from '@/store/settingsStore'
import { useScrollInput } from '@/hooks/useScrollInput'
import { daysBetween, addDays, deviceTimezone, getDateFnsLocale } from '@/lib/datetime'
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { AttachmentSection } from './AttachmentSection'
import { AttendeeSection } from './AttendeeSection'
import { TimeField } from './TimeField'
import { RecurrenceFields, RecurrenceToggle } from './RecurrenceFields'
import styles from './EventModal.module.css'

/**
 * The event's own times, for a series anchored in a zone other than the
 * device's. The form's fields are device-local, so this is the same moment
 * read on the event's clock — what actually moves when the fields change.
 * Returns null when there is nothing to disambiguate.
 */
function foreignZoneTimes(
  eventTimezone: string | undefined,
  isAllDay: boolean,
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
  timeFormat: '12h' | '24h'
): { zoneLabel: string; times: string } | null {
  if (!eventTimezone || isAllDay) return null
  if (eventTimezone === deviceTimezone()) return null

  const startInstant = new Date(`${startDate}T${startTime}:00`)
  const endInstant = new Date(`${endDate}T${endTime}:00`)
  if (Number.isNaN(startInstant.getTime()) || Number.isNaN(endInstant.getTime())) return null

  const pattern = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
  let start: string
  let end: string
  try {
    start = formatInTimeZone(startInstant, eventTimezone, pattern)
    end = formatInTimeZone(endInstant, eventTimezone, pattern)
    // A late or early event can sit on a different calendar day over there, so
    // name the day when it differs — otherwise the times alone would mislead.
    const startDay = formatInTimeZone(startInstant, eventTimezone, 'yyyy-MM-dd')
    if (startDay !== startDate) {
      start = `${formatInTimeZone(startInstant, eventTimezone, 'MMM d', { locale: getDateFnsLocale() })}, ${start}`
    }
  } catch {
    // Unknown zone: better to show nothing than a wrong time.
    return null
  }

  return {
    // 'America/Los_Angeles' reads as 'Los Angeles'; the region prefix is noise
    // once the city is there.
    zoneLabel: (eventTimezone.split('/').pop() ?? eventTimezone).replace(/_/g, ' '),
    times: `${start}\u2013${end}`,
  }
}

interface EventFormFieldsProps {
  /**
   * The event's own TZID, when it has one. The date/time fields always work in
   * the device zone, so a foreign TZID is otherwise invisible: editing a 09:00
   * Los Angeles meeting from Copenhagen shows 18:00 with nothing saying what
   * is actually being moved. Shown as a read-only line under the fields.
   */
  eventTimezone?: string
  isAllDay: boolean
  onIsAllDayChange: (checked: boolean) => void
  startDate: string
  onStartDateChange: (date: string) => void
  startTime: string
  onStartTimeChange: (time: string) => void
  endDate: string
  onEndDateChange: (date: string) => void
  endTime: string
  onEndTimeChange: (time: string) => void
  recurring: boolean
  onRecurringChange: (recurring: boolean) => void
  recurrence: RecurrenceRule['frequency']
  onRecurrenceChange: (recurrence: RecurrenceRule['frequency']) => void
  interval: number
  onIntervalChange: (interval: number) => void
  byWeekday?: number[]
  onByWeekdayChange?: (days: number[]) => void
  byMonthDay?: number[]
  onByMonthDayChange?: (days: number[]) => void
  byMonth?: number[]
  onByMonthChange?: (months: number[]) => void
  byDayOrdinals?: number[]
  onByDayOrdinalsChange?: (positions: number[]) => void
  endCondition: 'never' | 'on' | 'after'
  onEndConditionChange: (cond: 'never' | 'on' | 'after') => void
  endOnDate: string
  onEndOnDateChange: (date: string) => void
  endAfterCount: number
  onEndAfterCountChange: (count: number) => void
  travelDuration: number | undefined
  onTravelDurationChange: (duration: number | undefined) => void
  reminders: Reminder[]
  onRemindersChange: (reminders: Reminder[]) => void
  transparency?: 'opaque' | 'transparent'
  onTransparencyChange: (transparency: 'opaque' | 'transparent') => void
  relatedTo: string[]
  onRelatedToChange: (ids: string[]) => void
  candidateEvents: CalendarEvent[]
  attachments: CalendarAttachment[]
  onAttachmentsChange: (attachments: CalendarAttachment[]) => void
  attachmentEventId: string | null
  attendees: CalendarAttendee[]
  onAttendeesChange: (attendees: CalendarAttendee[]) => void
  organizer: CalendarOrganizer | undefined
  editingEvent?: CalendarEvent
  /** Event window the availability check is run against. */
  startIso: string
  endIso: string
  /** Excluded from the availability scan so an event never clashes with itself. */
  excludeEventId?: string
}

const TRAVEL_DURATION_VALUES: (number | undefined)[] = [
  undefined,
  5,
  10,
  15,
  20,
  30,
  45,
  60,
  90,
  120,
]

const REMINDER_VALUES: number[] = [0, 5, 10, 15, 30, 60, 120, 1440]

/** Renders a travel-duration select option's label, e.g. "45 min" / "1.5 hours". */
function travelDurationLabel(value: number | undefined, t: TFunction): string {
  if (value === undefined) return t('modals.eventForm.travelDuration.none')
  if (value === 90) return t('modals.eventForm.travelDuration.oneAndHalfHours')
  if (value % 60 === 0) return t('modals.eventForm.hoursShort', { count: value / 60 })
  return t('modals.eventForm.minutesShort', { count: value })
}

/** Renders a reminder option's label, e.g. "10 minutes before" / "1 day before". */
function reminderLabel(value: number, t: TFunction): string {
  if (value === 0) return t('modals.eventForm.reminder.atTimeOfEvent')
  if (value % 1440 === 0) return t('modals.eventForm.reminder.daysBefore', { count: value / 1440 })
  if (value % 60 === 0) return t('modals.eventForm.reminder.hoursBefore', { count: value / 60 })
  return t('modals.eventForm.reminder.minutesBefore', { count: value })
}

export function EventFormFields({
  isAllDay,
  onIsAllDayChange,
  startDate,
  onStartDateChange,
  eventTimezone,
  startTime,
  onStartTimeChange,
  endDate,
  onEndDateChange,
  endTime,
  onEndTimeChange,
  recurring,
  onRecurringChange,
  recurrence,
  onRecurrenceChange,
  interval,
  onIntervalChange,
  byWeekday = [],
  onByWeekdayChange,
  byMonthDay = [],
  onByMonthDayChange,
  byMonth = [],
  onByMonthChange,
  byDayOrdinals = [],
  onByDayOrdinalsChange,
  endCondition,
  onEndConditionChange,
  endOnDate,
  onEndOnDateChange,
  endAfterCount,
  onEndAfterCountChange,
  travelDuration,
  onTravelDurationChange,
  reminders,
  onRemindersChange,
  transparency = 'opaque',
  onTransparencyChange,
  relatedTo,
  onRelatedToChange,
  candidateEvents,
  attachments,
  onAttachmentsChange,
  attachmentEventId,
  attendees,
  onAttendeesChange,
  organizer,
  editingEvent,
  startIso,
  endIso,
  excludeEventId,
}: EventFormFieldsProps): JSX.Element {
  const { t } = useTranslation('calendar')
  // Instance-scoped ids for the label↔input pairs: hard-coded ids would
  // collide if two forms ever mounted side by side (same pattern as
  // RecurrenceDialog/DeleteDialog).
  const startDateId = useId()
  const endDateId = useId()
  const advancedOptionsId = useId()
  const [moreOpen, setMoreOpen] = useState(false)
  const [reminderDropdownOpen, setReminderDropdownOpen] = useState(false)
  const [reminderMenuPos, setReminderMenuPos] = useState({ top: 0, left: 0 })
  const reminderAddBtnRef = useRef<HTMLButtonElement>(null)
  const reminderMenuRef = useRef<HTMLDivElement>(null)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const defaultDuration = useSettingsStore((state) => state.defaultDuration)

  const startDateRef = useRef<HTMLInputElement>(null)
  const endDateRef = useRef<HTMLInputElement>(null)
  useScrollInput([startDateRef, endDateRef])

  const setAdvancedOpen = (open: boolean): void => {
    setMoreOpen(open)
  }

  // Close reminder dropdown on outside click. The menu is portaled to
  // document.body, so it's outside the button's subtree — check both.
  useEffect(() => {
    if (!reminderDropdownOpen) return
    const handleClick = (e: MouseEvent): void => {
      const target = e.target as Node
      if (
        !reminderAddBtnRef.current?.contains(target) &&
        !reminderMenuRef.current?.contains(target)
      ) {
        setReminderDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [reminderDropdownOpen])

  // When the user toggles the Recurring checkbox on, also open the
  // "More" panel so the recurrence controls are visible. This is a
  // pure user-action handler — it never fires on initial mount or
  // when the form receives new props from the parent.
  const handleRecurringToggle = (next: boolean): void => {
    if (next && !recurring) {
      setAdvancedOpen(true)
    }
    onRecurringChange(next)
  }

  return (
    <>
      <div className={styles.dateTimeRow}>
        <div className={styles.dateTimeGroup}>
          <label className={styles.label} htmlFor={startDateId}>
            {t('modals.eventForm.start')}
          </label>
          <div className={styles.dateTimeInputs}>
            <input
              type="date"
              ref={startDateRef}
              id={startDateId}
              value={startDate}
              onChange={(e) => {
                const newDate = e.target.value
                if (!newDate) return
                // Shift the end date by the same number of days the start date
                // moved, so the event's span (and therefore start<=end) is
                // preserved. A plain "clamp end to start if start>end" (the old
                // behavior) only fixed same-day overlaps: for a multi-day event
                // (e.g. start 07-13 23:00 → end 07-14 01:00), moving the start
                // date forward by a day left the end date unchanged, producing
                // start(07-14 23:00) > end(07-14 01:00) — an invalid range.
                const dayDelta = daysBetween(startDate, newDate)
                onStartDateChange(newDate)
                onEndDateChange(addDays(endDate, dayDelta))
              }}
              className={styles.input}
              data-component="event-start-date"
              required
            />
            {!isAllDay && (
              <TimeField
                value={startTime}
                timeFormat={timeFormat}
                onChange={(newStart) => {
                  // No-op when the value didn't change (controlled inputs sometimes fire
                  // onChange with identical values during format round-trips).
                  if (newStart === startTime) return

                  // Issue #60: shift end time by the same delta so the event's duration is
                  // preserved. Compute the existing duration from (endTime - startTime) and
                  // apply it to the new start. Fall back to defaultDuration from settings
                  // when the duration is non-positive (corrupt state) so we always emit a
                  // sane end.
                  const oldStart = new Date(`${startDate}T${startTime}:00`)
                  const oldEnd = new Date(`${endDate}T${endTime}:00`)
                  const oldDuration = (oldEnd.getTime() - oldStart.getTime()) / 60000
                  const minutes = oldDuration > 0 ? oldDuration : defaultDuration
                  const newEndInstant = new Date(`${startDate}T${newStart}:00`)
                  newEndInstant.setTime(newEndInstant.getTime() + minutes * 60000)

                  onStartTimeChange(newStart)
                  onEndDateChange(format(newEndInstant, 'yyyy-MM-dd'))
                  onEndTimeChange(format(newEndInstant, 'HH:mm'))
                }}
                className={styles.input}
                dataComponent="event-start-time"
                ariaLabel={t('modals.eventForm.startTime')}
              />
            )}
          </div>
        </div>

        <div className={styles.dateTimeGroup}>
          <label className={styles.label} htmlFor={endDateId}>
            {t('modals.eventForm.end')}
          </label>
          <div className={styles.dateTimeInputs}>
            <input
              type="date"
              ref={endDateRef}
              id={endDateId}
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className={styles.input}
              data-component="event-end-date"
              required
            />
            {!isAllDay && (
              <TimeField
                value={endTime}
                timeFormat={timeFormat}
                onChange={onEndTimeChange}
                className={styles.input}
                dataComponent="event-end-time"
                ariaLabel={t('modals.eventForm.endTime')}
              />
            )}
          </div>
        </div>
      </div>

      {(() => {
        const foreign = foreignZoneTimes(
          eventTimezone,
          isAllDay,
          startDate,
          startTime,
          endDate,
          endTime,
          timeFormat
        )
        if (!foreign) return null
        return (
          <div className={styles.foreignZoneNote} data-component="event-foreign-zone">
            {t('modals.eventForm.foreignZoneTimes', { times: foreign.times, zone: foreign.zoneLabel })}
          </div>
        )
      })()}

      <div className={styles.row}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={isAllDay}
            onChange={(e) => onIsAllDayChange(e.target.checked)}
          />
          <span>{t('modals.eventForm.allDay')}</span>
        </label>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={transparency === 'transparent'}
            onChange={(e) => onTransparencyChange(e.target.checked ? 'transparent' : 'opaque')}
          />
          <span>{t('modals.eventForm.available')}</span>
        </label>

        <RecurrenceToggle recurring={recurring} onRecurringChange={handleRecurringToggle} />

        <button
          type="button"
          className={styles.chevronButton}
          onClick={() => setAdvancedOpen(!moreOpen)}
          aria-expanded={moreOpen}
          aria-controls={advancedOptionsId}
          aria-label={
            attendees.length > 0
              ? t(
                  moreOpen
                    ? 'modals.eventForm.hideMoreOptionsWithGuests'
                    : 'modals.eventForm.showMoreOptionsWithGuests',
                  { count: attendees.length }
                )
              : t(moreOpen ? 'modals.eventForm.hideMoreOptions' : 'modals.eventForm.showMoreOptions')
          }
          data-component="event-advanced-toggle"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transform: moreOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span style={{ fontSize: '12px', marginLeft: '4px' }}>{t('modals.eventForm.more')}</span>
        </button>
      </div>

      <div
        id={advancedOptionsId}
        className={`${styles.moreOptionsWrapper} ${moreOpen ? styles.moreOptionsOpen : styles.moreOptionsClosed}`}
        aria-hidden={!moreOpen}
        inert={!moreOpen}
        data-component="event-advanced-options"
      >
        <div className={styles.moreOptionsSection}>
          <RecurrenceFields
            recurring={recurring}
            recurrence={recurrence}
            onRecurrenceChange={onRecurrenceChange}
            interval={interval}
            onIntervalChange={onIntervalChange}
            startDate={startDate}
            byWeekday={byWeekday}
            onByWeekdayChange={onByWeekdayChange}
            byMonthDay={byMonthDay}
            onByMonthDayChange={onByMonthDayChange}
            byMonth={byMonth}
            onByMonthChange={onByMonthChange}
            byDayOrdinals={byDayOrdinals}
            onByDayOrdinalsChange={onByDayOrdinalsChange}
            endCondition={endCondition}
            onEndConditionChange={onEndConditionChange}
            endOnDate={endOnDate}
            onEndOnDateChange={onEndOnDateChange}
            endAfterCount={endAfterCount}
            onEndAfterCountChange={onEndAfterCountChange}
            firstDayOfWeek={firstDayOfWeek}
          />

          <div className={`${styles.row} ${recurring && moreOpen ? styles.divider : ''}`}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="travel-duration-select">
                {t('modals.eventForm.travelTime')}
              </label>
              <select
                id="travel-duration-select"
                value={travelDuration ?? ''}
                onChange={(e) =>
                  onTravelDurationChange(e.target.value ? Number(e.target.value) : undefined)
                }
                className={styles.select}
              >
                {TRAVEL_DURATION_VALUES.map((value) => (
                  <option key={value ?? 'none'} value={value ?? ''}>
                    {travelDurationLabel(value, t)}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>{t('modals.eventForm.reminders')}</label>
              <div className={styles.reminderList}>
                {reminders.map((reminder) => (
                  <span key={reminder.id} className={styles.reminderChip}>
                    {reminderLabel(reminder.minutesBefore, t)}
                    <button
                      type="button"
                      className={styles.reminderChipRemove}
                      aria-label={t('modals.eventForm.removeReminder', {
                        label: reminderLabel(reminder.minutesBefore, t),
                      })}
                      onClick={() => {
                        onRemindersChange(reminders.filter((r) => r.id !== reminder.id))
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className={styles.reminderAddWrapper}>
                  <button
                    ref={reminderAddBtnRef}
                    type="button"
                    className={styles.reminderAddBtn}
                    aria-label={t('modals.eventForm.addReminder')}
                    onClick={() => {
                      setReminderDropdownOpen((o) => {
                        if (!o && reminderAddBtnRef.current) {
                          const rect = reminderAddBtnRef.current.getBoundingClientRect()
                          setReminderMenuPos({ top: rect.bottom + 4, left: rect.left })
                        }
                        return !o
                      })
                    }}
                  >
                    {t('modals.eventForm.addShort')}
                  </button>
                  {reminderDropdownOpen &&
                    createPortal(
                      <div
                        ref={reminderMenuRef}
                        className={styles.reminderDropdown}
                        role="listbox"
                        style={{
                          position: 'fixed',
                          top: reminderMenuPos.top,
                          left: reminderMenuPos.left,
                        }}
                      >
                        {REMINDER_VALUES.filter(
                          (value) => !reminders.some((r) => r.minutesBefore === value)
                        ).map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={styles.reminderDropdownItem}
                            role="option"
                            onClick={() => {
                              onRemindersChange([
                                ...reminders,
                                { id: createUuid(), minutesBefore: value, method: 'popup' },
                              ])
                              setReminderDropdownOpen(false)
                            }}
                          >
                            {reminderLabel(value, t)}
                          </button>
                        ))}
                        {REMINDER_VALUES.every((value) =>
                          reminders.some((r) => r.minutesBefore === value)
                        ) && (
                          <div className={styles.reminderDropdownEmpty}>
                            {t('modals.eventForm.allOptionsAdded')}
                          </div>
                        )}
                      </div>,
                      document.body
                    )}
                </div>
              </div>
            </div>
          </div>

          {/* Related to */}
          {candidateEvents.length > 0 && (
            <div className={styles.categoriesContainer}>
              <div className={styles.categoriesLabel}>{t('modals.eventForm.relatedTo')}</div>
              <div className={styles.categoriesList}>
                {candidateEvents.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className={`${styles.categoryChip} ${
                      relatedTo.includes(ev.id) ? styles.categoryChipSelected : ''
                    }`}
                    onClick={() => {
                      if (relatedTo.includes(ev.id)) {
                        onRelatedToChange(relatedTo.filter((id) => id !== ev.id))
                      } else {
                        onRelatedToChange([...relatedTo, ev.id])
                      }
                    }}
                  >
                    {ev.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <AttachmentSection
            attachments={attachments}
            onAttachmentsChange={onAttachmentsChange}
            eventId={attachmentEventId}
            compact
            showLabel={false}
          />

          <AttendeeSection
            attendees={attendees}
            onAttendeesChange={onAttendeesChange}
            organizer={organizer}
            event={editingEvent}
            startIso={startIso}
            endIso={endIso}
            excludeEventId={excludeEventId}
          />
        </div>
      </div>
    </>
  )
}
