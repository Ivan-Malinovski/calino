import { v4 as uuidv4 } from 'uuid'
import type { CalendarEvent, RecurrenceRule, Reminder } from '@/types'

export function parseICALEvent(iCalData: string, calendarId: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const lines = iCalData.split(/\r\n|\n|\r/)

  let currentEvent: Partial<CalendarEvent> | null = null
  let currentAlarms: Reminder[] = []
  let inEvent = false
  let inAlarm = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('BEGIN:VEVENT')) {
      currentEvent = {
        id: uuidv4(),
        calendarId,
        isAllDay: false,
      }
      inEvent = true
      currentAlarms = []
    } else if (line.startsWith('END:VEVENT') && currentEvent) {
      if (currentEvent.start && currentEvent.end) {
        events.push({
          id: currentEvent.id ?? uuidv4(),
          calendarId: currentEvent.calendarId ?? calendarId,
          title: currentEvent.title ?? 'Untitled',
          description: currentEvent.description,
          location: currentEvent.location,
          start: currentEvent.start,
          end: currentEvent.end,
          isAllDay: currentEvent.isAllDay ?? false,
          color: currentEvent.color,
          recurrence: currentEvent.recurrence,
          reminders: currentAlarms.length > 0 ? currentAlarms : undefined,
          rruleString: currentEvent.rruleString,
        })
      }
      currentEvent = null
      inEvent = false
    } else if (line.startsWith('BEGIN:VALARM')) {
      inAlarm = true
    } else if (line.startsWith('END:VALARM') && inAlarm) {
      inAlarm = false
    } else if (inEvent && currentEvent) {
      if (line.startsWith('UID:')) {
        currentEvent.id = line.substring(4)
      } else if (line.startsWith('SUMMARY:')) {
        currentEvent.title = line.substring(8)
      } else if (line.startsWith('DESCRIPTION:')) {
        currentEvent.description = line.substring(12)
      } else if (line.startsWith('LOCATION:')) {
        currentEvent.location = line.substring(9)
      } else if (line.startsWith('DTSTART')) {
        const value = extractICalValue(line)
        const parsed = parseICalDateTime(value)
        currentEvent.start = parsed.date
        currentEvent.isAllDay = parsed.isAllDay
      } else if (line.startsWith('DTEND')) {
        const value = extractICalValue(line)
        const parsed = parseICalDateTime(value)
        currentEvent.end = parsed.date
      } else if (line.startsWith('DURATION:')) {
        const duration = line.substring(9)
        if (currentEvent.start) {
          currentEvent.end = addDurationToDate(currentEvent.start, duration)
        }
      } else if (line.startsWith('RRULE:')) {
        currentEvent.rruleString = line.substring(6)
        currentEvent.recurrence = parseRRule(line.substring(6))
      } else if (inAlarm && line.startsWith('TRIGGER:')) {
        const trigger = line.substring(8)
        const minutes = parseTriggerDuration(trigger)
        if (minutes !== null) {
          currentAlarms.push({
            id: uuidv4(),
            minutesBefore: minutes,
            method: 'popup',
          })
        }
      }
    }
  }

  return events
}

function extractICalValue(line: string): string {
  const colonIndex = line.indexOf(':')
  return colonIndex !== -1 ? line.substring(colonIndex + 1) : ''
}

function parseICalDateTime(value: string): { date: string; isAllDay: boolean } {
  const isAllDay = value.length === 8

  if (isAllDay) {
    const year = value.substring(0, 4)
    const month = value.substring(4, 6)
    const day = value.substring(6, 8)
    return { date: `${year}-${month}-${day}T00:00:00.000Z`, isAllDay: true }
  }

  if (value.length === 15 && value.includes('T')) {
    const year = value.substring(0, 4)
    const month = value.substring(4, 6)
    const day = value.substring(6, 8)
    const hour = value.substring(9, 11)
    const minute = value.substring(11, 13)
    const second = value.substring(13, 15)
    return { date: `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`, isAllDay: false }
  }

  return { date: new Date().toISOString(), isAllDay: false }
}

function addDurationToDate(startDate: string, duration: string): string {
  const start = new Date(startDate)

  const match = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/)
  if (!match) return startDate

  const days = parseInt(match[1] || '0', 10)
  const hours = parseInt(match[2] || '0', 10)
  const minutes = parseInt(match[3] || '0', 10)

  start.setDate(start.getDate() + days)
  start.setHours(start.getHours() + hours)
  start.setMinutes(start.getMinutes() + minutes)

  return start.toISOString()
}

function parseTriggerDuration(trigger: string): number | null {
  if (trigger.startsWith('-PT')) {
    const duration = trigger.substring(3)
    let minutes = 0

    const hourMatch = duration.match(/(\d+)H/)
    const minMatch = duration.match(/(\d+)M/)

    if (hourMatch) {
      minutes += parseInt(hourMatch[1], 10) * 60
    }
    if (minMatch) {
      minutes += parseInt(minMatch[1], 10)
    }

    return minutes > 0 ? minutes : null
  }

  return null
}

function parseRRule(rruleString: string): RecurrenceRule | undefined {
  const parts = rruleString.split(';')
  let frequency: RecurrenceRule['frequency'] = 'weekly'
  let interval = 1
  let endDate: string | undefined
  let count: number | undefined
  let byWeekday: number[] | undefined

  for (const part of parts) {
    const [key, value] = part.split('=')

    switch (key) {
      case 'FREQ':
        switch (value) {
          case 'DAILY':
            frequency = 'daily'
            break
          case 'WEEKLY':
            frequency = 'weekly'
            break
          case 'MONTHLY':
            frequency = 'monthly'
            break
          case 'YEARLY':
            frequency = 'yearly'
            break
        }
        break
      case 'INTERVAL':
        interval = parseInt(value, 10)
        break
      case 'UNTIL':
        endDate = parseICalDateTime(value).date
        break
      case 'COUNT':
        count = parseInt(value, 10)
        break
      case 'BYDAY':
        byWeekday = value.split(',').map((day) => {
          const dayMap: Record<string, number> = {
            SU: 0,
            MO: 1,
            TU: 2,
            WE: 3,
            TH: 4,
            FR: 5,
            SA: 6,
          }
          return dayMap[day] ?? 1
        })
        break
    }
  }

  return {
    frequency,
    interval,
    endDate,
    count,
    byWeekday,
  }
}

export function eventToICAL(event: CalendarEvent): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GoodCal//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}`,
    `DTSTAMP:${formatICalTimestamp(new Date())}`,
    `DTSTART${event.isAllDay ? ';VALUE=DATE' : ''}:${formatICalDateTime(event.start, event.isAllDay)}`,
    `DTEND${event.isAllDay ? ';VALUE=DATE' : ''}:${formatICalDateTime(event.end, event.isAllDay)}`,
    `SUMMARY:${event.title}`,
  ]

  if (event.description) {
    lines.push(`DESCRIPTION:${event.description}`)
  }

  if (event.location) {
    lines.push(`LOCATION:${event.location}`)
  }

  if (event.rruleString) {
    lines.push(`RRULE:${event.rruleString}`)
  }

  if (event.reminders && event.reminders.length > 0) {
    for (const reminder of event.reminders) {
      lines.push('BEGIN:VALARM')
      lines.push('ACTION:DISPLAY')
      lines.push(`TRIGGER:-PT${reminder.minutesBefore}M`)
      lines.push('END:VALARM')
    }
  }

  lines.push('END:VEVENT')
  lines.push('END:VCALENDAR')

  return lines.join('\r\n')
}

function formatICalTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function formatICalDateTime(isoString: string, isAllDay: boolean): string {
  const date = new Date(isoString)

  if (isAllDay) {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCDate()).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  const second = String(date.getUTCSeconds()).padStart(2, '0')

  return `${year}${month}${day}T${hour}${minute}${second}Z`
}
