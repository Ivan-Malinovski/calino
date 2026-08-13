import { describe, it, expect } from 'vitest'
import { parseNaturalLanguage } from '@/features/nlp/parser/NLParser'

describe('NLP parser improvements', () => {
  it('16 to 17 → correct time range', () => {
    const r = parseNaturalLanguage('hang out tomorrow at 16 to 17')
    expect(r.title).toBe('Hang out')
    expect(r.location).toBeUndefined()
    // Local hours, not UTC: the parser reads "16" as a wall-clock time, so
    // asserting UTC would only be restating the runner's offset.
    expect(r.startDate?.getHours()).toBe(16)
    expect(r.endDate?.getHours()).toBe(17)
  })

  it('3pm to 5pm → correct time range', () => {
    const r = parseNaturalLanguage('meeting from 3pm to 5pm')
    expect(r.title).toBe('Meeting')
    expect(r.location).toBeUndefined()
    expect(r.startDate?.getHours()).toBe(15)
    expect(r.endDate?.getHours()).toBe(17)
  })

  it('meeting at 3pm for 2 hours → clean title, no location', () => {
    const r = parseNaturalLanguage('meeting at 3pm for 2 hours')
    expect(r.title).toBe('Meeting')
    expect(r.location).toBeUndefined()
    expect(r.duration).toBe(120)
  })

  it('hang out at 16 to 17 at the park → location is park', () => {
    const r = parseNaturalLanguage('hang out at 16 to 17 at the park')
    expect(r.title).toBe('Hang out at the park')
    expect(r.location).toBe('park')
  })

  it('dentist at 14:30 → correct time, no location', () => {
    const r = parseNaturalLanguage('dentist at 14:30')
    expect(r.title).toBe('Dentist')
    expect(r.location).toBeUndefined()
    expect(r.startDate?.getHours()).toBe(14)
    expect(r.startDate?.getMinutes()).toBe(30)
  })

  it('gym 5pm-6pm → correct time range', () => {
    const r = parseNaturalLanguage('gym 5pm-6pm')
    expect(r.title).toBe('Gym')
    expect(r.location).toBeUndefined()
    expect(r.startDate?.getHours()).toBe(17)
    expect(r.endDate?.getHours()).toBe(18)
  })

  it('standup daily at 9am to 9:30am → correct time range with recurrence', () => {
    const r = parseNaturalLanguage('standup daily at 9am to 9:30am')
    expect(r.title).toBe('Standup daily')
    expect(r.location).toBeUndefined()
    expect(r.startDate?.getHours()).toBe(9)
    expect(r.endDate?.getHours()).toBe(9)
    expect(r.endDate?.getMinutes()).toBe(30)
    expect(r.recurrence?.frequency).toBe('daily')
  })
})
