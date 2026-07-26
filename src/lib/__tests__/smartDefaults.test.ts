import { describe, it, expect } from 'vitest'
import { keywordFromTitle, recordObservation, suggestFromStat } from '../smartDefaults'

describe('keywordFromTitle', () => {
  it('picks the first meaningful word, lowercased', () => {
    expect(keywordFromTitle('Gym session')).toBe('gym')
    expect(keywordFromTitle('  Standup ')).toBe('standup')
  })

  it('skips stop words and punctuation', () => {
    expect(keywordFromTitle('My weekly review')).toBe('weekly')
    expect(keywordFromTitle('Lunch @ Nando’s')).toBe('lunch')
  })

  it('falls back to the first token when nothing is "meaningful"', () => {
    expect(keywordFromTitle('at 5')).toBe('at')
    expect(keywordFromTitle('')).toBeNull()
  })
})

describe('recordObservation + suggestFromStat', () => {
  it('does not suggest until seen at least twice', () => {
    const once = recordObservation(undefined, 45, 'fitness')
    expect(suggestFromStat(once)).toEqual({})

    const twice = recordObservation(once, 45, 'fitness')
    expect(suggestFromStat(twice)).toEqual({ durationMinutes: 45, calendarId: 'fitness' })
  })

  it('suggests the most frequent calendar and duration', () => {
    let stat = recordObservation(undefined, 30, 'work')
    stat = recordObservation(stat, 60, 'work')
    stat = recordObservation(stat, 60, 'personal')
    stat = recordObservation(stat, 60, 'work')
    expect(suggestFromStat(stat)).toEqual({ durationMinutes: 60, calendarId: 'work' })
  })

  it('handles observations without a duration', () => {
    let stat = recordObservation(undefined, undefined, 'work')
    stat = recordObservation(stat, undefined, 'work')
    expect(suggestFromStat(stat)).toEqual({ calendarId: 'work' })
  })
})
