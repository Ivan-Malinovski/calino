import { describe, it, expect, beforeEach } from 'vitest'
import { NLParser } from '../NLParser'

describe('NLParser - Bug #89: recurrence should not destroy endDate/duration', () => {
  let parser: NLParser

  beforeEach(() => {
    // Use a fixed reference date so tests are deterministic
    parser = new NLParser({
      defaultDate: new Date('2026-05-27T10:00:00'),
      defaultDuration: 60,
    })
  })

  it('preserves endDate and duration for a recurring event with explicit time range', () => {
    const result = parser.parse('meeting daily from 2pm to 3pm')

    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('daily')
    expect(result.endDate).toBeDefined()
    expect(result.duration).toBeDefined()
    expect(result.duration).toBeGreaterThan(0)
  })

  it('preserves endDate and duration for "every week" with a duration', () => {
    const result = parser.parse('yoga every week for 90 minutes')

    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('weekly')
    expect(result.duration).toBe(90)
    expect(result.endDate).toBeDefined()
  })

  it('preserves duration when recurrence is detected from "weekdays" keyword', () => {
    // "weekday desk" previously matched \bweekdays?\b and destroyed endDate/duration
    const result = parser.parse('weekday desk meeting at 10am for 30 minutes')

    // "weekday" matches the recurrence pattern
    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('weekly')

    // Duration should be preserved (not cleared)
    expect(result.duration).toBe(30)
  })

  it('preserves endDate when a chrono-parsed time range exists alongside recurrence', () => {
    const result = parser.parse('standup daily at 9am to 9:30am')

    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('daily')
    expect(result.endDate).toBeDefined()
    // endDate should be after startDate
    expect(result.endDate!.getTime()).toBeGreaterThan(result.startDate.getTime())
  })

  it('sets recurrence and still returns valid startDate', () => {
    const result = parser.parse('lunch every day')

    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('daily')
    expect(result.startDate).toBeInstanceOf(Date)
    expect(result.startDate.getTime()).toBeGreaterThan(0)
  })

  it('non-recurring event has no recurrence but still has endDate/duration', () => {
    const result = parser.parse('meeting tomorrow at 2pm for 1 hour')

    expect(result.recurrence).toBeUndefined()
    expect(result.endDate).toBeDefined()
    expect(result.duration).toBe(60)
  })

  it('preserves byWeekday for "every weekday"', () => {
    const result = parser.parse('standup every weekday at 10am')

    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('weekly')
    expect(result.recurrence?.byWeekday).toEqual([1, 2, 3, 4, 5])
    expect(result.endDate).toBeDefined()
  })

  it('treats plain "every <weekday>" as a weekly series on that day', () => {
    // The pattern list had no entry for this, so it produced no recurrence at
    // all and quick-add created a single event on that weekday.
    const result = parser.parse('gym every monday')
    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('weekly')
    expect(result.recurrence?.interval).toBe(1)
    expect(result.recurrence?.byWeekday).toEqual([1])
  })

  it('accepts the plural "every sundays" form', () => {
    expect(parser.parse('brunch every sundays').recurrence?.byWeekday).toEqual([0])
  })

  it('leaves a one-off weekday reference alone', () => {
    // "lunch monday" is a date, not a series — no recurrence may be invented.
    expect(parser.parse('lunch monday').recurrence).toBeUndefined()
  })

  it('treats "every other day" as a daily series with interval 2', () => {
    const result = parser.parse('gym every other day')
    expect(result.recurrence).toBeDefined()
    expect(result.recurrence?.frequency).toBe('daily')
    expect(result.recurrence?.interval).toBe(2)
  })

  it('treats "every other week" as a weekly series with interval 2', () => {
    const result = parser.parse('standup every other week')
    expect(result.recurrence?.frequency).toBe('weekly')
    expect(result.recurrence?.interval).toBe(2)
  })

  it('treats "every other month" as a monthly series with interval 2', () => {
    const result = parser.parse('bill every other month')
    expect(result.recurrence?.frequency).toBe('monthly')
    expect(result.recurrence?.interval).toBe(2)
  })

  it('treats "every other monday" as a weekly interval-2 series on Monday', () => {
    const result = parser.parse('review every other monday')
    expect(result.recurrence?.frequency).toBe('weekly')
    expect(result.recurrence?.interval).toBe(2)
    expect(result.recurrence?.byWeekday).toEqual([1])
  })

  it('cleans a "starting at" phrase from the title', () => {
    const result = parser.parse('meeting starting at 3pm')
    expect(result.title).toBe('Meeting')
    expect(result.startDate.getHours()).toBe(15)
  })

  it('cleans a "beginning at" phrase from the title', () => {
    const result = parser.parse('gym beginning at 5pm')
    expect(result.title).toBe('Gym')
  })
})

describe('NLParser - recurrence phrases stay out of the title', () => {
  const parse = (input: string) => new NLParser().parse(input)

  it.each([
    ['gym every other day', 'Gym'],
    ['fitness every other day', 'Fitness'],
    ['gym every monday', 'Gym'],
    ['review every other monday', 'Review'],
    ['standup every weekday', 'Standup'],
    ['payday monthly', 'Payday'],
  ])('%s → %s', (input, title) => {
    const result = parse(input)
    expect(result.title).toBe(title)
    expect(result.recurrence).toBeDefined()
  })

  it('leaves non-recurring titles alone', () => {
    expect(parse('everyday carry review tomorrow').title).toBe('Everyday carry review')
  })
})
