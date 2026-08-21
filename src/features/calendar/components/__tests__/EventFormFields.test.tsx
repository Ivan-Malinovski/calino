import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EventFormFields } from '../EventFormFields'
import { useSettingsStore } from '@/store/settingsStore'

vi.mock('@/store/settingsStore', () => {
  // AttendeeSection pulls in calendarStore, which reads settings at module
  // init — a bare vi.fn() has no getState and blows up on import.
  const useSettingsStore = Object.assign(vi.fn(), {
    getState: () => ({ defaultView: 'week', timeFormat: '24h' }),
  })
  return { useSettingsStore, EVENT_COLORS: ['#4285F4'] }
})
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn().mockReturnValue(false),
}))
vi.mock('@/hooks/useScrollInput', () => ({
  useScrollInput: vi.fn(),
}))

describe('EventFormFields', () => {
  const defaultProps = {
    isAllDay: false,
    onIsAllDayChange: vi.fn(),
    startDate: '2024-03-15',
    onStartDateChange: vi.fn(),
    startTime: '09:00',
    onStartTimeChange: vi.fn(),
    endDate: '2024-03-15',
    onEndDateChange: vi.fn(),
    endTime: '10:00',
    onEndTimeChange: vi.fn(),
    recurrence: 'weekly' as 'daily' | 'weekly' | 'monthly' | 'yearly',
    onRecurrenceChange: vi.fn(),
    recurring: true,
    onRecurringChange: vi.fn(),
    interval: 1,
    onIntervalChange: vi.fn(),
    byWeekday: [] as number[],
    onByWeekdayChange: vi.fn(),
    byMonthDay: [] as number[],
    onByMonthDayChange: vi.fn(),
    byMonth: [] as number[],
    onByMonthChange: vi.fn(),
    byDayOrdinals: [] as number[],
    onByDayOrdinalsChange: vi.fn(),
    endCondition: 'never' as 'never' | 'on' | 'after',
    onEndConditionChange: vi.fn(),
    endOnDate: '2024-03-15',
    onEndOnDateChange: vi.fn(),
    endAfterCount: 10,
    onEndAfterCountChange: vi.fn(),
    travelDuration: undefined as number | undefined,
    onTravelDurationChange: vi.fn(),
    reminders: [] as never[],
    onRemindersChange: vi.fn(),
    transparency: 'opaque' as const,
    onTransparencyChange: vi.fn(),
    relatedTo: [] as string[],
    onRelatedToChange: vi.fn(),
    candidateEvents: [] as never[],
    attachments: [] as never[],
    onAttachmentsChange: vi.fn(),
    attachmentEventId: null as string | null,
    attendees: [] as never[],
    onAttendeesChange: vi.fn(),
    organizer: undefined,
    startIso: '2026-03-10T09:00:00',
    endIso: '2026-03-10T10:00:00',
  }

  const renderWithMoreOptions = (props = {}) => {
    const utils = render(<EventFormFields {...defaultProps} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    return utils
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useSettingsStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (
        selector: (state: {
          firstDayOfWeek: number
          timeFormat: '24h'
          defaultDuration: number
        }) => unknown
      ) => selector({ firstDayOfWeek: 0, timeFormat: '24h', defaultDuration: 60 })
    )
  })

  describe('weekday selection with firstDayOfWeek=0 (Sunday)', () => {
    it('renders weekday buttons when recurrence is weekly', () => {
      renderWithMoreOptions({ recurrence: 'weekly' })
      expect(screen.getByRole('button', { name: 'Include Sun' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Include Mon' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Include Tue' })).toBeInTheDocument()
    })

    it('does not render weekday buttons when recurrence is daily', () => {
      renderWithMoreOptions({ recurrence: 'daily' })
      expect(screen.queryByRole('button', { name: 'Include Sun' })).not.toBeInTheDocument()
    })

    it('toggles weekday correctly - clicking Monday adds it to byWeekday', () => {
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({ recurrence: 'weekly', onByWeekdayChange })

      fireEvent.click(screen.getByRole('button', { name: 'Include Mon' }))
      expect(onByWeekdayChange).toHaveBeenCalledWith([1])
    })

    it('toggles weekday correctly - clicking Monday again removes it', () => {
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({ recurrence: 'weekly', byWeekday: [1], onByWeekdayChange })

      fireEvent.click(screen.getByRole('button', { name: 'Include Mon' }))
      expect(onByWeekdayChange).toHaveBeenCalledWith([])
    })

    it('selects multiple weekdays in order clicked', () => {
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({ recurrence: 'weekly', onByWeekdayChange })

      fireEvent.click(screen.getByRole('button', { name: 'Include Mon' }))
      fireEvent.click(screen.getByRole('button', { name: 'Include Fri' }))

      const calls = onByWeekdayChange.mock.calls
      expect(calls[0][0]).toEqual([1])
      expect(calls[1][0]).toEqual([5])
    })

    it('removes weekday when clicked again after selecting multiple', () => {
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({ recurrence: 'weekly', byWeekday: [1, 5], onByWeekdayChange })

      fireEvent.click(screen.getByRole('button', { name: 'Include Mon' }))

      expect(onByWeekdayChange).toHaveBeenCalledWith([5])
    })
  })

  describe('weekday selection with firstDayOfWeek=1 (Monday)', () => {
    beforeEach(() => {
      ;(useSettingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(1)
    })

    it('displays weekdays starting with Monday when firstDayOfWeek is 1', () => {
      renderWithMoreOptions({ recurrence: 'weekly' })

      const buttons = screen.getAllByRole('button', { name: /Include/i })
      expect(buttons[0]).toHaveTextContent('Mon')
      expect(buttons[1]).toHaveTextContent('Tue')
      expect(buttons[6]).toHaveTextContent('Sun')
    })

    it('correctly maps display position to actual weekday - clicking first button (Mon) should add weekday 1', () => {
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({ recurrence: 'weekly', onByWeekdayChange })

      fireEvent.click(screen.getByRole('button', { name: 'Include Mon' }))
      expect(onByWeekdayChange).toHaveBeenCalledWith([1])
    })

    it('correctly maps display position - clicking last button (Sun) should add weekday 0', () => {
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({ recurrence: 'weekly', onByWeekdayChange })

      fireEvent.click(screen.getByRole('button', { name: 'Include Sun' }))
      expect(onByWeekdayChange).toHaveBeenCalledWith([0])
    })

    it('selects Mon and Sat correctly when firstDayOfWeek is Monday', () => {
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({ recurrence: 'weekly', onByWeekdayChange })

      fireEvent.click(screen.getByRole('button', { name: 'Include Mon' }))
      fireEvent.click(screen.getByRole('button', { name: 'Include Sat' }))

      const calls = onByWeekdayChange.mock.calls
      expect(calls[0][0]).toEqual([1])
      expect(calls[1][0]).toEqual([6])
    })
  })

  describe('weekday button visual state', () => {
    it('shows selected state for checked weekdays', () => {
      renderWithMoreOptions({ recurrence: 'weekly', byWeekday: [1] })

      expect(screen.getByRole('button', { name: 'Include Mon' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByRole('button', { name: 'Include Tue' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    })
  })

  describe('Bug 60: weekday toggles for weekly recurrence', () => {
    it('shows weekday toggles for weekly recurrence, not daily', () => {
      // Weekly should show weekday toggles
      renderWithMoreOptions({ recurrence: 'weekly' })
      expect(screen.getByText('On days:')).toBeInTheDocument()

      // Go back and check daily does NOT show them
      // (We need a fresh render for this)
    })

    it('does NOT show weekday toggles for daily recurrence', () => {
      renderWithMoreOptions({ recurrence: 'daily' })
      expect(screen.queryByText('On days:')).not.toBeInTheDocument()
    })
  })

  describe('MonthlyPatternPicker', () => {
    it('renders monthly pattern picker when recurrence is monthly', () => {
      renderWithMoreOptions({ recurrence: 'monthly' })
      expect(screen.getByText('Monthly pattern')).toBeInTheDocument()
    })

    it('does not render monthly pattern picker when recurrence is weekly', () => {
      renderWithMoreOptions({ recurrence: 'weekly' })
      expect(screen.queryByText('Monthly pattern')).not.toBeInTheDocument()
    })

    it('defaults to dayOfMonth pattern when byWeekday and byDayOrdinals are empty', () => {
      renderWithMoreOptions({
        recurrence: 'monthly',
        byWeekday: [],
        byDayOrdinals: [],
      })
      expect(screen.getByDisplayValue('On day of the month')).toBeInTheDocument()
    })

    it('shows nthWeekday selectors when byWeekday and byDayOrdinals are provided', () => {
      renderWithMoreOptions({
        recurrence: 'monthly',
        byWeekday: [5],
        byDayOrdinals: [3],
      })
      expect(screen.getByDisplayValue('On the nth weekday')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Third')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Fri')).toBeInTheDocument()
    })

    it('shows lastWeekday selector when all byDayOrdinals values are -1', () => {
      renderWithMoreOptions({
        recurrence: 'monthly',
        byWeekday: [1],
        byDayOrdinals: [-1],
      })
      expect(screen.getByDisplayValue('On the last weekday')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Mon')).toBeInTheDocument()
      expect(screen.queryByDisplayValue('First')).not.toBeInTheDocument()
    })

    it('calls correct handlers when changing pattern to nthWeekday', () => {
      const onByWeekdayChange = vi.fn()
      const onByDayOrdinalsChange = vi.fn()
      const onByMonthDayChange = vi.fn()
      renderWithMoreOptions({
        recurrence: 'monthly',
        byWeekday: [],
        byDayOrdinals: [],
        onByWeekdayChange,
        onByDayOrdinalsChange,
        onByMonthDayChange,
      })

      fireEvent.change(screen.getByDisplayValue('On day of the month'), {
        target: { value: 'nthWeekday' },
      })

      expect(onByMonthDayChange).toHaveBeenCalledWith([])
      expect(onByWeekdayChange).toHaveBeenCalled()
      expect(onByDayOrdinalsChange).toHaveBeenCalled()
    })

    it('calls correct handlers when changing pattern to dayOfMonth', () => {
      const onByWeekdayChange = vi.fn()
      const onByDayOrdinalsChange = vi.fn()
      const onByMonthDayChange = vi.fn()
      renderWithMoreOptions({
        recurrence: 'monthly',
        byWeekday: [5],
        byDayOrdinals: [3],
        onByWeekdayChange,
        onByDayOrdinalsChange,
        onByMonthDayChange,
      })

      fireEvent.change(screen.getByDisplayValue('On the nth weekday'), {
        target: { value: 'dayOfMonth' },
      })

      expect(onByWeekdayChange).toHaveBeenCalledWith([])
      expect(onByDayOrdinalsChange).toHaveBeenCalledWith([])
      expect(onByMonthDayChange).toHaveBeenCalled()
    })

    it('uses Monday-first weekday order when firstDayOfWeek is 1', () => {
      ;(useSettingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(1)
      renderWithMoreOptions({
        recurrence: 'monthly',
        byWeekday: [2],
        byDayOrdinals: [1],
      })

      expect(screen.getByDisplayValue('On the nth weekday')).toBeInTheDocument()

      const weekdaySelect = screen.getByDisplayValue('Tue')
      const options = Array.from(weekdaySelect.querySelectorAll('option'))
      expect(options[0]).toHaveTextContent('Mon')
      expect(options[1]).toHaveTextContent('Tue')
      expect(options[2]).toHaveTextContent('Wed')
      expect(options[6]).toHaveTextContent('Sun')
    })

    it('correctly maps weekday option values with firstDayOfWeek=1', () => {
      ;(useSettingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(1)
      const onByWeekdayChange = vi.fn()
      renderWithMoreOptions({
        recurrence: 'monthly',
        byWeekday: [],
        byDayOrdinals: [],
        onByWeekdayChange,
      })

      fireEvent.change(screen.getByDisplayValue('On day of the month'), {
        target: { value: 'nthWeekday' },
      })

      // After changing to nthWeekday, verify the inferred weekday value
      // is correct for the start date (2024-03-15 = Friday)
      expect(onByWeekdayChange).toHaveBeenCalledWith([5])
    })
  })

  describe('Bug 8: time overflow at 24:xx (duration-preserving)', () => {
    it('wraps end time to 00:xx when start time is 23:xx', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="23:00"
          endTime="23:30"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )

      // Change start time from 23:00 to 23:30
      // The start time input is the first time input
      const startTimeInputs = screen.getAllByDisplayValue('23:00')
      const startTimeInput = startTimeInputs[0]
      fireEvent.change(startTimeInput, { target: { value: '23:30' } })

      // Issue #60: duration is preserved. Existing duration = 23:30 - 23:00 = 30 min.
      // New end = addMinutesToTimeStr('23:30', 30) = '00:00'.
      expect(onEndTimeChange).toHaveBeenCalledWith('00:00')
    })

    it('does not produce invalid 24:xx time', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="23:00"
          endTime="23:00"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )

      const startTimeInputs = screen.getAllByDisplayValue('23:00')
      fireEvent.change(startTimeInputs[0], { target: { value: '23:00' } })

      // Verify no "24:" prefix appears in any call
      const calls = onEndTimeChange.mock.calls
      for (const call of calls) {
        expect(call[0]).not.toMatch(/^24:/)
      }
    })

    it('produces correct end time for non-overflowing start times', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="09:00"
          endTime="10:00"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )

      // 09:00 < 10:00, so the condition `newStart >= endTime` is false
      const startTimeInputs = screen.getAllByDisplayValue('09:00')
      fireEvent.change(startTimeInputs[0], { target: { value: '09:00' } })

      expect(onEndTimeChange).not.toHaveBeenCalled()
    })

    it('falls back to defaultDuration (60 min) when existing duration is zero', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="14:00"
          endTime="14:00"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )

      // There are two time inputs (start and end), both showing 14:00
      const timeInputs = screen.getAllByDisplayValue('14:00')
      // The first one is the start time input
      fireEvent.change(timeInputs[0], { target: { value: '15:00' } })

      // Issue #60: existing duration is 0 (corrupt state), so we fall back to
      // defaultDuration=60 from settings. New end = addMinutesToTimeStr('15:00', 60) = '16:00'.
      expect(onEndTimeChange).toHaveBeenCalledWith('16:00')
    })
  })

  describe('compact time input', () => {
    it('normalizes a four-digit time on blur', () => {
      const onStartTimeChange = vi.fn()
      render(<EventFormFields {...defaultProps} onStartTimeChange={onStartTimeChange} />)

      const startTime = screen.getByLabelText('Start time')
      fireEvent.change(startTime, { target: { value: '1140' } })
      fireEvent.blur(startTime)

      expect(onStartTimeChange).toHaveBeenCalledWith('11:40')
    })

    it('normalizes a three-digit time on blur', () => {
      const onStartTimeChange = vi.fn()
      render(<EventFormFields {...defaultProps} onStartTimeChange={onStartTimeChange} />)

      const startTime = screen.getByLabelText('Start time')
      fireEvent.change(startTime, { target: { value: '940' } })
      fireEvent.blur(startTime)

      expect(onStartTimeChange).toHaveBeenCalledWith('09:40')
    })

    it('rejects an invalid compact time', () => {
      const onStartTimeChange = vi.fn()
      render(<EventFormFields {...defaultProps} onStartTimeChange={onStartTimeChange} />)

      const startTime = screen.getByLabelText('Start time')
      fireEvent.change(startTime, { target: { value: '2460' } })
      fireEvent.blur(startTime)

      expect(onStartTimeChange).not.toHaveBeenCalled()
      expect(startTime).toHaveValue('09:00')
    })
  })

  describe('Issue #60: duration-preserving start-time shift', () => {
    it('shifts end by the existing duration when start moves earlier', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="10:00"
          endTime="11:30"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } })
      expect(onEndTimeChange).toHaveBeenLastCalledWith('10:30')
    })

    it('shifts end by the existing duration when start moves later', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="10:00"
          endTime="11:30"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '12:00' } })
      expect(onEndTimeChange).toHaveBeenLastCalledWith('13:30')
    })

    it('falls back to defaultDuration when existing duration is zero', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="10:00"
          endTime="10:00"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '11:00' } })
      expect(onEndTimeChange).toHaveBeenLastCalledWith('12:00')
    })

    it('wraps end past midnight using addMinutesToTimeStr', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="22:00"
          endTime="23:00"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '23:30' } })
      expect(onEndTimeChange).toHaveBeenLastCalledWith('00:30')
    })

    it('does not call onEndTimeChange when start equals previous start', () => {
      const onEndTimeChange = vi.fn()
      render(
        <EventFormFields
          {...defaultProps}
          startTime="09:00"
          endTime="10:00"
          startDate="2024-03-15"
          endDate="2024-03-15"
          onEndTimeChange={onEndTimeChange}
        />
      )
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } })
      expect(onEndTimeChange).not.toHaveBeenCalled()
    })
  })

  describe('date field accessible names', () => {
    it('exposes the start and end date inputs via their associated labels', () => {
      render(<EventFormFields {...defaultProps} />)

      expect(screen.getByLabelText('Start')).toHaveValue('2024-03-15')
      expect(screen.getByLabelText('End')).toHaveValue('2024-03-15')
    })
  })
})
