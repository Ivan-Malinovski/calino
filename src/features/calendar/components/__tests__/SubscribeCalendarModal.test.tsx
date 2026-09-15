import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubscribeCalendarModal } from '../SubscribeCalendarModal'

const mockAddSubscription = vi.fn().mockResolvedValue(undefined)
const mockUpdateSubscription = vi.fn().mockResolvedValue(undefined)

const modalProps = {
  addSubscription: mockAddSubscription,
  updateSubscription: mockUpdateSubscription,
}

describe('SubscribeCalendarModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAddSubscription.mockReset().mockResolvedValue(undefined)
    mockUpdateSubscription.mockReset().mockResolvedValue(undefined)
  })

  it('renders modal when open', () => {
    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} {...modalProps} />)
    expect(screen.getByText('Subscribe to Calendar')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<SubscribeCalendarModal isOpen={false} onClose={() => {}} {...modalProps} />)
    expect(screen.queryByText('Subscribe to Calendar')).not.toBeInTheDocument()
  })

  it('renders form fields', () => {
    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} {...modalProps} />)
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/calendar url/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/refresh/i)).toBeInTheDocument()
  })

  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<SubscribeCalendarModal isOpen={true} onClose={handleClose} {...modalProps} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1))
  })

  it('shows a validation error when submitting without a URL', async () => {
    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} {...modalProps} />)

    const form = screen.getByRole('dialog').querySelector('form') as HTMLFormElement
    fireEvent.submit(form)

    expect(mockAddSubscription).not.toHaveBeenCalled()
  })

  it('submits the form with the entered URL and defaults', async () => {
    const user = userEvent.setup()

    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} {...modalProps} />)

    await user.type(screen.getByLabelText(/calendar url/i), 'webcal://example.com/cal.ics')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(mockAddSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'webcal://example.com/cal.ics',
          name: 'Subscribed calendar',
          refreshIntervalMinutes: 60,
        })
      )
    })
  })

  it('surfaces an error when addSubscription fails', async () => {
    const user = userEvent.setup()
    mockAddSubscription.mockRejectedValue(
      new Error('That URL did not return a valid iCalendar (.ics) file.')
    )

    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} {...modalProps} />)

    await user.type(screen.getByLabelText(/calendar url/i), 'https://example.com/not-ics')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByText(/did not return a valid iCalendar/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Subscribe to Calendar')).toBeInTheDocument()
  })

  it('defaults mute on so new subscriptions do not notify', async () => {
    const user = userEvent.setup()
    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} {...modalProps} />)

    expect(screen.getByRole('checkbox', { name: /mute reminders/i })).toBeChecked()

    await user.type(screen.getByLabelText(/calendar url/i), 'https://example.com/cal.ics')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(mockAddSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ notifyReminders: false })
      )
    })
  })

  it('edit mode prefills the subscription and saves through updateSubscription', async () => {
    const user = userEvent.setup()
    const { useCalendarStore } = await import('@/store/calendarStore')
    useCalendarStore.getState().addCalendar({
      id: 'cal-sub-1',
      name: 'Holidays',
      color: '#4285F4',
      isVisible: true,
      isDefault: false,
      showTasksInViews: true,
      source: 'webcal',
      readOnly: true,
    })

    render(
      <SubscribeCalendarModal
        isOpen={true}
        onClose={() => {}}
        mode="edit"
        subscription={{
          id: 'sub-1',
          calendarId: 'cal-sub-1',
          name: 'Holidays',
          url: 'https://example.com/holidays.ics',
          refreshIntervalMinutes: 60,
          proxyUrl: null,
          lastFetchedAt: null,
          lastError: null,
        }}
        {...modalProps}
      />
    )

    expect(screen.getByRole('heading', { name: 'Edit subscription' })).toBeInTheDocument()
    expect(screen.getByLabelText(/calendar url/i)).toHaveValue('https://example.com/holidays.ics')
    expect(screen.getByRole('checkbox', { name: /mute reminders/i })).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: /mute reminders/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(mockUpdateSubscription).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ notifyReminders: true, url: 'https://example.com/holidays.ics' })
      )
    })
    expect(mockAddSubscription).not.toHaveBeenCalled()
  })
})
