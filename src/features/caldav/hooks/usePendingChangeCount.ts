import { useSyncExternalStore } from 'react'
import { subscribeToPendingChanges, getPendingChangeCount } from '../sync/accountStorage'

/**
 * How many writes are queued for retry, kept live as the queue drains.
 *
 * Deliberately not read off `syncState.pendingChanges`: that count is set by
 * whichever code path happened to remember to set it, while the storage module
 * is the single funnel every queued write actually goes through.
 */
export function usePendingChangeCount(): number {
  return useSyncExternalStore(subscribeToPendingChanges, getPendingChangeCount, () => 0)
}
