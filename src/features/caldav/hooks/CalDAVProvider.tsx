import type { ReactNode, JSX } from 'react'
import { CalDAVContext } from './calDAVContext'
import { useCalDAVInstance } from './useCalDAV'

/**
 * Creates the one CalDAV instance the whole app shares.
 *
 * `useCalDAVInstance` owns real work on mount — loading accounts, probing each
 * account for CardDAV support, and a 30s retry timer for pending changes — so
 * every component that called it directly paid that cost again. With ~20
 * consumers (down to `EventCard`, one per rendered event) that meant duplicated
 * timers and a burst of network probes whenever a subtree remounted, such as a
 * viewport resize crossing the mobile breakpoint. Mount this once, near the
 * root, and every consumer reads the same state and callbacks.
 */
export function CalDAVProvider({ children }: { children: ReactNode }): JSX.Element {
  const caldav = useCalDAVInstance()
  return <CalDAVContext.Provider value={caldav}>{children}</CalDAVContext.Provider>
}
