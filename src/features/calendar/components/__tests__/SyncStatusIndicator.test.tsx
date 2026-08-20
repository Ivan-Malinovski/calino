import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncStatusIndicator } from '../SyncStatusIndicator'
import { addPendingChange, clearPendingChanges } from '@/features/caldav/sync/accountStorage'
import { createLocalStorageMock } from '@/test/storageMock'

const mockRetry = vi.fn().mockResolvedValue({ succeeded: 0, failed: 0 })
const mockToast = vi.fn()

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({ retryAllFailedSyncs: mockRetry }),
}))
vi.mock('@/lib/toast', () => ({ showToast: (...args: unknown[]) => mockToast(...args) }))

const storage = createLocalStorageMock()

// The queue and the browser's online flag both live outside React, so changing
// them mid-test has to be announced like any other external store write.
function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  })
}

function queue(count: number): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      addPendingChange({ type: 'update', eventId: `event-${i}`, calendarId: 'cal-1' })
    }
  })
}

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRetry.mockResolvedValue({ succeeded: 0, failed: 0 })
    storage.install()
    storage.reset()
    clearPendingChanges()
    setOnline(true)
  })
  afterEach(() => {
    setOnline(true)
  })

  it('says nothing when online with an empty queue', () => {
    const { container } = render(<SyncStatusIndicator />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reports how many changes are waiting', () => {
    queue(3)
    render(<SyncStatusIndicator />)
    expect(screen.getByText('3 changes waiting')).toBeInTheDocument()
  })

  it('counts one change in the singular', () => {
    queue(1)
    render(<SyncStatusIndicator />)
    expect(screen.getByText('1 change waiting')).toBeInTheDocument()
  })

  it('explains an empty queue while offline, with nothing to retry', () => {
    render(<SyncStatusIndicator />)
    setOnline(false)
    expect(screen.getByText(/Offline — changes will send when you reconnect/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('hides the retry while offline, since it would only fail', () => {
    queue(2)
    render(<SyncStatusIndicator />)
    setOnline(false)
    expect(screen.getByText('2 changes waiting — offline')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('retries on demand and reports what got through', async () => {
    const user = userEvent.setup()
    queue(2)
    mockRetry.mockResolvedValue({ succeeded: 1, failed: 1 })
    render(<SyncStatusIndicator />)

    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(mockRetry).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('1 sent, 1 still waiting'))
  })

  it('disappears as the queue drains', () => {
    queue(1)
    render(<SyncStatusIndicator />)
    expect(screen.getByText('1 change waiting')).toBeInTheDocument()

    act(() => clearPendingChanges())
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument()
  })
})
