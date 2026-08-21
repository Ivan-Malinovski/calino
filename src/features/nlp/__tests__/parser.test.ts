import { describe, it, expect } from 'vitest'
import { extractTitle } from '../parser/extractTitle'
import { extractDuration, extractRecurrence } from '../parser/extractDuration'
import { extractLocation } from '../parser/extractLocation'
import { parseNaturalLanguage } from '../parser/NLParser'

describe('extractTitle', () => {
  it('extracts simple title', () => {
    expect(extractTitle('Meeting tomorrow at 2pm', 'tomorrow at 2pm')).toBe('Meeting')
  })

  it('extracts title with "at" keyword', () => {
    expect(extractTitle('Lunch with mom at noon', 'noon')).toBe('Lunch with mom')
  })

  it('extracts title with date', () => {
    expect(extractTitle('dentist appointment on March 15', 'March 15')).toBe('Dentist appointment')
  })

  it('returns "New Event" for empty input', () => {
    expect(extractTitle('', '')).toBe('New Event')
  })

  it('capitalizes first letter', () => {
    expect(extractTitle('team standup at 9am', '9am')).toBe('Team standup')
  })
})

describe('extractDuration', () => {
  it('extracts hours', () => {
    expect(extractDuration('meeting for 2 hours')).toBe(120)
  })

  it('extracts minutes', () => {
    expect(extractDuration('30 minutes meeting')).toBe(30)
  })

  it('extracts hours and minutes', () => {
    expect(extractDuration('meeting for 2 hours and 30 minutes')).toBe(150)
  })

  it('extracts days', () => {
    expect(extractDuration('conference for 3 days')).toBe(4320)
  })

  it('returns default for no duration', () => {
    expect(extractDuration('meeting at 2pm')).toBe(60)
  })

  it('uses custom default', () => {
    expect(extractDuration('meeting at 2pm', 30)).toBe(30)
  })
})

describe('extractRecurrence', () => {
  it('detects daily recurrence', () => {
    const result = extractRecurrence('meeting every day')
    expect(result?.frequency).toBe('daily')
    expect(result?.interval).toBe(1)
  })

  it('detects weekly recurrence', () => {
    const result = extractRecurrence('team standup every week')
    expect(result?.frequency).toBe('weekly')
    expect(result?.interval).toBe(1)
  })

  it('detects monthly recurrence', () => {
    const result = extractRecurrence('bill monthly')
    expect(result?.frequency).toBe('monthly')
    expect(result?.interval).toBe(1)
  })

  it('detects yearly recurrence', () => {
    const result = extractRecurrence('anniversary yearly')
    expect(result?.frequency).toBe('yearly')
  })

  it('detects weekday recurrence', () => {
    const result = extractRecurrence('standup every weekday')
    expect(result?.frequency).toBe('weekly')
    expect(result?.byWeekday).toEqual([1, 2, 3, 4, 5])
  })

  it('returns null for non-recurring', () => {
    expect(extractRecurrence('meeting tomorrow')).toBeNull()
  })
})

describe('extractLocation', () => {
  it('extracts location with "at" keyword', () => {
    expect(extractLocation('Meeting at coffee shop')).toBe('coffee shop')
  })

  it('returns undefined for no location', () => {
    expect(extractLocation('Meeting tomorrow')).toBeUndefined()
  })

  it('does not extract time as location', () => {
    expect(extractLocation('Meeting at 19-20')).toBeUndefined()
    expect(extractLocation('Meeting at 2pm')).toBeUndefined()
  })
})

describe('NLParser', () => {
  it('parses simple date and time', () => {
    const result = parseNaturalLanguage('Meeting tomorrow at 2pm')
    expect(result.title).toBe('Meeting')
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.isAllDay).toBe(false)
  })

  it('parses date only', () => {
    const result = parseNaturalLanguage('dentist appointment on March 15')
    expect(result.title).toBe('Dentist appointment')
    expect(result.isAllDay).toBe(true)
  })

  it('parses duration', () => {
    const result = parseNaturalLanguage('Meeting for 2 hours starting at 3pm')
    expect(result.duration).toBe(120)
  })

  it('parses location', () => {
    const result = parseNaturalLanguage('Lunch at downtown cafe')
    expect(result.location).toBe('downtown cafe')
  })

  it('parses recurring event', () => {
    const result = parseNaturalLanguage('team standup every weekday at 9am')
    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('weekly')
  })

  it('handles empty input', () => {
    const result = parseNaturalLanguage('')
    expect(result.title).toBe('New Event')
    expect(result.confidence).toBe(0)
  })

  it('parses relative dates', () => {
    const result = parseNaturalLanguage('meeting next Thursday')
    expect(result.title).toBe('Meeting')
    expect(result.isAllDay).toBe(true)
  })

  it('keeps "tonight" out of the title', () => {
    const result = parseNaturalLanguage('dinner tonight')
    expect(result.title).toBe('Dinner')
    expect(result.startDate.getHours()).toBe(22)
  })

  it('treats a casual time-of-day as a timed event, not an all-day one', () => {
    // chrono gives "tonight"/"this evening" an *implied* hour, which
    // isCertain('hour') reports the same way as the implied noon of a bare
    // date — so these used to come back all-day while also carrying a real
    // start time.
    for (const [input, hour] of [
      ['dinner tonight', 22],
      ['lunch this evening', 20],
      ['party friday night', 20],
    ] as const) {
      const result = parseNaturalLanguage(input)
      expect(result.isAllDay, input).toBe(false)
      expect(result.startDate.getHours(), input).toBe(hour)
      expect(result.endDate, input).toBeDefined()
    }
  })

  it('still treats a bare date reference as all-day', () => {
    // The guard above keys off time-of-day words in the text chrono consumed,
    // so a date with no time part must be unaffected.
    for (const input of ['meeting tomorrow', 'standup monday', 'all hands next week']) {
      expect(parseNaturalLanguage(input).isAllDay, input).toBe(true)
    }
  })

  it('keeps "this evening" out of the title', () => {
    const result = parseNaturalLanguage('lunch this evening')
    expect(result.title).toBe('Lunch')
  })

  it('keeps "this morning" out of the title', () => {
    const result = parseNaturalLanguage('run this morning')
    expect(result.title).toBe('Run')
  })

  it('keeps "this afternoon" out of the title', () => {
    const result = parseNaturalLanguage('call this afternoon')
    expect(result.title).toBe('Call')
  })

  it('cleans a trailing "from" left by the time parser', () => {
    const result = parseNaturalLanguage('workshop from 3pm')
    expect(result.title).toBe('Workshop')
  })

  it('parses time keywords', () => {
    const result = parseNaturalLanguage('lunch at noon')
    expect(result.title).toBe('Lunch')
    expect(result.isAllDay).toBe(false)
  })

  it('detects task with todo prefix', () => {
    const result = parseNaturalLanguage('todo buy milk tomorrow')
    expect(result.isTask).toBe(true)
    expect(result.title).toBe('Buy milk')
  })

  it('detects task with task prefix', () => {
    const result = parseNaturalLanguage('task call mom')
    expect(result.isTask).toBe(true)
    expect(result.title).toBe('Call mom')
  })

  it('detects task with remind me to prefix', () => {
    const result = parseNaturalLanguage('remind me to send email')
    expect(result.isTask).toBe(true)
    expect(result.title).toBe('Send email')
  })

  it('keeps location in title', () => {
    const result = parseNaturalLanguage('Partying in Las Vegas at 11am')
    expect(result.location).toBe('Las Vegas')
    expect(result.title).toBe('Partying in Las Vegas')
  })

  it('keeps location in title with at keyword', () => {
    const result = parseNaturalLanguage('Meeting at downtown cafe')
    expect(result.location).toBe('downtown cafe')
    expect(result.title).toBe('Meeting at downtown cafe')
  })

  it('keeps location in title with in keyword', () => {
    const result = parseNaturalLanguage('climbing in hvidovre tomorrow at 12')
    expect(result.location).toBe('hvidovre')
    expect(result.title).toBe('Climbing in hvidovre')
  })

  it('parses time range with "between X-Y"', () => {
    const result = parseNaturalLanguage('swimming with friends tomorrow, between 17-18')
    expect(result.title).toBe('Swimming with friends')
    expect(result.startDate).toBeDefined()
    expect(result.endDate).toBeDefined()
    expect(result.isAllDay).toBe(false)
  })

  it('parses time range with "between X and Y"', () => {
    const result = parseNaturalLanguage('swimming with friends tomorrow, between 17 and 18')
    expect(result.title).toBe('Swimming with friends')
    expect(result.startDate).toBeDefined()
    expect(result.endDate).toBeDefined()
    expect(result.isAllDay).toBe(false)
  })

  it('parses time range without comma', () => {
    const result = parseNaturalLanguage('swimming with friends tomorrow between 17 and 18')
    expect(result.title).toBe('Swimming with friends')
    expect(result.startDate).toBeDefined()
    expect(result.endDate).toBeDefined()
    expect(result.isAllDay).toBe(false)
  })

  it('parses ordinal date without month', () => {
    const result = parseNaturalLanguage('dentist on the 15th')
    expect(result.title).toBe('Dentist')
    expect(result.isAllDay).toBe(true)
  })

  it('parses ordinal date with day only', () => {
    const result = parseNaturalLanguage('appointment on 21st')
    expect(result.title).toBe('Appointment')
    expect(result.isAllDay).toBe(true)
  })

  it('parses time range with between without date', () => {
    const result = parseNaturalLanguage('meeting between 17 and 18')
    expect(result.title).toBe('Meeting')
    expect(result.startDate).toBeDefined()
    expect(result.endDate).toBeDefined()
    expect(result.isAllDay).toBe(false)
  })

  it('extracts recurrence for every weekday', () => {
    const result = parseNaturalLanguage('team standup every weekday at 9am')
    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('weekly')
    expect(result.recurrence?.byWeekday).toEqual([1, 2, 3, 4, 5])
  })
})
