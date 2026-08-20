import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { GlobalProgress } from '../common/GlobalProgress'
import { useProgressStore, withProgress, isProgressOwned } from '@/store/progressStore'

describe('GlobalProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useProgressStore.setState({ tasks: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays hidden while a task is still inside the appear delay', () => {
    act(() => {
      useProgressStore.getState().begin('Saving event…')
    })
    render(<GlobalProgress />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the label once the task outlives the appear delay', () => {
    act(() => {
      useProgressStore.getState().begin('Saving event…')
    })
    render(<GlobalProgress />)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByText('Saving event…')).toBeTruthy()
  })

  it('reports a percentage when the task knows its total', () => {
    let id = ''
    act(() => {
      id = useProgressStore.getState().begin('Importing…', { done: 1, total: 4 })
    })
    render(<GlobalProgress />)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')

    act(() => {
      useProgressStore.getState().update(id, { done: 2 })
    })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
  })

  it('animates out, then unmounts, when the task ends', () => {
    let id = ''
    act(() => {
      id = useProgressStore.getState().begin('Saving event…')
    })
    render(<GlobalProgress />)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    act(() => {
      useProgressStore.getState().end(id)
    })
    // Still on screen for the exit animation, keeping its last label.
    expect(screen.getByText('Saving event…')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('speaks for the oldest task, and clears it even when the work throws', async () => {
    act(() => {
      useProgressStore.getState().begin('First…')
    })
    const failing = withProgress('Second…', () => Promise.reject(new Error('nope')))
    expect(useProgressStore.getState().tasks.map((t) => t.label)).toEqual(['First…', 'Second…'])
    await expect(failing).rejects.toThrow('nope')
    expect(useProgressStore.getState().tasks.map((t) => t.label)).toEqual(['First…'])
  })

  it('reports an owned bulk task while the writes inside it stay quiet', async () => {
    let inner: string[] = []
    await withProgress(
      'Importing 3 events…',
      async (report) => {
        report({ done: 0, total: 3 })
        expect(isProgressOwned()).toBe(true)
        // Stand-in for a per-write `tracked(...)` wrapper, which skips its own
        // task while a bulk loop owns the pill.
        inner = useProgressStore.getState().tasks.map((t) => t.label)
        report({ done: 3, total: 3 })
        expect(useProgressStore.getState().tasks[0]?.done).toBe(3)
      },
      { owned: true }
    )
    expect(inner).toEqual(['Importing 3 events…'])
    expect(isProgressOwned()).toBe(false)
    expect(useProgressStore.getState().tasks).toEqual([])
  })

  it('releases ownership when the bulk work throws', async () => {
    await expect(
      withProgress('Importing…', () => Promise.reject(new Error('nope')), { owned: true })
    ).rejects.toThrow('nope')
    expect(isProgressOwned()).toBe(false)
  })
})
