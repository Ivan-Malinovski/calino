import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddCalendarModal } from '../AddCalendarModal'
import { CalDAVConnectionError } from '@/features/caldav/client/errors'

const mockAddAccount = vi.fn().mockResolvedValue(undefined)
const mockUpdateAccount = vi.fn().mockResolvedValue(undefined)

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({
    addAccount: mockAddAccount,
    updateAccount: mockUpdateAccount,
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

    // onClose fires after the exit animation completes.
    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1))
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<AddCalendarModal isOpen={true} onClose={handleClose} />)

    await user.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1))
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(<AddCalendarModal isOpen={true} onClose={handleClose} />)

    const backdrop = screen.getByRole('dialog').parentElement
    if (backdrop) {
      await user.click(backdrop)
    }

    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1))
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
        'testuser',
        undefined
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
        'My Server',
        undefined
      )
    })

    vi.unstubAllGlobals()
  })

  it('surfaces the error and hint when addAccount fails to connect', async () => {
    const user = userEvent.setup()

    // The modal no longer probes ahead of the submit — addAccount does the
    // single probe and throws with the reason and any provider guidance.
    mockAddAccount.mockRejectedValue(
      new CalDAVConnectionError('Server returned status 401', 'Needs an app-specific password')
    )

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/server url/i), 'https://bad.example.com')
    await user.type(screen.getByLabelText(/username/i), 'baduser')
    await user.type(screen.getByLabelText(/password/i), 'wrongpass')

    await user.click(screen.getByRole('button', { name: /add calendar/i }))

    // The status code is explained rather than shown: "Server returned status
    // 401" tells a user nothing actionable.
    await waitFor(() => {
      expect(screen.getByText(/rejected these credentials/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/401/)).not.toBeInTheDocument()
    expect(screen.getByText(/app-specific password/i)).toBeInTheDocument()

    // The modal stays open so the user can correct the credentials.
    expect(screen.getByText('Add CalDAV Calendar')).toBeInTheDocument()
  })

  it('shows a saving spinner and blocks a double-submit while addAccount is in flight', async () => {
    const user = userEvent.setup()

    let resolveAdd: () => void = () => {}
    mockAddAccount.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAdd = resolve
        })
    )

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/server url/i), 'https://caldav.example.com')
    await user.type(screen.getByLabelText(/username/i), 'testuser')
    await user.type(screen.getByLabelText(/password/i), 'password123')

    const form = screen.getByRole('dialog').querySelector('form') as HTMLFormElement

    // Two submits in the same tick, before React can re-render the button as
    // disabled — this is what a double-tap actually looks like. Only the
    // synchronous ref guard stops the second one.
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(mockAddAccount).toHaveBeenCalledTimes(1)

    const savingButton = await screen.findByRole('button', { name: /saving/i })
    expect(savingButton).toBeDisabled()
    expect(savingButton).toHaveAttribute('aria-busy', 'true')

    resolveAdd()
    await waitFor(() => expect(mockAddAccount).toHaveBeenCalledTimes(1))
  })

  it('renders hint text for server URL', () => {
    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByText(/full url of your caldav server/i)).toBeInTheDocument()
  })
})
