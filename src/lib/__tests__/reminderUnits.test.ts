import { describe, it, expect } from 'vitest'
import { MAX_REMINDER_MINUTES, parseReminderInput, splitReminderMinutes } from '../reminderUnits'

describe('parseReminderInput', () => {
  it('collapses units to minutes', () => {
    expect(parseReminderInput('90', 'minutes')).toBe(90)
    expect(parseReminderInput('4', 'hours')).toBe(240)
    expect(parseReminderInput('2', 'days')).toBe(2880)
    expect(parseReminderInput('1', 'weeks')).toBe(10080)
  })

  it('accepts numbers as well as strings', () => {
    expect(parseReminderInput(15, 'minutes')).toBe(15)
  })

  it('rejects non-integers, negatives, empty strings and out-of-range values', () => {
    expect(parseReminderInput('1.5', 'minutes')).toBeNull()
    expect(parseReminderInput('-5', 'minutes')).toBeNull()
    expect(parseReminderInput('', 'minutes')).toBeNull()
    expect(parseReminderInput('abc', 'minutes')).toBeNull()
    expect(parseReminderInput('5', 'weeks')).toBeNull() // 50400 > MAX_REMINDER_MINUTES
    expect(parseReminderInput(String(MAX_REMINDER_MINUTES + 1), 'minutes')).toBeNull()
  })

  it('accepts the exact ceiling', () => {
    expect(parseReminderInput('4', 'weeks')).toBe(MAX_REMINDER_MINUTES)
  })
})

describe('splitReminderMinutes', () => {
  it('decomposes to the largest unit that divides evenly', () => {
    expect(splitReminderMinutes(10080)).toEqual({ value: 1, unit: 'weeks' })
    expect(splitReminderMinutes(2880)).toEqual({ value: 2, unit: 'days' })
    expect(splitReminderMinutes(240)).toEqual({ value: 4, unit: 'hours' })
    expect(splitReminderMinutes(90)).toEqual({ value: 90, unit: 'minutes' })
  })

  it('keeps zero in minutes', () => {
    expect(splitReminderMinutes(0)).toEqual({ value: 0, unit: 'minutes' })
  })
})
