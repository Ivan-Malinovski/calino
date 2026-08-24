import { describe, expect, it } from 'vitest'
import { getEventColor, getEventColorFromSources } from '../eventColor'
import type { CalendarEvent, Calendar } from '@/types'
import type { Category } from '@/types/categories'

const event: CalendarEvent = {
  id: 'event-1',
  calendarId: 'calendar-1',
  title: 'Rendering test',
  start: '2024-03-15T10:00:00',
  end: '2024-03-15T11:00:00',
  isAllDay: false,
}

const calendar: Calendar = {
  id: 'calendar-1',
  name: 'Calendar',
  color: '#123456',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
}

const category: Category = { id: 'category-1', name: 'Work', color: '#00AA00' }

describe('event color resolution', () => {
  it('preserves event, category, calendar, and default precedence', () => {
    expect(
      getEventColor(
        { ...event, color: '#AA0000', categories: ['Work'] },
        { categories: [category], calendars: [calendar], useCategoryColors: true }
      )
    ).toBe('#AA0000')

    expect(
      getEventColor(
        { ...event, categories: ['Work'] },
        { categories: [category], calendars: [calendar], useCategoryColors: true }
      )
    ).toBe('#00AA00')

    expect(
      getEventColor(event, { categories: [], calendars: [calendar], useCategoryColors: true })
    ).toBe('#123456')

    expect(getEventColor(event, { categories: [], calendars: [], useCategoryColors: true })).toBe(
      '#4285F4'
    )
  })

  it('resolves from already-selected sources', () => {
    expect(
      getEventColorFromSources(event, {
        categoryColor: '#00AA00',
        calendarColor: '#123456',
        useCategoryColors: true,
      })
    ).toBe('#00AA00')

    expect(
      getEventColorFromSources(
        { ...event, color: '#AA0000' },
        {
          categoryColor: '#00AA00',
          calendarColor: '#123456',
          useCategoryColors: true,
        }
      )
    ).toBe('#AA0000')
  })
})
