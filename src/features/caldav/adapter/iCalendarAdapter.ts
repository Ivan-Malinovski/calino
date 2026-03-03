import { v4 as uuidv4 } from 'uuid'
import type { CalendarEvent, RecurrenceRule, Reminder, TaskPriority } from '@/types'

export function parseICALEvent(iCalData: string, calendarId: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const lines = iCalData.split(/\r\n|\n|\r/)

  let currentEvent: Partial<CalendarEvent> | null = null
  let currentAlarms: Reminder[] = []
  let inEvent = false
  let inAlarm = false
  const uidToIndex = new Map<string, number>()

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
        const uid = currentEvent.id
        const existingIndex = uid ? uidToIndex.get(uid) : undefined

        const eventData: CalendarEvent = {
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
          travelDuration: currentEvent.travelDuration,
        }

        if (existingIndex !== undefined) {
          const existing = events[existingIndex]
          if (existing.rruleString) {
            // Already have the master event, skip this instance
          } else if (eventData.rruleString) {
            // This is the master event, replace the instance
            events[existingIndex] = eventData
          } else {
            // Both are non-recurring instances, skip duplicate
          }
        } else {
          if (uid) {
            uidToIndex.set(uid, events.length)
          }
          events.push(eventData)
        }
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
      } else if (line.startsWith('X-APPLE-TRAVEL-DURATION:')) {
        const duration = line.substring(24)
        const minutes = parseTravelDuration(duration)
        if (minutes !== null) {
          currentEvent.travelDuration = minutes
        }
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
  const colonIndex = line.lastIndexOf(':')
  return colonIndex !== -1 ? line.substring(colonIndex + 1) : ''
}

function parseICalDateTime(value: string): { date: string; isAllDay: boolean } {
  const isAllDay = value.length === 8

  if (isAllDay) {
    const year = value.substring(0, 4)
    const month = value.substring(4, 6)
    const day = value.substring(6, 8)
    return { date: `${year}-${month}-${day}T00:00:00`, isAllDay: true }
  }

  const hasTime = value.includes('T')
  const hasZ = value.endsWith('Z')
  const dateTimeValue = hasZ ? value.slice(0, -1) : value

  if (hasTime && dateTimeValue.length >= 15) {
    const year = dateTimeValue.substring(0, 4)
    const month = dateTimeValue.substring(4, 6)
    const day = dateTimeValue.substring(6, 8)
    const hour = dateTimeValue.substring(9, 11)
    const minute = dateTimeValue.substring(11, 13)
    const second = dateTimeValue.substring(13, 15)

    if (hasZ) {
      return {
        date: `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
        isAllDay: false,
      }
    }

    const asLocal = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`)
    return {
      date: asLocal.toISOString(),
      isAllDay: false,
    }
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

function parseTravelDuration(duration: string): number | null {
  const match = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/)
  if (!match) return null

  const days = parseInt(match[1] || '0', 10)
  const hours = parseInt(match[2] || '0', 10)
  const minutes = parseInt(match[3] || '0', 10)

  const totalMinutes = days * 24 * 60 + hours * 60 + minutes
  return totalMinutes > 0 ? totalMinutes : null
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
    'PRODID:-//Calino//EN',
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

  if (event.travelDuration) {
    lines.push(`X-APPLE-TRAVEL-DURATION:${formatMinutesToDuration(event.travelDuration)}`)
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
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
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

function formatMinutesToDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours > 0 && mins > 0) {
    return `PT${hours}H${mins}M`
  } else if (hours > 0) {
    return `PT${hours}H`
  } else {
    return `PT${mins}M`
  }
}

export function parseICALData(iCalData: string, calendarId: string): CalendarEvent[] {
  const events = parseICALEvent(iCalData, calendarId)
  const tasks = parseICALTask(iCalData, calendarId)
  return [...events, ...tasks]
}

export function parseICALTask(iCalData: string, calendarId: string): CalendarEvent[] {
  const tasks: CalendarEvent[] = []
  const lines = iCalData.split(/\r\n|\n|\r/)

  let currentTask: Partial<CalendarEvent> | null = null
  let inTask = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('BEGIN:VTODO')) {
      currentTask = {
        id: uuidv4(),
        calendarId,
        type: 'task',
        isAllDay: true,
      }
      inTask = true
    } else if (line.startsWith('END:VTODO') && currentTask) {
      const taskData: CalendarEvent = {
        id: currentTask.id ?? uuidv4(),
        calendarId: currentTask.calendarId ?? calendarId,
        title: currentTask.title ?? 'Untitled',
        description: currentTask.description,
        location: currentTask.location,
        start: currentTask.dueDate ?? new Date().toISOString(),
        end: currentTask.dueDate ?? new Date().toISOString(),
        isAllDay: true,
        color: currentTask.color,
        type: 'task',
        dueDate: currentTask.dueDate,
        completed: currentTask.completed,
        priority: currentTask.priority,
        percentComplete: currentTask.percentComplete,
      }
      tasks.push(taskData)
      currentTask = null
      inTask = false
    } else if (inTask && currentTask) {
      if (line.startsWith('UID:')) {
        currentTask.id = line.substring(4)
      } else if (line.startsWith('SUMMARY:')) {
        currentTask.title = line.substring(8)
      } else if (line.startsWith('DESCRIPTION:')) {
        currentTask.description = line.substring(12)
      } else if (line.startsWith('DUE')) {
        const colonIndex = line.indexOf(':')
        const value = colonIndex !== -1 ? line.substring(colonIndex + 1) : ''
        const parsed = parseICalDateTime(value)
        currentTask.dueDate = parsed.date
        currentTask.start = parsed.date
        currentTask.end = parsed.date
      } else if (line.startsWith('PRIORITY:')) {
        const priority = parseInt(line.substring(9), 10)
        const priorityMap: Record<number, TaskPriority> = {
          1: 1,
          2: 2,
          3: 2,
          5: 2,
          6: 3,
          7: 3,
          8: 3,
          9: 3,
        }
        currentTask.priority = priorityMap[priority] ?? 2
      } else if (line.startsWith('PERCENT-COMPLETE')) {
        const colonIndex = line.indexOf(':')
        const value = colonIndex !== -1 ? line.substring(colonIndex + 1) : ''
        const percent = parseInt(value, 10)
        if (!isNaN(percent)) {
          currentTask.percentComplete = percent
          currentTask.completed = percent >= 100
        }
      } else if (line.startsWith('STATUS:')) {
        const status = line.substring(7)
        currentTask.completed = status === 'COMPLETED'
      }
    }
  }

  return tasks
}

export function taskToICAL(task: CalendarEvent): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calino//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTODO',
    `UID:${task.id}`,
    `DTSTAMP:${formatICalTimestamp(new Date())}`,
    `SUMMARY:${task.title}`,
  ]

  if (task.dueDate) {
    lines.push(`DUE;VALUE=DATE:${formatICalDateTime(task.dueDate, true)}`)
  }

  if (task.description) {
    lines.push(`DESCRIPTION:${task.description}`)
  }

  if (task.priority) {
    const priorityValue = task.priority === 1 ? 1 : task.priority === 2 ? 5 : 9
    lines.push(`PRIORITY:${priorityValue}`)
  }

  if (task.percentComplete !== undefined) {
    lines.push(`PERCENT-COMPLETE:${task.percentComplete}`)
  }

  if (task.completed) {
    lines.push('STATUS:COMPLETED')
    lines.push(`COMPLETED:${formatICalTimestamp(new Date())}`)
  } else {
    lines.push('STATUS:NEEDS-ACTION')
  }

  lines.push('END:VTODO')
  lines.push('END:VCALENDAR')

  return lines.join('\r\n')
}
