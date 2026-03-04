import { useCallback, useRef } from 'react'
import { addMonths, addWeeks, addDays, parseISO } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import type { ViewType } from '@/types'

interface UseSwipeNavigationOptions {
  currentView: ViewType
  currentDate: string
}

export function useSwipeNavigation({ currentView, currentDate }: UseSwipeNavigationOptions) {
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const touchStartX = useRef<number | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return

      const touchEndX = e.changedTouches[0].clientX
      const diff = touchStartX.current - touchEndX

      if (Math.abs(diff) > 50) {
        const direction = diff > 0 ? 'next' : 'prev'
        const date = parseISO(currentDate)
        let newDate: Date

        switch (currentView) {
          case 'month':
            newDate = direction === 'prev' ? addMonths(date, -1) : addMonths(date, 1)
            break
          case 'week':
            newDate = direction === 'prev' ? addWeeks(date, -1) : addWeeks(date, 1)
            break
          case 'day':
            newDate = direction === 'prev' ? addDays(date, -1) : addDays(date, 1)
            break
          case 'agenda':
            newDate = direction === 'prev' ? addMonths(date, -1) : addMonths(date, 1)
            break
          default:
            newDate = date
        }

        setCurrentDate(newDate.toISOString().split('T')[0])
      }

      touchStartX.current = null
    },
    [currentView, currentDate, setCurrentDate]
  )

  return { handleTouchStart, handleTouchEnd }
}
