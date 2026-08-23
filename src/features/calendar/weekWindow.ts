import { useSyncExternalStore } from 'react'

type Listener = () => void

let weekWindowStart: string | null = null
let preserveWindowForNextDateChange = false
const listeners = new Set<Listener>()

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = (): string | null => weekWindowStart

const notify = (): void => {
  listeners.forEach((listener) => listener())
}

/** The temporary first visible day of the seven-day week window. */
export function useWeekWindowStart(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getWeekWindowStart(): string | null {
  return weekWindowStart
}

export function setWeekWindowStart(value: string, currentDateWillChange = false): void {
  preserveWindowForNextDateChange = currentDateWillChange
  if (weekWindowStart === value) return
  weekWindowStart = value
  notify()
}

/** Consume the handoff used when a seven-day pager changes both values. */
export function consumeWindowDateChangeHandoff(): boolean {
  const shouldPreserve = preserveWindowForNextDateChange
  preserveWindowForNextDateChange = false
  return shouldPreserve
}

export function clearWeekWindowStart(): void {
  preserveWindowForNextDateChange = false
  if (weekWindowStart === null) return
  weekWindowStart = null
  notify()
}
