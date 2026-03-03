import type { JSX } from 'react'
import type { RecurrenceRule } from '@/types'
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
  recurrence: RecurrenceRule['frequency'] | 'none'
  onRecurrenceChange: (recurrence: RecurrenceRule['frequency'] | 'none') => void
  travelDuration: number | undefined
  onTravelDurationChange: (duration: number | undefined) => void
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

const RECURRENCE_OPTIONS: { value: RecurrenceRule['frequency'] | 'none'; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
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
  recurrence,
  onRecurrenceChange,
  travelDuration,
  onTravelDurationChange,
}: EventFormFieldsProps): JSX.Element {
  return (
    <>
      <div className={styles.field}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={isAllDay}
            onChange={(e) => onIsAllDayChange(e.target.checked)}
          />
          <span>All day</span>
        </label>
      </div>

      <div className={styles.dateTimeRow}>
        <div className={styles.dateTimeGroup}>
          <label className={styles.label}>Start</label>
          <div className={styles.dateTimeInputs}>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                onStartDateChange(e.target.value)
                if (endDate && e.target.value > endDate) {
                  onEndDateChange(e.target.value)
                }
              }}
              className={styles.input}
              required
            />
            {!isAllDay && (
              <input
                type="time"
                value={startTime}
                onChange={(e) => {
                  onStartTimeChange(e.target.value)
                  if (startDate === endDate && e.target.value > endTime) {
                    onEndTimeChange(e.target.value)
                  }
                }}
                className={styles.input}
                required
              />
            )}
          </div>
        </div>

        <div className={styles.dateTimeGroup}>
          <label className={styles.label}>End</label>
          <div className={styles.dateTimeInputs}>
            <input
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className={styles.input}
              required
            />
            {!isAllDay && (
              <input
                type="time"
                value={endTime}
                onChange={(e) => onEndTimeChange(e.target.value)}
                className={styles.input}
                required
              />
            )}
          </div>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="recurrence-select">
            Repeat
          </label>
          <select
            id="recurrence-select"
            value={recurrence}
            onChange={(e) =>
              onRecurrenceChange(e.target.value as RecurrenceRule['frequency'] | 'none')
            }
            className={styles.select}
          >
            {RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

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
      </div>
    </>
  )
}
