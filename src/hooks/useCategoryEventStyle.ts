import { useShallow } from 'zustand/react/shallow'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { CalendarEvent } from '@/types'
import {
  DEFAULT_CATEGORY_STYLE_RULES,
  resolveCategoryAppearance,
  type CategoryAppearance,
} from '@/lib/categoryStyles'

export function useCategoryEventStyle(
  event: Pick<CalendarEvent, 'categories'>
): CategoryAppearance {
  const rules = useSettingsStore((s) => s.categoryStyleRules)
  return useCalendarStore(
    useShallow((s) =>
      resolveCategoryAppearance(event, s.categories ?? [], rules ?? DEFAULT_CATEGORY_STYLE_RULES)
    )
  )
}
