import { describe, it, expect } from 'vitest'
import { extractLocation } from '@/features/nlp/parser/extractLocation'

describe('NLP location edge cases — time-like patterns', () => {
  // "to" separator should not be treated as location
  it('"at 16 to 17"', () =>
    expect(extractLocation('hang out tomorrow at 16 to 17')).toBeUndefined())
  it('"at 4 to 5pm"', () => expect(extractLocation('meeting at 4 to 5pm')).toBeUndefined())
  it('"at 9am to 10am"', () => expect(extractLocation('call at 9am to 10am')).toBeUndefined())
  it('"at 9 to 10"', () => expect(extractLocation('meeting at 9 to 10')).toBeUndefined())
  it('"at 16:30 to 17:30"', () =>
    expect(extractLocation('meeting at 16:30 to 17:30')).toBeUndefined())
  it('"at 9:30 to 10:30"', () =>
    expect(extractLocation('meeting at 9:30 to 10:30')).toBeUndefined())

  // Dash separator (already worked)
  it('"at 16 - 17"', () => expect(extractLocation('hang out tomorrow at 16 - 17')).toBeUndefined())
  it('"at 4 - 5pm"', () => expect(extractLocation('meeting at 4 - 5pm')).toBeUndefined())

  // Should still extract real locations
  it('"at the park"', () => expect(extractLocation('meeting at the park tomorrow')).toBe('park'))
  it('"at Starbucks"', () =>
    expect(extractLocation('coffee at Starbucks tomorrow')).toBe('Starbucks'))
  it('"at the office"', () => expect(extractLocation('meeting at the office today')).toBe('office'))
  it('"in the conference room"', () =>
    expect(extractLocation('call in the conference room at 3pm')).toBe('conference room'))

  // No preposition — should not extract
  it('no preposition', () => expect(extractLocation('hang out tomorrow')).toBeUndefined())

  // Single number after "at"
  it('"at 5"', () => expect(extractLocation('call at 5 tomorrow')).toBeUndefined())
})
