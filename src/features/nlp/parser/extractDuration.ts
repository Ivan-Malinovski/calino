const RECURRENCE_PATTERNS = [
  // "every other X" skips one period, so these carry interval 2 directly.
  // They are listed first because the plain "every X" patterns below would
  // otherwise never be reached for them — and the interval belongs to the
  // matched pattern, not to the input as a whole ("standup every day, review
  // every other week" must not make the daily standup fortnightly).
  { pattern: /\bevery\s+other\s+day\b/i, frequency: 'daily' as const, interval: 2 },
  { pattern: /\bevery\s+other\s+week\b/i, frequency: 'weekly' as const, interval: 2 },
  { pattern: /\bevery\s+other\s+month\b/i, frequency: 'monthly' as const, interval: 2 },
  { pattern: /\bevery\s+other\s+year\b/i, frequency: 'yearly' as const, interval: 2 },
  {
    pattern: /\bevery\s+other\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    frequency: 'weekly' as const,
    interval: 2,
  },
  { pattern: /\bevery\s+other\s+weekday\b/i, frequency: 'weekly' as const, interval: 2 },
  { pattern: /\bevery\s+other\s+weekend\b/i, frequency: 'weekly' as const, interval: 2 },
  { pattern: /\bevery\s+day\b/i, frequency: 'daily' as const, interval: 1 },
  { pattern: /(?<![-])\bdaily\b/i, frequency: 'daily' as const, interval: 1 },
  { pattern: /\bevery\s+week\b/i, frequency: 'weekly' as const, interval: 1 },
  { pattern: /(?<![-])\bweekly\b/i, frequency: 'weekly' as const, interval: 1 },
  { pattern: /\bevery\s+month\b/i, frequency: 'monthly' as const, interval: 1 },
  { pattern: /(?<![-])\bmonthly\b/i, frequency: 'monthly' as const, interval: 1 },
  { pattern: /\bevery\s+year\b/i, frequency: 'yearly' as const, interval: 1 },
  { pattern: /(?<![-])\b(?:yearly|annually)\b/i, frequency: 'yearly' as const, interval: 1 },
  { pattern: /\bevery\s+weekday\b/i, frequency: 'weekly' as const, interval: 1 },
  { pattern: /\bevery\s+weekend\b/i, frequency: 'weekly' as const, interval: 1 },
  // Plain "every <weekday>". This list previously had no entry for it, so
  // "gym every monday" produced no recurrence at all — the BYDAY extraction
  // below only runs once some pattern has matched, and none did. The gap only
  // became obvious when "every other monday" started working above it.
  {
    pattern: /\bevery\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i,
    frequency: 'weekly' as const,
    interval: 1,
  },
  { pattern: /(?<![-])\bweekdays?\b/i, frequency: 'weekly' as const, interval: 1 },
  { pattern: /(?<![-])\bweekends?\b/i, frequency: 'weekly' as const, interval: 1 },
]

/** Weekday extraction, tolerating the optional "other" from "every other X". */
const WEEKDAY_WITH_OTHER_RE =
  /every\s+(?:other\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?/i
const WEEKDAY_LIST_WITH_OTHER_RE = /every\s+(?:other\s+)?(weekday|weekend)/i

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

export function extractDuration(input: string, defaultDuration: number = 60): number {
  const lowerInput = input.toLowerCase()

  const hoursAndMinutesMatch = lowerInput.match(
    /(\d+)\s*(?:hour|hours|hr|hrs)\s*(?:and\s+)?(\d+)\s*(?:minute|minutes|min|mins)?/i
  )
  if (hoursAndMinutesMatch) {
    const hours = parseInt(hoursAndMinutesMatch[1], 10)
    const minutes = hoursAndMinutesMatch[2] ? parseInt(hoursAndMinutesMatch[2], 10) : 0
    return hours * 60 + minutes
  }

  const hoursOnlyMatch = lowerInput.match(/(\d+)\s*(?:hour|hours|hr|hrs)\b/i)
  if (hoursOnlyMatch) {
    return parseInt(hoursOnlyMatch[1], 10) * 60
  }

  const minutesOnlyMatch = lowerInput.match(/(\d+)\s*(?:minute|minutes|min|mins)\b/i)
  if (minutesOnlyMatch) {
    return parseInt(minutesOnlyMatch[1], 10)
  }

  const daysAndHoursMatch = lowerInput.match(
    /(\d+)\s*(?:day|days)\s*(?:and\s+)?(\d+)\s*(?:hour|hours)?/i
  )
  if (daysAndHoursMatch) {
    const days = parseInt(daysAndHoursMatch[1], 10)
    const hours = daysAndHoursMatch[2] ? parseInt(daysAndHoursMatch[2], 10) : 0
    return days * 24 * 60 + hours * 60
  }

  const daysOnlyMatch = lowerInput.match(/(\d+)\s*(?:day|days)\b/i)
  if (daysOnlyMatch) {
    return parseInt(daysOnlyMatch[1], 10) * 24 * 60
  }

  const forDurationMatch = lowerInput.match(/for\s+(\d+)\s*(?:hour|hours|minute|minutes|day|days)/i)
  if (forDurationMatch) {
    const value = parseInt(forDurationMatch[1], 10)
    if (lowerInput.includes('hour') || lowerInput.includes('hr')) {
      return value * 60
    }
    if (lowerInput.includes('day')) {
      return value * 24 * 60
    }
    return value
  }

  return defaultDuration
}

export interface RecurrenceResult {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  byWeekday?: number[]
}

export function extractRecurrence(input: string): RecurrenceResult | null {
  const lowerInput = input.toLowerCase()

  for (const { pattern, frequency, interval } of RECURRENCE_PATTERNS) {
    if (pattern.test(lowerInput)) {
      const result: RecurrenceResult = { frequency, interval }

      const weekdayMatch = lowerInput.match(WEEKDAY_WITH_OTHER_RE)
      if (weekdayMatch) {
        const dayNum = WEEKDAY_MAP[weekdayMatch[1].toLowerCase()]
        if (dayNum !== undefined) {
          result.byWeekday = [dayNum]
        }
      }

      const weekdayListMatch = lowerInput.match(WEEKDAY_LIST_WITH_OTHER_RE)
      if (weekdayListMatch) {
        if (weekdayListMatch[1].toLowerCase() === 'weekday') {
          result.byWeekday = [1, 2, 3, 4, 5]
        } else if (weekdayListMatch[1].toLowerCase() === 'weekend') {
          result.byWeekday = [0, 6]
        }
      }

      return result
    }
  }

  return null
}
