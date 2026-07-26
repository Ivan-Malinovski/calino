import {
  addMonths,
  addWeeks,
  addDays,
  subMonths,
  subWeeks,
  subDays,
  addYears,
  subYears,
} from 'date-fns'
import type { ViewType } from '@/types'

/**
 * Pure date-delta logic shared by header chevron navigation, header swipe
 * navigation, and the mobile content-area swipe gesture. Previously
 * duplicated across CalendarHeader.tsx's handleNavigate/handleSwipe.
 */
export function getNavigatedDate(
  currentView: ViewType,
  date: Date,
  direction: 'prev' | 'next'
): Date {
  switch (currentView) {
    case 'month':
      return direction === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
    case 'year':
      return direction === 'prev' ? subYears(date, 1) : addYears(date, 1)
    case 'week':
      return direction === 'prev' ? subWeeks(date, 1) : addWeeks(date, 1)
    case '3day':
      return direction === 'prev' ? subDays(date, 3) : addDays(date, 3)
    case 'day':
      return direction === 'prev' ? subDays(date, 1) : addDays(date, 1)
    case 'agenda':
      return direction === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
    case 'journal':
      return direction === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
    case 'todo':
    case 'contacts':
      return date
    default:
      return date
  }
}
