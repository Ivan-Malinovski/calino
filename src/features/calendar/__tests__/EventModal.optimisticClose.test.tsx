import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EventModal } from '../components/EventModal'
import { useCalendarStore } from '@/store/calendarStore'
import { showToast } from '@/lib/toast'

/**
 * The save path with the CalDAV write held open on purpose.
 *
 * The other EventModal specs run against the real hook, whose writes resolve
 * immediately when no account is configured — which cannot distinguish "closed
 * optimistically" from "closed after a very fast round trip". Here the write is
 * a deferred the test resolves (or rejects) by hand, so the close and the
 * failure report can be observed independently of each other.
 */

let pendingCreate: {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

const createEvent = vi.fn(() => pendingCreate.promise)

vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }))

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({
    createEvent,
    updateEvent: vi.fn(async () => {}),
    saveRecurrenceOverride: vi.fn(async () => {}),
    deleteEvent: vi.fn(async () => {}),
  }),
}))

function openWithTitle(title: string): void {
  const store = useCalendarStore.getState()
  store.openModal()
  render(<EventModal />)
  fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: title } })
  fireEvent.click(screen.getByRole('button', { name: /create/i }))
}

describe('EventModal optimistic close', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
    store.addCalendar({
      id: 'default',
      name: 'Default Calendar',
      color: '#4285F4',
      isVisible: true,
      isDefault: true,
      showTasksInViews: true,
    })
    store.closeModal()

    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = (error) => rej(error)
    })
    // Nothing awaits this until the assertions do; an unhandled rejection
    // between the reject and the modal's catch would fail the run otherwise.
    promise.catch(() => {})
    pendingCreate = { promise, resolve, reject }
  })

  it('closes the modal before the save promise resolves', async () => {
    openWithTitle('Pending Save')

    // The write was started and is still pending...
    expect(createEvent).toHaveBeenCalledTimes(1)
    // ...yet the modal is already gone and the event is already on the calendar.
    expect(useCalendarStore.getState().isModalOpen).toBe(false)
    expect(screen.queryByPlaceholderText('Event title')).not.toBeInTheDocument()
    expect(useCalendarStore.getState().events.some((e) => e.title === 'Pending Save')).toBe(true)

    pendingCreate.resolve()
    await pendingCreate.promise
  })

  it('reports a rejected save by toast, with the modal still closed', async () => {
    openWithTitle('Doomed Save')

    expect(useCalendarStore.getState().isModalOpen).toBe(false)

    pendingCreate.reject(new Error('server said no'))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync with CalDAV server')
      )
    })

    // The failure must not drag the user back into the modal, and the local
    // copy of the event stays put so the edit isn't lost.
    expect(useCalendarStore.getState().isModalOpen).toBe(false)
    expect(useCalendarStore.getState().events.some((e) => e.title === 'Doomed Save')).toBe(true)
  })
})
