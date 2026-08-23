import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RecurrenceRule } from '@/types'
import { getWeekdayLabels, getShortMonthNames } from './weekdayLabels'
import styles from './EventModal.module.css'

const RECURRENCE_OPTIONS: { value: RecurrenceRule['frequency']; labelKey: string }[] = [
  { value: 'daily', labelKey: 'modals.recurrence.frequency.daily' },
  { value: 'weekly', labelKey: 'modals.recurrence.frequency.weekly' },
  { value: 'monthly', labelKey: 'modals.recurrence.frequency.monthly' },
  { value: 'yearly', labelKey: 'modals.recurrence.frequency.yearly' },
]



// --- Monthly pattern helpers ---

type MonthlyPattern = 'dayOfMonth' | 'nthWeekday' | 'lastWeekday'

function detectMonthlyPattern(
  byWeekday: number[] | undefined,
  byDayOrdinals: number[] | undefined
): MonthlyPattern {
  if (byWeekday && byWeekday.length > 0) {
    if (
      byDayOrdinals &&
      byDayOrdinals.length === byWeekday.length &&
      byDayOrdinals.every((p) => p === -1)
    ) {
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

// --- Sub-components ---

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
  const { t } = useTranslation('calendar')
  const pattern = detectMonthlyPattern(byWeekday, byDayOrdinals)
  const startDay = parseInt(startDate.split('-')[2] || '1', 10)
  const startMonth = parseInt(startDate.split('-')[1] || '1', 10)
  const startYear = parseInt(startDate.split('-')[0] || '2025', 10)
  const startWeekday = new Date(Date.UTC(startYear, startMonth - 1, startDay)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(startYear, startMonth, 0)).getUTCDate()

  const nthFromByWeekday = byWeekday[0] !== undefined ? byWeekday[0] : startWeekday
  const posFromByDayOrdinals =
    byDayOrdinals[0] !== undefined ? byDayOrdinals[0] : Math.ceil(startDay / 7)
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
        aria-label={t('modals.recurrence.monthlyPattern')}
        className={styles.select}
        style={{ maxWidth: '220px' }}
      >
        <option value="dayOfMonth">{t('modals.recurrence.onDayOfMonth')}</option>
        <option value="nthWeekday">{t('modals.recurrence.onNthWeekday')}</option>
        <option value="lastWeekday">{t('modals.recurrence.onLastWeekday')}</option>
      </select>

      {pattern === 'dayOfMonth' && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span>{t('modals.recurrence.day')}</span>
          <select
            value={dayFromByMonthDay}
            onChange={(e) => onByMonthDayChange([parseInt(e.target.value, 10)])}
            className={styles.select}
            style={{ width: '90px' }}
          >
            {days31.map((d) => (
              <option key={d} value={d}>
                {d}
                {d === daysInMonth ? ` ${t('modals.recurrence.lastDay')}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {(pattern === 'nthWeekday' || pattern === 'lastWeekday') && (
        <div
          style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          {pattern === 'nthWeekday' && (
            <select
              value={posFromByDayOrdinals}
              onChange={(e) => onByDayOrdinalsChange([parseInt(e.target.value, 10)])}
              aria-label={t('modals.recurrence.nthWeekdayOfMonth')}
              className={styles.select}
              style={{ width: '110px' }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {t(`modals.recurrence.ordinal.${n}`)}
                </option>
              ))}
            </select>
          )}
          <select
            value={nthFromByWeekday}
            onChange={(e) => onByWeekdayChange([parseInt(e.target.value, 10)])}
            aria-label={t('modals.recurrence.weekday')}
            className={styles.select}
            style={{ width: '120px' }}
          >
            {Array.from({ length: 7 }, (_, i) => i).map((d) => {
              const actualWeekday = (d + firstDayOfWeek) % 7
              return (
                <option key={actualWeekday} value={actualWeekday}>
                  {weekdayLabels[d]}
                </option>
              )
            })}
          </select>
          {pattern === 'lastWeekday' && (
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              {t('modals.recurrence.ofTheMonth')}
            </span>
          )}
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
  const { t } = useTranslation('calendar')
  const monthShort = getShortMonthNames()
  const toggle = (m: number): void => {
    if (byMonth.includes(m)) {
      onByMonthChange(byMonth.filter((x) => x !== m))
    } else {
      onByMonthChange([...byMonth, m].sort((a, b) => a - b))
    }
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {monthShort.map((label, idx) => {
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
          aria-label={t('modals.recurrence.resetMonths')}
        >
          {t('modals.recurrence.all')}
        </button>
      )}
    </div>
  )
}

// --- Main component ---

interface RecurrenceToggleProps {
  recurring: boolean
  onRecurringChange: (recurring: boolean) => void
  disabled?: boolean
  /** Shown next to a disabled toggle so the reason isn't invisible. */
  disabledReason?: string
}

/**
 * The "Recurring" checkbox on its own. Split from {@link RecurrenceFields}
 * because the event form puts the toggle in the summary row and the controls
 * inside the collapsible "More" panel.
 */
export function RecurrenceToggle({
  recurring,
  onRecurringChange,
  disabled = false,
  disabledReason,
}: RecurrenceToggleProps): JSX.Element {
  const { t } = useTranslation('calendar')
  return (
    <label
      className={styles.checkbox}
      title={disabled ? disabledReason : undefined}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <input
        type="checkbox"
        checked={recurring}
        disabled={disabled}
        onChange={(e) => onRecurringChange(e.target.checked)}
      />
      <span>{t('modals.recurrence.recurring')}</span>
      {disabled && disabledReason && (
        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          ({disabledReason})
        </span>
      )}
    </label>
  )
}

export interface RecurrenceFieldsProps {
  recurring: boolean
  recurrence: RecurrenceRule['frequency']
  onRecurrenceChange: (recurrence: RecurrenceRule['frequency']) => void
  interval: number
  onIntervalChange: (interval: number) => void
  startDate: string
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
  firstDayOfWeek: number
}

/**
 * The recurrence controls (frequency, interval, by-day/month pattern, end
 * condition). Renders nothing unless `recurring` is true. The "Recurring"
 * checkbox itself is {@link RecurrenceToggle}.
 */
export function RecurrenceFields({
  recurring,
  recurrence,
  onRecurrenceChange,
  interval,
  onIntervalChange,
  startDate,
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
  firstDayOfWeek,
}: RecurrenceFieldsProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const weekdayLabels = getWeekdayLabels(firstDayOfWeek)

  const handleWeekdayToggle = (displayIndex: number): void => {
    if (!onByWeekdayChange) return
    const actualWeekday = (displayIndex + firstDayOfWeek) % 7
    const newByWeekday = byWeekday.includes(actualWeekday)
      ? byWeekday.filter((d: number) => d !== actualWeekday)
      : [...byWeekday, actualWeekday].sort((a, b) => a - b)
    onByWeekdayChange(newByWeekday)
  }

  return (
    <>
      {recurring && (
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="recurrence-select">
              {t('modals.recurrence.repeat')}
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <select
                id="recurrence-select"
                value={recurrence}
                onChange={(e) => onRecurrenceChange(e.target.value as RecurrenceRule['frequency'])}
                className={styles.select}
              >
                {RECURRENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                {t('modals.recurrence.every')}
              </span>
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
                aria-label={t('modals.recurrence.repeatInterval')}
              />
              <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                {t('modals.recurrence.intervalUnit', { count: interval, context: recurrence })}
              </span>
            </div>
          </div>
        </div>
      )}

      {recurring && recurrence === 'weekly' && onByWeekdayChange && (
        <div className={styles.weekdayField}>
          <label className={styles.label} style={{ fontWeight: 600 }}>
            {t('modals.recurrence.onDays')}
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
                  aria-label={t('modals.recurrence.includeDay', { day: label })}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {recurring &&
        recurrence === 'monthly' &&
        onByMonthDayChange &&
        onByWeekdayChange &&
        onByDayOrdinalsChange && (
          <div className={styles.field}>
            <label className={styles.label} style={{ fontWeight: 600 }}>
              {t('modals.recurrence.monthlyPatternLabel')}
            </label>
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
          <label className={styles.label} style={{ fontWeight: 600 }}>
            {t('modals.recurrence.inMonths')}
          </label>
          <YearlyMonthPicker byMonth={byMonth} onByMonthChange={onByMonthChange} />
        </div>
      )}

      {recurring && (
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="end-condition-select">
              {t('modals.recurrence.ends')}
            </label>
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <select
                id="end-condition-select"
                value={endCondition}
                onChange={(e) => onEndConditionChange(e.target.value as 'never' | 'on' | 'after')}
                className={styles.select}
              >
                <option value="never">{t('modals.recurrence.never')}</option>
                <option value="on">{t('modals.recurrence.onDate')}</option>
                <option value="after">{t('modals.recurrence.afterOccurrences')}</option>
              </select>
              {endCondition === 'on' && (
                <input
                  type="date"
                  value={endOnDate}
                  onChange={(e) => onEndOnDateChange(e.target.value)}
                  className={styles.input}
                  style={{ width: '160px' }}
                  aria-label={t('modals.recurrence.endDate')}
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
                    aria-label={t('modals.recurrence.numberOfOccurrences')}
                  />
                  <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {t('modals.recurrence.occurrence', { count: endAfterCount })}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
