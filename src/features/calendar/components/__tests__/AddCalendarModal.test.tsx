import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddCalendarModal } from '../AddCalendarModal'

const mockAddAccount = vi.fn().mockResolvedValue(undefined)

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({
    addAccount: mockAddAccount,
  }),
}))

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: {
    getState: () => ({
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      addCalendar: vi.fn(),
      deleteCalendar: vi.fn(),
      calendars: [],
      events: [],
    }),
  },
}))

describe('AddCalendarModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAddAccount.mockReset()
  })

  it('renders modal when open', () => {
    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Add CalDAV Calendar')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<AddCalendarModal isOpen={false} onClose={() => {}} />)
    expect(screen.queryByText('Add CalDAV Calendar')).not.toBeInTheDocument()
  })

  it('renders form fields', () => {
    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByLabelText(/account name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<AddCalendarModal isOpen={true} onClose={handleClose} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<AddCalendarModal isOpen={true} onClose={handleClose} />)

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<AddCalendarModal isOpen={true} onClose={handleClose} />)

    const backdrop = screen.getByRole('dialog').parentElement
    if (backdrop) {
      await user.click(backdrop)
    }

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('shows validation error when submitting empty form', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<AddCalendarModal isOpen={true} onClose={handleClose} />)

    await user.click(screen.getByRole('button', { name: /add calendar/i }))

    expect(screen.getByText('Add CalDAV Calendar')).toBeInTheDocument()
  })

  it('validates required fields', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 207,
      })
    )

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    const serverUrlInput = screen.getByLabelText(/server url/i)
    await user.type(serverUrlInput, 'https://caldav.example.com')

    const usernameInput = screen.getByLabelText(/username/i)
    await user.type(usernameInput, 'testuser')

    const passwordInput = screen.getByLabelText(/password/i)
    await user.type(passwordInput, 'password123')

    await user.click(screen.getByRole('button', { name: /add calendar/i }))

    await waitFor(() => {
      expect(mockAddAccount).toHaveBeenCalledWith(
        'https://caldav.example.com',
        'testuser',
        'password123',
        'testuser'
      )
    })

    vi.unstubAllGlobals()
  })

  it('uses account name when provided', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 207,
      })
    )

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    const accountNameInput = screen.getByLabelText(/account name/i)
    await user.type(accountNameInput, 'My Server')

    const serverUrlInput = screen.getByLabelText(/server url/i)
    await user.type(serverUrlInput, 'https://caldav.example.com')

    const usernameInput = screen.getByLabelText(/username/i)
    await user.type(usernameInput, 'testuser')

    const passwordInput = screen.getByLabelText(/password/i)
    await user.type(passwordInput, 'password123')

    await user.click(screen.getByRole('button', { name: /add calendar/i }))

    await waitFor(() => {
      expect(mockAddAccount).toHaveBeenCalledWith(
        'https://caldav.example.com',
        'testuser',
        'password123',
        'My Server'
      )
    })

    vi.unstubAllGlobals()
  })

  it('shows error message on connection failure', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      })
    )

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    const serverUrlInput = screen.getByLabelText(/server url/i)
    await user.type(serverUrlInput, 'https://bad.example.com')

    const usernameInput = screen.getByLabelText(/username/i)
    await user.type(usernameInput, 'baduser')

    const passwordInput = screen.getByLabelText(/password/i)
    await user.type(passwordInput, 'wrongpass')

    await user.click(screen.getByRole('button', { name: /add calendar/i }))

    await waitFor(() => {
      expect(screen.getByText(/401/i)).toBeInTheDocument()
    })

    expect(mockAddAccount).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('disables submit button while testing', async () => {
    const user = userEvent.setup()

    let resolveFetch: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          })
      )
    )

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    const serverUrlInput = screen.getByLabelText(/server url/i)
    await user.type(serverUrlInput, 'https://caldav.example.com')

    const usernameInput = screen.getByLabelText(/username/i)
    await user.type(usernameInput, 'testuser')

    const passwordInput = screen.getByLabelText(/password/i)
    await user.type(passwordInput, 'password123')

    const submitButton = screen.getByRole('button', { name: /add calendar/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled()
    })

    resolveFetch!({ ok: true, status: 207 } as Response)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add calendar/i })).toBeEnabled()
    })

    vi.unstubAllGlobals()
  })

  it('renders hint text for server URL', () => {
    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByText(/full url of your caldav server/i)).toBeInTheDocument()
  })
})
