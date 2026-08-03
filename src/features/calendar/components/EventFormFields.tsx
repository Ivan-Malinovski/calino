import type { JSX } from 'react'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import type { RecurrenceRule, Reminder, CalendarEvent, CalendarAttachment } from '@/types'
import { useSettingsStore } from '@/store/settingsStore'
import { useScrollInput } from '@/hooks/useScrollInput'
import { daysBetween, addDays, addMinutesToTimeStr } from '@/lib/datetime'
import { AttachmentSection } from './AttachmentSection'
import { TimeField } from './TimeField'
import { RecurrenceFields, RecurrenceToggle } from './RecurrenceFields'
import styles from './EventModal.module.css'

interface EventFormFieldsProps {
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
}

const TRAVEL_DURATION_OPTIONS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: 'None' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
]

const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
]

export function EventFormFields({
  isAllDay,
  onIsAllDayChange,
  startDate,
  onStartDateChange,
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
}: EventFormFieldsProps): JSX.Element {
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
      setMoreOpen(true)
    }
    onRecurringChange(next)
  }

  return (
    <>
      <div className={styles.dateTimeRow}>
        <div className={styles.dateTimeGroup}>
          <label className={styles.label}>Start</label>
          <div className={styles.dateTimeInputs}>
            <input
              type="date"
              ref={startDateRef}
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
                  const [sH, sM] = startTime.split(':').map(Number)
                  const [eH, eM] = endTime.split(':').map(Number)
                  const oldDuration = eH * 60 + eM - (sH * 60 + sM)
                  const minutes = oldDuration > 0 ? oldDuration : defaultDuration
                  const newEnd = addMinutesToTimeStr(newStart, minutes)

                  onStartTimeChange(newStart)
                  onEndTimeChange(newEnd)
                }}
                className={styles.input}
                dataComponent="event-start-time"
                ariaLabel="Start time"
              />
            )}
          </div>
        </div>

        <div className={styles.dateTimeGroup}>
          <label className={styles.label}>End</label>
          <div className={styles.dateTimeInputs}>
            <input
              type="date"
              ref={endDateRef}
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
                ariaLabel="End time"
              />
            )}
          </div>
        </div>
      </div>

      <div className={styles.row}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={isAllDay}
            onChange={(e) => onIsAllDayChange(e.target.checked)}
          />
          <span>All day</span>
        </label>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={transparency === 'transparent'}
            onChange={(e) => onTransparencyChange(e.target.checked ? 'transparent' : 'opaque')}
          />
          <span>Available</span>
        </label>

        <RecurrenceToggle recurring={recurring} onRecurringChange={handleRecurringToggle} />

        <button
          type="button"
          className={styles.chevronButton}
          onClick={() => setMoreOpen(!moreOpen)}
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
          <span style={{ fontSize: '12px', marginLeft: '4px' }}>More</span>
        </button>
      </div>

      <div
        className={`${styles.moreOptionsWrapper} ${moreOpen ? styles.moreOptionsOpen : styles.moreOptionsClosed}`}
        aria-hidden={!moreOpen}
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
                Travel time
              </label>
              <select
                id="travel-duration-select"
                value={travelDuration ?? ''}
                onChange={(e) =>
                  onTravelDurationChange(e.target.value ? Number(e.target.value) : undefined)
                }
                className={styles.select}
              >
                {TRAVEL_DURATION_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value ?? ''}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Reminders</label>
              <div className={styles.reminderList}>
                {reminders.map((reminder) => (
                  <span key={reminder.id} className={styles.reminderChip}>
                    {REMINDER_OPTIONS.find((o) => o.value === reminder.minutesBefore)?.label ??
                      `${reminder.minutesBefore} min`}
                    <button
                      type="button"
                      className={styles.reminderChipRemove}
                      aria-label={`Remove ${reminder.minutesBefore} min reminder`}
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
                    aria-label="Add reminder"
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
                    + Add
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
                        {REMINDER_OPTIONS.filter(
                          (opt) => !reminders.some((r) => r.minutesBefore === opt.value)
                        ).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={styles.reminderDropdownItem}
                            role="option"
                            onClick={() => {
                              onRemindersChange([
                                ...reminders,
                                { id: uuidv4(), minutesBefore: option.value, method: 'popup' },
                              ])
                              setReminderDropdownOpen(false)
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                        {REMINDER_OPTIONS.every((opt) =>
                          reminders.some((r) => r.minutesBefore === opt.value)
                        ) && <div className={styles.reminderDropdownEmpty}>All options added</div>}
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
              <div className={styles.categoriesLabel}>Related to</div>
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
        </div>
      </div>
    </>
  )
}
