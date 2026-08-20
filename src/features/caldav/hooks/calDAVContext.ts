import { createContext } from 'react'
import type { UseCalDAVReturn } from './useCalDAV'

/**
 * Holds the single app-wide CalDAV instance created by `CalDAVProvider`.
 *
 * `null` means no provider is mounted, which `useCalDAV` treats as a bug: a
 * per-component fallback instance is exactly the duplication this context
 * exists to remove.
 */
export const CalDAVContext = createContext<UseCalDAVReturn | null>(null)
