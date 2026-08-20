import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWebcalSubscriptions } from '../useWebcalSubscriptions'
import { useProgressStore, type ProgressTask } from '@/store/progressStore'

vi.mock('../../fetchWebcal', async () => {
  const actual = await vi.importActual<typeof import('../../fetchWebcal')>('../../fetchWebcal')
  return { ...actual, fetchWebcalIcs: vi.fn(async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR') }
})

vi.mock('../../subscriptionStorage', () => ({
  getAllSubscriptions: vi.fn(() => []),
  getSubscriptionById: vi.fn(),
  saveSubscription: vi.fn((input: Record<string, unknown>) => ({ id: 'sub-1', ...input })),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
}))

import * as storage from '../../subscriptionStorage'

/** Every task list the store passed through, so we can assert on transient state. */
function recordTasks(): ProgressTask[][] {
  const seen: ProgressTask[][] = []
  useProgressStore.subscribe((state) => seen.push(state.tasks))
  return seen
}

describe('useWebcalSubscriptions progress reporting', () => {
  beforeEach(() => {
    useProgressStore.setState({ tasks: [] })
    vi.mocked(storage.getAllSubscriptions).mockReturnValue([])
  })

  it('reports a task while adding a subscription and clears it afterwards', async () => {
    const seen = recordTasks()
    const { result } = renderHook(() => useWebcalSubscriptions())

    await act(async () => {
      await result.current.addSubscription({
        url: 'webcal://example.com/cal.ics',
        name: 'Feed',
        color: '#4285F4',
        refreshIntervalMinutes: 60,
      })
    })

    expect(seen.flat().map((t) => t.label)).toContain('Adding subscription…')
    expect(useProgressStore.getState().tasks).toEqual([])
  })

  it('reports one determinate task for the whole refresh-all loop', async () => {
    const subs = ['a', 'b'].map((id) => ({
      id,
      calendarId: `cal-${id}`,
      name: id,
      url: `https://example.com/${id}.ics`,
      refreshIntervalMinutes: 60,
      proxyUrl: null,
      lastFetchedAt: null,
      lastError: null,
    }))
    vi.mocked(storage.getAllSubscriptions).mockReturnValue(subs as never)
    vi.mocked(storage.getSubscriptionById).mockImplementation(
      (id: string) => subs.find((s) => s.id === id) as never
    )

    const seen = recordTasks()
    const { result } = renderHook(() => useWebcalSubscriptions())
    await act(async () => {
      await result.current.syncAll()
    })

    const snapshots = seen.filter((tasks) => tasks.length > 0)
    // One task throughout, never one per subscription.
    expect(Math.max(...snapshots.map((tasks) => tasks.length))).toBe(1)
    const progress = snapshots.map((tasks) => tasks[0]).filter((t) => t.total !== undefined)
    expect(progress[0]).toMatchObject({ label: 'Refreshing subscriptions…', done: 0, total: 2 })
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2 })
    await waitFor(() => expect(useProgressStore.getState().tasks).toEqual([]))
  })

  it('does not open a task when nothing is due', async () => {
    const seen = recordTasks()
    const { result } = renderHook(() => useWebcalSubscriptions())
    await act(async () => {
      await result.current.syncAll()
    })
    expect(seen.flat()).toEqual([])
  })

  it('stays silent for the background timer refresh', async () => {
    const seen: string[] = []
    const unsubscribe = useProgressStore.subscribe((state) =>
      seen.push(...state.tasks.map((t) => t.label))
    )
    const { result } = renderHook(() => useWebcalSubscriptions())
    await act(async () => {
      await result.current.syncAll({ silent: true })
    })
    unsubscribe()
    expect(seen).toEqual([])
  })
})
