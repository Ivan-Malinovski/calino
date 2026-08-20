import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function getSnapshot(): boolean {
  return navigator.onLine
}

/**
 * Whether the browser thinks it has a network.
 *
 * `useSyncExternalStore` rather than state plus an effect: the value is read
 * from the browser, not derived, and this way the first render already has the
 * right answer instead of flashing "online" for a frame.
 *
 * `navigator.onLine` only knows about the local link — a working Wi-Fi
 * connection to a dead server still reads as online — so treat a `false` here
 * as certainty that writes will fail, and a `true` as no promise at all.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
