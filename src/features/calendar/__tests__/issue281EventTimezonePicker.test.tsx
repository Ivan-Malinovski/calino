import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { toEventInstant } from '@/lib/datetime'
import { homeZoneTimes } from '@/features/calendar/lib/homeZoneTimes'

/**
 * Issue #281 — a time zone picker on events. The date/time fields are wall
 * clocks in the picked zone, the event is stored with that TZID, and a line
 * under the fields shows the same times on the home clock.
 *
 * Home is pinned to Copenhagen so the expected strings do not depend on which
 * vitest project (device zone) runs this.
 */

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      return (
        <div ref={ref} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
          {children as React.ReactNode}
        </div>
      )
    }),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMotionValue: (initial: number) => {
    const value = initial
    return { get: () => value, set: () => {}, on: () => () => {} }
  },
  animate: () => ({ stop: () => {} }),
}))

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({
    syncAll: vi.fn(),
    createEvent: vi.fn().mockResolvedValue(undefined),
    updateEvent: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/features/nlp', () => ({
  parseNaturalLanguage: vi.fn().mockReturnValue({
    title: '',
    confidence: 0,
    startDate: new Date(),
    endDate: null,
    location: null,
    isAllDay: false,
    isTask: false,
  }),
}))

const CALENDAR = {
  id: 'default',
  name: 'Cal',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
}

async function pickZone(query: string): Promise<void> {
  const picker = screen.getByRole('combobox', { name: 'Time zone' })
  await act(async () => {
    fireEvent.focus(picker)
  })
  await act(async () => {
    fireEvent.change(picker, { target: { value: query } })
  })
  await act(async () => {
    fireEvent.keyDown(picker, { key: 'Enter' })
  })
}

describe('issue 281 — event time zone picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      timeFormat: '24h',
      dateFormat: 'MM/dd/yyyy',
      homeTimezone: 'Europe/Copenhagen',
    })
    useCalendarStore.setState({
      events: [],
      calendars: [CALENDAR],
      categories: [],
      isModalOpen: true,
      selectedEventId: null,
      selectedDate: '2026-08-03T09:00',
      selectedEndDate: '2026-08-03T10:00',
      selectedEventType: 'event',
    })
  })

  it('hides the picker on new events and reveals the home zone with the globe button', async () => {
    const { EventModal } = await import('@/features/calendar/components/EventModal')
    render(<EventModal />)

    expect(screen.queryByRole('combobox', { name: 'Time zone' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Time zone' }))
    expect((screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement).value).toBe(
      'Europe/Copenhagen'
    )
    expect(document.querySelector('[data-component="event-home-zone-times"]')).toBeNull()
  })

  it('creates an event at the typed wall clock in the picked zone', async () => {
    const { EventModal } = await import('@/features/calendar/components/EventModal')
    render(<EventModal />)

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Event title'), {
        target: { value: 'Tokyo dinner' },
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Time zone' }))
    await pickZone('tokyo')

    // The fields keep 09:00–10:00, now read as Tokyo time.
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('09:00')
    expect((screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement).value).toBe(
      'Tokyo (JST)'
    )
    // 09:00 Tokyo (UTC+9) is 02:00 in Copenhagen (UTC+2 in August).
    expect(document.querySelector('[data-component="event-home-zone-times"]')!.textContent).toBe(
      '02:00–03:00 in Copenhagen'
    )

    await act(async () => {
      fireEvent.click(screen.getByText('Create'))
    })

    const created = useCalendarStore.getState().events.find((e) => e.title === 'Tokyo dinner')!
    expect(created).toBeDefined()
    expect(created.timezone).toBe('Asia/Tokyo')
    expect(created.start).toBe('2026-08-03T09:00:00')
    expect(created.end).toBe('2026-08-03T10:00:00')
    expect(toEventInstant(created.start, created.timezone).toISOString()).toBe(
      '2026-08-03T00:00:00.000Z'
    )
  })

  it('re-anchors an existing event to a new zone, keeping its wall clock', async () => {
    useCalendarStore.setState({
      events: [
        {
          id: 'la-meeting',
          calendarId: 'default',
          title: 'LA meeting',
          start: '2026-08-03T09:00:00',
          end: '2026-08-03T09:30:00',
          isAllDay: false,
          timezone: 'America/Los_Angeles',
        },
      ],
      selectedEventId: 'la-meeting',
      selectedDate: null,
      selectedEndDate: null,
    })

    const { EventModal } = await import('@/features/calendar/components/EventModal')
    render(<EventModal />)

    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('09:00')
    await pickZone('london')

    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })

    const after = useCalendarStore.getState().events.find((e) => e.id === 'la-meeting')!
    expect(after.timezone).toBe('Europe/London')
    expect(after.start).toBe('2026-08-03T09:00:00')
    expect(after.end).toBe('2026-08-03T09:30:00')
  })
})

describe('homeZoneTimes', () => {
  it('is null when the form zone is home', () => {
    expect(
      homeZoneTimes(
        'Europe/Copenhagen',
        'Europe/Copenhagen',
        false,
        '2026-08-03',
        '09:00',
        '2026-08-03',
        '10:00',
        '24h'
      )
    ).toBeNull()
  })

  it('is null for all-day events', () => {
    expect(
      homeZoneTimes(
        'Asia/Tokyo',
        'Europe/Copenhagen',
        true,
        '2026-08-03',
        '00:00',
        '2026-08-03',
        '00:00',
        '24h'
      )
    ).toBeNull()
  })

  it('names the day when the home clock is on another date', () => {
    // 20:00 Los Angeles on Aug 3 is 05:00 Aug 4 in Copenhagen.
    expect(
      homeZoneTimes(
        'America/Los_Angeles',
        'Europe/Copenhagen',
        false,
        '2026-08-03',
        '20:00',
        '2026-08-03',
        '21:00',
        '24h'
      )
    ).toEqual({ zoneLabel: 'Copenhagen', times: 'Aug 4, 05:00–06:00' })
  })

  it('treats a Windows TZID alias as the zone it names', () => {
    expect(
      homeZoneTimes(
        'Romance Standard Time',
        'Europe/Paris',
        false,
        '2026-08-03',
        '09:00',
        '2026-08-03',
        '10:00',
        '24h'
      )
    ).toBeNull()
  })
})
