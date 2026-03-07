import { Chrono } from 'chrono-node'
import { addMinutes, isValid } from 'date-fns'
import { extractTitle } from './extractTitle'
import { extractDuration, extractRecurrence } from './extractDuration'
import { extractLocation } from './extractLocation'
import type { NLPParseResult, NLPParseOptions } from '../types'

const chrono = new Chrono()

const DEFAULT_DURATION = 60

const TASK_PREFIXES = [
  /^todo\s*/i,
  /^task\s*/i,
  /^remind me to\s*/i,
  /^remind me:\s*/i,
  /^reminder:\s*/i,
]

function detectTask(input: string): boolean {
  return TASK_PREFIXES.some((pattern) => pattern.test(input))
}

function stripTaskPrefix(input: string): string {
  for (const pattern of TASK_PREFIXES) {
    const match = input.match(pattern)
    if (match) {
      return input.slice(match[0].length).trim()
    }
  }
  return input
}

export class NLParser {
  private defaultDuration: number
  private defaultDate: Date

  constructor(options: NLPParseOptions = {}) {
    this.defaultDuration = options.defaultDuration ?? DEFAULT_DURATION
    this.defaultDate = options.defaultDate ?? new Date()
  }

  parse(input: string): NLPParseResult {
    if (!input || input.trim().length === 0) {
      return this.createEmptyResult(input)
    }

    const isTask = detectTask(input)

    const parsed = chrono.parse(input, this.defaultDate, {
      forwardDate: true,
    })

    let startDate: Date
    let endDate: Date | undefined
    let isAllDay = false
    let parsedText = ''
    let confidence = 0.5

    if (parsed && parsed.length > 0) {
      const firstMatch = parsed[0]
      startDate = firstMatch.start.date()
      parsedText = firstMatch.text

      if (!isValid(startDate)) {
        startDate = this.defaultDate
      }

      const hasHour = firstMatch.start.isCertain('hour')
      const hasMinute = firstMatch.start.isCertain('minute')

      if (!hasHour && !hasMinute) {
        isAllDay = true
        confidence = 0.8
      } else {
        confidence = 0.9
      }

      if (firstMatch.end) {
        endDate = firstMatch.end.date()
        if (isValid(endDate)) {
          confidence = Math.min(confidence + 0.1, 1)
        }
      }
    } else {
      startDate = this.defaultDate
      isAllDay = true
      confidence = 0.3
    }

    const duration = extractDuration(input, this.defaultDuration)

    if (!endDate && !isAllDay && isValid(startDate)) {
      endDate = addMinutes(startDate, duration)
    }

    const titleInput = isTask ? stripTaskPrefix(input) : input
    const title = extractTitle(titleInput, parsedText)
    const location = extractLocation(input)
    const recurrenceResult = extractRecurrence(input)

    const result: NLPParseResult = {
      title,
      startDate,
      endDate,
      isAllDay,
      isTask,
      duration,
      location,
      confidence,
      raw: input,
    }

    if (recurrenceResult) {
      result.recurrence = {
        frequency: recurrenceResult.frequency,
        interval: recurrenceResult.interval,
        byWeekday: recurrenceResult.byWeekday,
      }
      result.duration = undefined
      result.endDate = undefined
    }

    return result
  }

  private createEmptyResult(input: string): NLPParseResult {
    return {
      title: 'New Event',
      startDate: this.defaultDate,
      isAllDay: true,
      isTask: false,
      confidence: 0,
      raw: input,
    }
  }

  parseToEvent(): (input: string) => NLPParseResult {
    return (input: string) => this.parse(input)
  }
}

export function createParser(options?: NLPParseOptions): NLParser {
  return new NLParser(options)
}

export function parseNaturalLanguage(input: string, options?: NLPParseOptions): NLPParseResult {
  const parser = new NLParser(options)
  return parser.parse(input)
}
