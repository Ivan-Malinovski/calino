import { format, parseISO } from 'date-fns'
import { pad2 } from '@/lib/datetime'
import { extractOriginalEventId } from '@/lib/events'
import { isUUID } from '@/lib/uuid'
import type { CalendarEvent, CalendarAttachment, RecurrenceRule, Reminder } from '@/types'

export interface InitialFormState {
  title: string
  description: string
  location: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  isAllDay: boolean
  calendarId: string
  recurring: boolean
  recurrence: RecurrenceRule['frequency']
  interval: number
  byWeekday: number[]
  byMonthDay: number[]
  byMonth: number[]
  // R2.4 — Per-BYDAY ordinals (parallel to byWeekday). e.g. for "second
  // Tuesday", byWeekday=[2] and byDayOrdinals=[2]. Distinct from
  // rule.bySetPos, which is reserved for the standalone BYSETPOS rule part.
  byDayOrdinals: number[]
  endCondition: 'never' | 'on' | 'after'
  endOnDate: string
  endAfterCount: number
  travelDuration: number | undefined
  reminders: Reminder[]
  transparency: 'opaque' | 'transparent'
  categories: string[]
  attachments: CalendarAttachment[]
  relatedTo: string[]
}

export type InitialFormStateWithMeta = InitialFormState & {
  isRecurringInstance: boolean
  originalEventId: string | null
}

export function makeDefaultState(
  overrides: Partial<InitialFormStateWithMeta> = {}
): InitialFormStateWithMeta {
  const today = format(new Date(), 'yyyy-MM-dd')
  return {
    title: '',
    description: '',
    location: '',
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '10:00',
    isAllDay: false,
    calendarId: '',
    recurring: false,
    recurrence: 'weekly',
    interval: 1,
    byWeekday: [],
    byMonthDay: [],
    byMonth: [],
    byDayOrdinals: [],
    endCondition: 'never',
    endOnDate: today,
    endAfterCount: 10,
    travelDuration: undefined,
    reminders: [],
    transparency: 'opaque',
    categories: [],
    attachments: [],
    relatedTo: [],
    isRecurringInstance: false,
    originalEventId: null,
    ...overrides,
  }
}

export function getInitialFormState(
  isModalOpen: boolean,
  selectedEventId: string | null,
  selectedDate: string | null,
  selectedEndDate: string | null,
  events: CalendarEvent[],
  calendars: { id: string; isDefault: boolean }[],
  allCategories: { id: string; name: string }[]
): InitialFormStateWithMeta {
  // Early return when modal is closed — skip all computation
  if (!isModalOpen) {
    const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]
    return makeDefaultState({ calendarId: defaultCalendar?.id || '' })
  }

  const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]

  const isEditing = selectedEventId !== null

  let existingEvent: CalendarEvent | undefined
  let isRecurringInstance = false
  let originalEventId: string | null = null

  if (isEditing && selectedEventId) {
    existingEvent = events.find((e) => e.id === selectedEventId)

    if (existingEvent?.recurrenceId) {
      isRecurringInstance = true
      originalEventId =
        existingEvent.recurrenceMasterId || existingEvent.uid || extractOriginalEventId(selectedEventId)
    }

    if (!existingEvent) {
      const originalId = extractOriginalEventId(selectedEventId)
      if (originalId) {
        existingEvent = events.find((e) => e.id === originalId)
        if (existingEvent) {
          isRecurringInstance = true
          originalEventId = originalId
        }
      }
    }
  }

  if (isModalOpen) {
    if (existingEvent) {
      // Convert category IDs to names
      const categoryNames: string[] = []
      if (existingEvent.categories) {
        for (const catIdOrName of existingEvent.categories) {
          if (isUUID(catIdOrName)) {
            const cat = allCategories.find((c) => c.id === catIdOrName)
            if (cat) categoryNames.push(cat.name)
          } else {
            categoryNames.push(catIdOrName)
          }
        }
      }
      const rule = existingEvent.recurrence
      // R2.4 — Read per-BYDAY ordinals from byDayOrdinals. Fall back to
      // legacy bySetPos when byDayOrdinals is missing (events persisted
      // before the R2.4 deconflation stored per-BYDAY ordinals in
      // bySetPos when byWeekday was present).
      const ordinals: number[] | undefined =
        rule?.byDayOrdinals && rule.byDayOrdinals.length > 0
          ? rule.byDayOrdinals.filter((p) => p !== 0)
          : rule?.bySetPos && rule.byWeekday && rule.byWeekday.length > 0
            ? rule.bySetPos.filter((p) => p !== 0)
            : undefined
      const endOnDate = rule?.endDate
        ? format(parseISO(rule.endDate), 'yyyy-MM-dd')
        : format(parseISO(existingEvent.start), 'yyyy-MM-dd')
      const endCondition: 'never' | 'on' | 'after' = rule?.endDate
        ? 'on'
        : rule?.count
          ? 'after'
          : 'never'
      return {
        title: existingEvent.title,
        description: existingEvent.description || '',
        location: existingEvent.location || '',
        startDate: format(parseISO(existingEvent.start), 'yyyy-MM-dd'),
        startTime: format(parseISO(existingEvent.start), 'HH:mm'),
        endDate: format(parseISO(existingEvent.end), 'yyyy-MM-dd'),
        endTime: format(parseISO(existingEvent.end), 'HH:mm'),
        isAllDay: existingEvent.isAllDay,
        calendarId: existingEvent.calendarId,
        recurring: !!rule,
        recurrence: rule?.frequency || 'weekly',
        interval: rule?.interval ?? 1,
        byWeekday: rule?.byWeekday ?? [],
        byMonthDay: rule?.byMonthDay ?? [],
        byMonth: rule?.byMonth ?? [],
        byDayOrdinals: ordinals && ordinals.length > 0 ? ordinals : [],
        endCondition,
        endOnDate,
        endAfterCount: rule?.count ?? 10,
        travelDuration: existingEvent.travelDuration,
        reminders: existingEvent.reminders || [],
        transparency: existingEvent.transparency || 'opaque',
        categories: categoryNames,
        attachments: existingEvent.attachments || [],
        relatedTo: existingEvent.relatedTo || [],
        isRecurringInstance,
        originalEventId,
      }
    }

    if (selectedDate) {
      const hasTime = selectedDate.includes('T')
      const dateStr = hasTime ? selectedDate.split('T')[0] : selectedDate

      let startTimeVal = '09:00'
      let endTimeVal = '10:00'

      if (hasTime) {
        const time = selectedDate.split('T')[1]?.substring(0, 5) || '09:00'
        startTimeVal = time
        const [h, m] = time.split(':').map(Number)
        const endMins = h * 60 + m + 60
        const endH = Math.floor(endMins / 60) % 24
        const endM = endMins % 60
        endTimeVal = `${pad2(endH)}:${pad2(endM)}`
      } else {
        // No specific time - smart default only applies for TODAY
        const todayStr = format(new Date(), 'yyyy-MM-dd')
        if (dateStr === todayStr) {
          // Round up to next hour, then add 1 hour
          const now = new Date()
          let hours = now.getHours()
          const mins = now.getMinutes()
          if (mins > 0) hours += 1 // round up to next hour
          hours += 1 // add 1 more hour
          hours = hours % 24
          startTimeVal = `${pad2(hours)}:00`
          const endHour = (hours + 1) % 24
          endTimeVal = `${pad2(endHour)}:00`
        }
        // else: use default 09:00/10:00
      }

      if (selectedEndDate && selectedEndDate.includes('T')) {
        const endTime = selectedEndDate.split('T')[1]
        const endDatePart = selectedEndDate.split('T')[0]
        endTimeVal = endTime
        if (endDatePart !== dateStr) {
          return makeDefaultState({
            calendarId: defaultCalendar?.id || '',
            startDate: dateStr,
            startTime: startTimeVal,
            endDate: endDatePart,
            endTime: endTimeVal,
            endOnDate: dateStr,
          })
        }
      }

      return makeDefaultState({
        calendarId: defaultCalendar?.id || '',
        startDate: dateStr,
        startTime: startTimeVal,
        endDate: dateStr,
        endTime: endTimeVal,
        endOnDate: dateStr,
      })
    }
  }

  return makeDefaultState({ calendarId: defaultCalendar?.id || '' })
}
