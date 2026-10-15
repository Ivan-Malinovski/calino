import { describe, it, expect } from 'vitest'
import { getTaskGroup } from '../taskGroups'

describe('getTaskGroup', () => {
  // Local wall clock, like the task values below.
  const now = new Date(2024, 2, 15, 11, 20)

  it('puts a timed task due today in overdue once its time passes', () => {
    expect(getTaskGroup({ dueDate: '2024-03-15T09:00:00' }, now)).toBe('overdue')
    expect(getTaskGroup({ dueDate: '2024-03-15T17:00:00' }, now)).toBe('today')
    expect(getTaskGroup({ dueDate: '2024-03-15T11:20:00' }, now)).toBe('today')
  })

  it('keeps a date-only task due today under today', () => {
    expect(getTaskGroup({ dueDate: '2024-03-15' }, now)).toBe('today')
    expect(getTaskGroup({ dueDate: '2024-03-15T00:00:00' }, now)).toBe('today')
    expect(getTaskGroup({ dueDate: '2024-03-15T09:00:00', isAllDay: true }, now)).toBe('today')
  })

  it('still groups other days by date', () => {
    expect(getTaskGroup({ dueDate: '2024-03-14T23:00:00' }, now)).toBe('overdue')
    expect(getTaskGroup({ dueDate: '2024-03-16T09:00:00' }, now)).toBe('week')
    expect(getTaskGroup({}, now)).toBe('nodate')
  })
})
