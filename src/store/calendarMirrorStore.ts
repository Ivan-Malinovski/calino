import { create } from 'zustand'

/**
 * Runtime (not persisted) state of the Android calendar mirror.
 *
 * It exists so `useNotifications` can tell whether the OS has taken over
 * reminder duty. The user's setting alone can't answer that: the mirror only
 * really owns reminders once the calendar permission is granted *and* a
 * calendar app is installed to post the provider's alerts. Persisting any of
 * this would be wrong — permissions and installed apps change behind our back.
 */
export type CalendarMirrorStatus =
  /** Off by setting, or not an Android build. */
  | 'off'
  /** On, permission granted, a calendar app will raise the alerts. */
  | 'active'
  /** On and mirroring, but nothing on the device posts calendar reminders,
   *  so Calino must keep scheduling its own notifications. */
  | 'no-calendar-app'
  /** On by setting, but the OS permission is not granted. */
  | 'denied'
  /** On and permitted, but the last write to the provider failed. Distinct
   *  from 'denied' so the UI doesn't send the user to fix a permission that
   *  was never the problem; `lastError` carries the detail. */
  | 'failed'

interface CalendarMirrorState {
  status: CalendarMirrorStatus
  lastError: string | null
  setStatus: (status: CalendarMirrorStatus) => void
  setLastError: (error: string | null) => void
}

export const useCalendarMirrorStore = create<CalendarMirrorState>((set) => ({
  status: 'off',
  lastError: null,
  setStatus: (status) => set({ status }),
  setLastError: (lastError) => set({ lastError }),
}))

/**
 * Whether the calendar provider is responsible for firing reminders, meaning
 * Calino should stand down its own scheduling to avoid double notifications.
 */
export function mirrorOwnsReminders(status: CalendarMirrorStatus): boolean {
  return status === 'active'
}
