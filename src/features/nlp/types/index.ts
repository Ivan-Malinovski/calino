import type { RecurrenceRule } from '@/types'

export interface NLPParseResult {
  title: string
  startDate: Date
  endDate?: Date
  isAllDay: boolean
  isTask: boolean
  duration?: number
  location?: string
  confidence: number
  raw: string
  recurrence?: RecurrenceRule
}

export interface NLPParseOptions {
  defaultDuration?: number
  defaultDate?: Date
}
