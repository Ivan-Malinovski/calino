import type { JSX } from 'react'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import type { RecurrenceRule, Reminder, CalendarEvent, CalendarAttachment } from '@/types'
import { useSettingsStore } from '@/store/settingsStore'
import { useScrollInput } from '@/hooks/useScrollInput'
import { pad2 } from '@/lib/datetime'
import { AttachmentSection } from './AttachmentSection'
import { TimeInput } from './TimeInput'
import { getWeekdayLabels } from './weekdayLabels'
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

const RECURRENCE_OPTIONS: { value: RecurrenceRule['frequency']; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

type MonthlyPattern = 'dayOfMonth' | 'nthWeekday' | 'lastWeekday'

function detectMonthlyPattern(byWeekday: number[] | undefined, byDayOrdinals: number[] | undefined): MonthlyPattern {
  if (byWeekday && byWeekday.length > 0) {
    if (byDayOrdinals && byDayOrdinals.length === byWeekday.length && byDayOrdinals.every((p) => p === -1)) {
      return 'lastWeekday'
    }
    return 'nthWeekday'
  }
  return 'dayOfMonth'
}

function defaultNthWeekday(startDate: string): { byWeekday: number[]; byDayOrdinals: number[] } {
  const [yStr, mStr, dStr] = startDate.split('-').map((s) => parseInt(s, 10))
  if (!yStr || !mStr || !dStr) return { byWeekday: [1], byDayOrdinals: [1] }
  const startWeekday = new Date(Date.UTC(yStr, mStr - 1, dStr)).getUTCDay()
  const nth = Math.ceil(dStr / 7)
  return { byWeekday: [startWeekday], byDayOrdinals: [nth] }
}

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
  const weekdayLabels = getWeekdayLabels(firstDayOfWeek)

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

  const handleWeekdayToggle = (displayIndex: number): void => {
    if (!onByWeekdayChange) return
    const actualWeekday = (displayIndex + firstDayOfWeek) % 7
    const newByWeekday = byWeekday.includes(actualWeekday)
      ? byWeekday.filter((d: number) => d !== actualWeekday)
      : [...byWeekday, actualWeekday].sort((a, b) => a - b)
    onByWeekdayChange(newByWeekday)
  }

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
                onStartDateChange(newDate)
                if (newDate > endDate) {
                  onEndDateChange(newDate)
                }
              }}
              className={styles.input}
              data-component="event-start-date"
              required
            />
            {!isAllDay && (
              <TimeInput
                value={startTime}
                timeFormat={timeFormat}
                onChange={(newStart) => {
                  onStartTimeChange(newStart)
                  if (startDate === endDate && newStart >= endTime) {
                    // Add 1 hour to the new start time
                    const [h, m] = newStart.split(':').map(Number)
                    const endHour = (h + 1) % 24
                    onEndTimeChange(`${pad2(endHour)}:${pad2(m)}`)
                  }
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
              <TimeInput
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

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => handleRecurringToggle(e.target.checked)}
          />
          <span>Recurring</span>
        </label>

        <button
          type="button"
          className={styles.chevronButton}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <svg aria-hidden="true"
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
          {recurring && (
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recurrence-select">
                  Repeat
                </label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <select
                    id="recurrence-select"
                    value={recurrence}
                    onChange={(e) =>
                      onRecurrenceChange(e.target.value as RecurrenceRule['frequency'])
                    }
                    className={styles.select}
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>every</span>
                  <input
                    id="interval-input"
                    type="number"
                    min={1}
                    max={99}
                    value={interval}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      onIntervalChange(isNaN(n) || n < 1 ? 1 : Math.min(n, 99))
                    }}
                    className={styles.input}
                    style={{ width: '60px' }}
                    aria-label="Repeat interval"
                  />
                  <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {recurrence === 'daily' ? (interval === 1 ? 'day' : 'days')
                      : recurrence === 'weekly' ? (interval === 1 ? 'week' : 'weeks')
                      : recurrence === 'monthly' ? (interval === 1 ? 'month' : 'months')
                      : (interval === 1 ? 'year' : 'years')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {recurring && recurrence === 'weekly' && onByWeekdayChange && (
            <div className={styles.weekdayField}>
              <label className={styles.label} style={{ fontWeight: 600 }}>
                On days:
              </label>
              <div className={styles.weekdayRow}>
                {weekdayLabels.map((label, displayIndex) => {
                  const actualWeekday = (displayIndex + firstDayOfWeek) % 7
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`${styles.weekdayBtn} ${byWeekday.includes(actualWeekday) ? styles.excluded : ''}`}
                      onClick={() => handleWeekdayToggle(displayIndex)}
                      aria-pressed={byWeekday.includes(actualWeekday)}
                      aria-label={`Include ${label}`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {recurring && recurrence === 'monthly' && onByMonthDayChange && onByWeekdayChange && onByDayOrdinalsChange && (
            <div className={styles.field}>
              <label className={styles.label} style={{ fontWeight: 600 }}>Monthly pattern</label>
              <MonthlyPatternPicker
                startDate={startDate}
                weekdayLabels={weekdayLabels}
                firstDayOfWeek={firstDayOfWeek}
                byMonthDay={byMonthDay}
                byWeekday={byWeekday}
                byDayOrdinals={byDayOrdinals}
                onByMonthDayChange={onByMonthDayChange}
                onByWeekdayChange={onByWeekdayChange}
                onByDayOrdinalsChange={onByDayOrdinalsChange}
              />
            </div>
          )}

          {recurring && recurrence === 'yearly' && onByMonthChange && (
            <div className={styles.field}>
              <label className={styles.label} style={{ fontWeight: 600 }}>In months</label>
              <YearlyMonthPicker byMonth={byMonth} onByMonthChange={onByMonthChange} />
            </div>
          )}

          {recurring && (
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="end-condition-select">
                  Ends
                </label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    id="end-condition-select"
                    value={endCondition}
                    onChange={(e) =>
                      onEndConditionChange(e.target.value as 'never' | 'on' | 'after')
                    }
                    className={styles.select}
                  >
                    <option value="never">Never</option>
                    <option value="on">On date</option>
                    <option value="after">After occurrences</option>
                  </select>
                  {endCondition === 'on' && (
                    <input
                      type="date"
                      value={endOnDate}
                      onChange={(e) => onEndOnDateChange(e.target.value)}
                      className={styles.input}
                      style={{ width: '160px' }}
                      aria-label="End date"
                    />
                  )}
                  {endCondition === 'after' && (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={endAfterCount}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10)
                          onEndAfterCountChange(isNaN(n) || n < 1 ? 1 : Math.min(n, 999))
                        }}
                        className={styles.input}
                        style={{ width: '70px' }}
                        aria-label="Number of occurrences"
                      />
                      <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                        occurrence{endAfterCount === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

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
                    {REMINDER_OPTIONS.find((o) => o.value === reminder.minutesBefore)?.label ?? `${reminder.minutesBefore} min`}
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
                        ) && (
                          <div className={styles.reminderDropdownEmpty}>All options added</div>
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

interface MonthlyPatternPickerProps {
  startDate: string
  weekdayLabels: string[]
  firstDayOfWeek: number
  byMonthDay: number[]
  byWeekday: number[]
  byDayOrdinals: number[]
  onByMonthDayChange: (days: number[]) => void
  onByWeekdayChange: (days: number[]) => void
  onByDayOrdinalsChange: (positions: number[]) => void
}

function MonthlyPatternPicker({
  startDate,
  weekdayLabels,
  firstDayOfWeek,
  byMonthDay,
  byWeekday,
  byDayOrdinals,
  onByMonthDayChange,
  onByWeekdayChange,
  onByDayOrdinalsChange,
}: MonthlyPatternPickerProps): JSX.Element {
  const pattern = detectMonthlyPattern(byWeekday, byDayOrdinals)
  const startDay = parseInt(startDate.split('-')[2] || '1', 10)
  const startMonth = parseInt(startDate.split('-')[1] || '1', 10)
  const startYear = parseInt(startDate.split('-')[0] || '2025', 10)
  const startWeekday = new Date(Date.UTC(startYear, startMonth - 1, startDay)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(startYear, startMonth, 0)).getUTCDate()

  const nthFromByWeekday = byWeekday[0] !== undefined ? byWeekday[0] : startWeekday
  const posFromByDayOrdinals = byDayOrdinals[0] !== undefined ? byDayOrdinals[0] : Math.ceil(startDay / 7)
  const dayFromByMonthDay = byMonthDay[0] !== undefined ? byMonthDay[0] : startDay

  const days31 = Array.from({ length: 31 }, (_, i) => i + 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <select
        value={pattern}
        onChange={(e) => {
          const next = e.target.value as MonthlyPattern
          if (next === 'dayOfMonth') {
            onByMonthDayChange([dayFromByMonthDay])
            onByWeekdayChange([])
            onByDayOrdinalsChange([])
          } else if (next === 'nthWeekday') {
            const inferred = defaultNthWeekday(startDate)
            onByWeekdayChange([inferred.byWeekday[0]!])
            onByDayOrdinalsChange([inferred.byDayOrdinals[0]!])
            onByMonthDayChange([])
          } else {
            const wk = nthFromByWeekday
            onByWeekdayChange([wk])
            onByDayOrdinalsChange([-1])
            onByMonthDayChange([])
          }
        }}
        aria-label="Monthly pattern"
        className={styles.select}
        style={{ maxWidth: '220px' }}
      >
        <option value="dayOfMonth">On day of the month</option>
        <option value="nthWeekday">On the nth weekday</option>
        <option value="lastWeekday">On the last weekday</option>
      </select>

      {pattern === 'dayOfMonth' && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span>Day</span>
          <select
            value={dayFromByMonthDay}
            onChange={(e) => onByMonthDayChange([parseInt(e.target.value, 10)])}
            className={styles.select}
            style={{ width: '90px' }}
          >
            {days31.map((d) => (
              <option key={d} value={d}>
                {d}{d === daysInMonth ? ' (last day)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {(pattern === 'nthWeekday' || pattern === 'lastWeekday') && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {pattern === 'nthWeekday' && (
            <select
              value={posFromByDayOrdinals}
              onChange={(e) => onByDayOrdinalsChange([parseInt(e.target.value, 10)])}
              aria-label="Nth weekday of the month"
              className={styles.select}
              style={{ width: '110px' }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'First' : n === 2 ? 'Second' : n === 3 ? 'Third' : n === 4 ? 'Fourth' : 'Fifth'}
                </option>
              ))}
            </select>
          )}
          <select
            value={nthFromByWeekday}
            onChange={(e) => onByWeekdayChange([parseInt(e.target.value, 10)])}
            aria-label="Weekday"
            className={styles.select}
            style={{ width: '120px' }}
          >
            {Array.from({ length: 7 }, (_, i) => i).map((d) => {
              const actualWeekday = (d + firstDayOfWeek) % 7
              return (
                <option key={actualWeekday} value={actualWeekday}>{weekdayLabels[d]}</option>
              )
            })}
          </select>
          {pattern === 'lastWeekday' && <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>of the month</span>}
        </div>
      )}
    </div>
  )
}

interface YearlyMonthPickerProps {
  byMonth: number[]
  onByMonthChange: (months: number[]) => void
}

function YearlyMonthPicker({ byMonth, onByMonthChange }: YearlyMonthPickerProps): JSX.Element {
  const toggle = (m: number): void => {
    if (byMonth.includes(m)) {
      onByMonthChange(byMonth.filter((x) => x !== m))
    } else {
      onByMonthChange([...byMonth, m].sort((a, b) => a - b))
    }
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {MONTH_SHORT.map((label, idx) => {
        const m = idx + 1
        const selected = byMonth.length === 0 || byMonth.includes(m)
        return (
          <button
            key={m}
            type="button"
            onClick={() => toggle(m)}
            aria-pressed={byMonth.length === 0 ? true : selected}
            className={`${styles.weekdayBtn} ${selected ? styles.excluded : ''}`}
            style={{ minWidth: '52px' }}
          >
            {label}
          </button>
        )
      })}
      {byMonth.length > 0 && (
        <button
          type="button"
          onClick={() => onByMonthChange([])}
          className={styles.weekdayBtn}
          style={{ minWidth: '52px', fontSize: '11px' }}
          aria-label="Reset months"
        >
          All
        </button>
      )}
    </div>
  )
}
