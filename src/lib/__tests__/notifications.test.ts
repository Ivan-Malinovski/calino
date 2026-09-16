import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEffectiveReminders, showNotification } from '../notifications'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent } from '@/types'

describe('browser notifications', () => {
  const instances: Array<{ title: string; options: Record<string, unknown> }> = []

  class MockNotification {
    static permission = 'granted'
    onclick: (() => void) | null = null

    constructor(title: string, options: Record<string, unknown>) {
      instances.push({ title, options })
    }

    close(): void {}
  }

  beforeEach(() => {
    instances.length = 0
    vi.stubGlobal('Notification', MockNotification)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the packaged app icon for browser reminders', () => {
    showNotification('Event', 'Starts soon', 'event-1', '2026-08-29T10:00:00.000Z')

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
    })
  })
})

describe('getEffectiveReminders', () => {
  const reminder = { id: 'r1', minutesBefore: 10, method: 'popup' as const }
  const event: CalendarEvent = {
    id: 'evt-1',
    calendarId: 'webcal-1',
    title: "Someone else's thing",
    start: '2026-09-16T09:00:00.000Z',
    end: '2026-09-16T10:00:00.000Z',
    isAllDay: false,
    reminders: [reminder],
  }

  afterEach(() => {
    useCalendarStore.setState({
      calendars: useCalendarStore.getState().calendars.filter((c) => c.id !== 'webcal-1'),
    })
  })

  it('returns the event reminders for a CalDAV calendar', () => {
    expect(getEffectiveReminders({ ...event, calendarId: 'default' })).toEqual([reminder])
  })

  it('mutes a webcal calendar that has not opted in', () => {
    expect(
      getEffectiveReminders(event, {
        id: 'webcal-1',
        name: 'Overlay',
        color: '#4285F4',
        isVisible: true,
        isDefault: false,
        showTasksInViews: true,
        source: 'webcal',
        readOnly: true,
      })
    ).toEqual([])
  })

  it('fires when the webcal calendar opted in', () => {
    expect(
      getEffectiveReminders(event, {
        id: 'webcal-1',
        name: 'Overlay',
        color: '#4285F4',
        isVisible: true,
        isDefault: false,
        showTasksInViews: true,
        source: 'webcal',
        readOnly: true,
        notifyReminders: true,
      })
    ).toEqual([reminder])
  })

  it('looks the calendar up in the store when none is passed', () => {
    useCalendarStore.getState().addCalendar({
      id: 'webcal-1',
      name: 'Overlay',
      color: '#4285F4',
      isVisible: true,
      isDefault: false,
      showTasksInViews: true,
      source: 'webcal',
      readOnly: true,
    })
    expect(getEffectiveReminders(event)).toEqual([])
  })
})
