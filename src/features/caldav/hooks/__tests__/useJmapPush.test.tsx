import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalDAVAccount } from '../../types'

const watch = vi.fn()
const stop = vi.fn()

vi.mock('../../client/createBackend', () => ({
  createCalendarBackend: vi.fn(async () => ({ watch })),
}))
vi.mock('../../client/credentials', () => ({
  getCredentialById: vi.fn(async () => ({ id: 'c', username: 'u', password: 'p', serverUrl: 's' })),
}))

import { createCalendarBackend } from '../../client/createBackend'
import { useJmapPush } from '../useJmapPush'

const account = (id: string, protocol?: 'jmap' | 'caldav'): CalDAVAccount => ({
  id,
  name: id,
  serverUrl: 'https://example.test',
  proxyUrl: null,
  username: 'u',
  credentialId: 'c',
  createdAt: '',
  lastSyncAt: null,
  protocol,
})

describe('useJmapPush', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    watch.mockReset().mockReturnValue(stop)
    stop.mockReset()
    vi.mocked(createCalendarBackend).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('watches only JMAP accounts and syncs once, debounced, per burst of changes', async () => {
    const syncAccount = vi.fn(async () => {})
    const { unmount } = renderHook(() =>
      useJmapPush([account('j', 'jmap'), account('d', 'caldav'), account('x')], syncAccount)
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(createCalendarBackend).toHaveBeenCalledTimes(1)
    expect(watch).toHaveBeenCalledTimes(1)

    const onChange = watch.mock.calls[0][0] as () => void
    onChange()
    onChange()
    onChange()
    await vi.advanceTimersByTimeAsync(2000)
    expect(syncAccount).toHaveBeenCalledTimes(1)
    expect(syncAccount).toHaveBeenCalledWith('j')

    unmount()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does nothing without JMAP accounts', async () => {
    renderHook(() =>
      useJmapPush(
        [account('d', 'caldav')],
        vi.fn(async () => {})
      )
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(createCalendarBackend).not.toHaveBeenCalled()
  })
})
