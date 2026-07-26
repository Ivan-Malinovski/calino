import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubscribeCalendarModal } from '../SubscribeCalendarModal'

const mockAddSubscription = vi.fn().mockResolvedValue(undefined)

vi.mock('@/features/webcal/hooks/useWebcalSubscriptions', () => ({
  useWebcalSubscriptions: () => ({
    subscriptions: [],
    addSubscription: mockAddSubscription,
    removeSubscription: vi.fn(),
    syncSubscription: vi.fn(),
    syncAll: vi.fn(),
  }),
}))

describe('SubscribeCalendarModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAddSubscription.mockReset().mockResolvedValue(undefined)
  })

  it('renders modal when open', () => {
    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Subscribe to Calendar')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<SubscribeCalendarModal isOpen={false} onClose={() => {}} />)
    expect(screen.queryByText('Subscribe to Calendar')).not.toBeInTheDocument()
  })

  it('renders form fields', () => {
    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/calendar url/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/refresh/i)).toBeInTheDocument()
  })

  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<SubscribeCalendarModal isOpen={true} onClose={handleClose} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1))
  })

  it('shows a validation error when submitting without a URL', async () => {
    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} />)

    const form = screen.getByRole('dialog').querySelector('form') as HTMLFormElement
    fireEvent.submit(form)

    expect(mockAddSubscription).not.toHaveBeenCalled()
  })

  it('submits the form with the entered URL and defaults', async () => {
    const user = userEvent.setup()

    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} />)

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

    render(<SubscribeCalendarModal isOpen={true} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/calendar url/i), 'https://example.com/not-ics')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByText(/did not return a valid iCalendar/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Subscribe to Calendar')).toBeInTheDocument()
  })
})
