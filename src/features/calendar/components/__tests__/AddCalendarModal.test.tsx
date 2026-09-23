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
    expect(screen.getByText('Add CalDAV account')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<AddCalendarModal isOpen={false} onClose={() => {}} />)
    expect(screen.queryByText('Add CalDAV account')).not.toBeInTheDocument()
  })

  it('renders form fields', () => {
    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(screen.getByText('Add CalDAV account')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      expect(mockAddAccount).toHaveBeenCalledWith(
        'https://caldav.example.com',
        'testuser',
        'password123',
        'testuser',
        undefined,
        {}
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

    const accountNameInput = screen.getByLabelText(/display name/i)
    await user.type(accountNameInput, 'My Server')

    const serverUrlInput = screen.getByLabelText(/server url/i)
    await user.type(serverUrlInput, 'https://caldav.example.com')

    const usernameInput = screen.getByLabelText(/username/i)
    await user.type(usernameInput, 'testuser')

    const passwordInput = screen.getByLabelText(/password/i)
    await user.type(passwordInput, 'password123')

    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      expect(mockAddAccount).toHaveBeenCalledWith(
        'https://caldav.example.com',
        'testuser',
        'password123',
        'My Server',
        undefined,
        {}
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

    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    // The status code is explained rather than shown: "Server returned status
    // 401" tells a user nothing actionable.
    await waitFor(() => {
      expect(screen.getByText(/rejected these credentials/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/401/)).not.toBeInTheDocument()
    expect(screen.getByText(/app-specific password/i)).toBeInTheDocument()

    // The modal stays open so the user can correct the credentials.
    expect(screen.getByText('Add CalDAV account')).toBeInTheDocument()
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

    const savingButton = await screen.findByRole('button', { name: /connecting/i })
    expect(savingButton).toBeDisabled()
    expect(savingButton).toHaveAttribute('aria-busy', 'true')

    resolveAdd()
    await waitFor(() => expect(mockAddAccount).toHaveBeenCalledTimes(1))
  })

  it('orders display name, server URL, then credentials', () => {
    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)
    const ids = Array.from(screen.getByRole('dialog').querySelectorAll('input')).map((el) => el.id)
    expect(ids.slice(0, 4)).toEqual(['accountName', 'serverUrl', 'username', 'password'])
  })

  it('keeps proxy and custom headers in one collapsed Connection settings card', async () => {
    const user = userEvent.setup()
    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    const toggle = screen.getByRole('button', { name: /connection settings/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Optional')

    await user.click(toggle)
    const proxy = screen.getByLabelText(/proxy url/i)
    // A suggestion, not a value.
    expect(proxy).toHaveValue('')
    expect(proxy).toHaveAttribute('placeholder', 'https://proxy.calino.io')
    // No header rows until the user asks for one.
    expect(screen.queryByLabelText(/header 1 name/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add header/i })).toBeInTheDocument()

    await user.type(proxy, 'https://proxy.example.com')
    expect(toggle).toHaveTextContent('Proxy on')
  })

  it('points at a proxy after a network/CORS failure', async () => {
    const user = userEvent.setup()
    mockAddAccount.mockRejectedValue(new Error('Failed to fetch'))

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/server url/i), 'https://dav.example.org')
    await user.type(screen.getByLabelText(/username/i), 'ivan')
    await user.type(screen.getByLabelText(/password/i), 'secretpass')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    const nudge = await screen.findByRole('button', { name: /set up a proxy/i })
    expect(screen.getByRole('button', { name: /diagnose the connection/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /connection settings/i })
    expect(toggle).toHaveTextContent('A proxy may fix this')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(nudge)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByLabelText(/proxy url/i)).toHaveFocus())
  })

  it('points at custom headers after a 403 when none are set', async () => {
    const user = userEvent.setup()
    mockAddAccount.mockRejectedValue(new Error('Server returned status 403'))

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/server url/i), 'https://dav.example.org')
    await user.type(screen.getByLabelText(/username/i), 'ivan')
    await user.type(screen.getByLabelText(/password/i), 'secretpass')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await user.click(await screen.findByRole('button', { name: /add a header/i }))
    await waitFor(() => expect(screen.getByLabelText(/header 1 name/i)).toHaveFocus())
  })

  it('flags the password, not Connection settings, on an auth failure', async () => {
    const user = userEvent.setup()
    mockAddAccount.mockRejectedValue(new CalDAVConnectionError('Server returned status 401'))

    render(<AddCalendarModal isOpen={true} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/server url/i), 'https://dav.example.org')
    await user.type(screen.getByLabelText(/username/i), 'ivan')
    await user.type(screen.getByLabelText(/password/i), 'wrongpass')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await screen.findByText(/rejected these credentials/i)
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('button', { name: /set up a proxy/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connection settings/i })).toHaveTextContent(
      'Optional'
    )
  })
})
