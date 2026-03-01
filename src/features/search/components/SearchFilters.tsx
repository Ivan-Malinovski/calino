import type { JSX } from 'react'
import { format, addDays, startOfWeek, endOfWeek } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { SearchFilters } from '../types'
import styles from './SearchFilters.module.css'

interface SearchFiltersProps {
  filters: SearchFilters
  onUpdateFilters: (filters: Partial<SearchFilters>) => void
  onClearFilters: () => void
}

export function SearchFilters({
  filters,
  onUpdateFilters,
  onClearFilters,
}: SearchFiltersProps): JSX.Element {
  const calendars = useCalendarStore((state) => state.calendars)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const today = format(new Date(), 'yyyy-MM-dd')
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: firstDayOfWeek }), 'yyyy-MM-dd')
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: firstDayOfWeek }), 'yyyy-MM-dd')
  const nextWeek = format(addDays(new Date(), 7), 'yyyy-MM-dd')
  const nextMonth = format(addDays(new Date(), 30), 'yyyy-MM-dd')

  const handleDatePreset = (preset: 'today' | 'thisWeek' | 'thisMonth' | 'custom') => {
    switch (preset) {
      case 'today':
        onUpdateFilters({ dateFrom: today, dateTo: today })
        break
      case 'thisWeek':
        onUpdateFilters({ dateFrom: weekStart, dateTo: weekEnd })
        break
      case 'thisMonth':
        onUpdateFilters({ dateFrom: today, dateTo: nextMonth })
        break
      case 'custom':
        break
    }
  }

  const handleCalendarToggle = (calendarId: string) => {
    const currentIds = filters.calendarIds ?? []
    const newIds = currentIds.includes(calendarId)
      ? currentIds.filter((id) => id !== calendarId)
      : [...currentIds, calendarId]

    onUpdateFilters({ calendarIds: newIds.length > 0 ? newIds : undefined })
  }

  const hasActiveFilters =
    filters.dateFrom || filters.dateTo || (filters.calendarIds && filters.calendarIds.length > 0)

  return (
    <div className={styles.filtersContainer}>
      <div className={styles.filterGroup}>
        <label className={styles.filterLabel}>Date Range</label>
        <select
          className={styles.filterSelect}
          value={
            filters.dateFrom === today && filters.dateTo === today
              ? 'today'
              : filters.dateFrom === weekStart && filters.dateTo === weekEnd
                ? 'thisWeek'
                : filters.dateFrom === today && filters.dateTo === nextMonth
                  ? 'thisMonth'
                  : 'custom'
          }
          onChange={(e) =>
            handleDatePreset(e.target.value as 'today' | 'thisWeek' | 'thisMonth' | 'custom')
          }
        >
          <option value="all">All dates</option>
          <option value="today">Today</option>
          <option value="thisWeek">This week</option>
          <option value="thisMonth">This month</option>
          <option value="custom">Custom range</option>
        </select>
      </div>

      {filters.dateFrom !== today &&
        filters.dateTo !== today &&
        filters.dateFrom !== weekStart &&
        filters.dateTo !== weekEnd &&
        filters.dateFrom !== nextWeek && (
          <>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>From</label>
              <input
                type="date"
                className={styles.filterInput}
                value={filters.dateFrom ?? ''}
                onChange={(e) => onUpdateFilters({ dateFrom: e.target.value || undefined })}
              />
            </div>
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>To</label>
              <input
                type="date"
                className={styles.filterInput}
                value={filters.dateTo ?? ''}
                onChange={(e) => onUpdateFilters({ dateTo: e.target.value || undefined })}
              />
            </div>
          </>
        )}

      <div className={styles.filterGroup}>
        <label className={styles.filterLabel}>Calendars</label>
        <div className={styles.checkboxGroup}>
          {calendars.map((calendar) => {
            const isActive = !filters.calendarIds || filters.calendarIds.includes(calendar.id)
            return (
              <label
                key={calendar.id}
                className={`${styles.checkboxLabel} ${isActive ? styles.active : ''}`}
              >
                <input
                  type="checkbox"
                  className={styles.checkboxInput}
                  checked={isActive}
                  onChange={() => handleCalendarToggle(calendar.id)}
                />
                <span className={styles.colorDot} style={{ backgroundColor: calendar.color }} />
                {calendar.name}
              </label>
            )
          })}
        </div>
      </div>

      {hasActiveFilters && (
        <button type="button" className={styles.clearFiltersButton} onClick={onClearFilters}>
          Clear filters
        </button>
      )}
    </div>
  )
}
