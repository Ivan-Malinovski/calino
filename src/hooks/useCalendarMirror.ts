import { useEffect, useRef } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalendarMirrorStore } from '@/store/calendarMirrorStore'
import {
  isCalendarMirrorSupported,
  checkCalendarMirrorPermission,
  hasCalendarApp,
  syncCalendarMirror,
  clearCalendarMirror,
  scheduleBackgroundSync,
  cancelBackgroundSync,
} from '@/lib/calendarMirror'

/** Matches the reminder reconcile debounce — a sync stores events one at a
 * time, and each mirror pass is a full diff across the provider. */
const MIRROR_DEBOUNCE_MS = 1500

/**
 * Keeps Android's calendar provider in step with Calino's events while the
 * mirror setting is on, and tears the mirror down when it is turned off.
 *
 * Mirroring the store's raw `events` (not the expanded occurrences
 * `useNotifications` works from) is deliberate: recurring masters carry their
 * RRULE straight through to the provider, which expands them itself.
 */
export function useCalendarMirror(): void {
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const enableCalendarMirror = useSettingsStore((state) => state.enableCalendarMirror)
  const defaultReminderMinutes = useSettingsStore((state) => state.defaultReminderMinutes)
  const setStatus = useCalendarMirrorStore((state) => state.setStatus)
  const setLastError = useCalendarMirrorStore((state) => state.setLastError)
  // Survives effect re-runs, unlike a per-effect flag — see runSync.
  const runIdRef = useRef(0)

  // Tear down when the setting goes off, so we never leave orphaned calendars
  // sitting in the user's calendar app — or an unowned worker still waking the
  // device to refresh a mirror that no longer exists.
  useEffect(() => {
    if (!isCalendarMirrorSupported()) return

    if (enableCalendarMirror) {
      // The periodic refresh is what keeps the provider alarming events Calino
      // has never seen in the foreground; without it the mirror is only as
      // fresh as the last time the app was open.
      void scheduleBackgroundSync().catch(() => {
        // A missing background refresh degrades freshness, not correctness, and
        // every foreground sync re-arms it.
      })
      return
    }

    setStatus('off')
    void cancelBackgroundSync().catch(() => {})
    void clearCalendarMirror().catch(() => {
      // Nothing actionable — the calendars are only reachable via our own
      // account, and the next enable/disable cycle retries.
    })
  }, [enableCalendarMirror, setStatus])

  useEffect(() => {
    if (!isCalendarMirrorSupported() || !enableCalendarMirror) return

    let cancelled = false
    let debounceId: ReturnType<typeof setTimeout> | undefined

    const runSync = async (): Promise<void> => {
      // Only the newest run may record a status, so a slow pass can't clobber
      // a fresher result. Deliberately NOT keyed off the effect's `cancelled`
      // flag: this effect re-runs on every event write, so a CalDAV sync tears
      // it down repeatedly while a mirror pass is still in flight. Gating the
      // status write on `cancelled` meant those passes completed successfully
      // and then threw their result away, leaving the status stuck at its
      // initial value forever on any account big enough to keep writing.
      const runId = ++runIdRef.current
      const isStale = (): boolean => runIdRef.current !== runId

      // The app setting being on doesn't mean the OS grant survived; a
      // reinstall or a manual revoke resets it independently.
      const granted = await checkCalendarMirrorPermission()
      if (isStale()) return
      if (!granted) {
        setStatus('denied')
        return
      }

      try {
        await syncCalendarMirror(events, calendars, defaultReminderMinutes)
        if (isStale()) return
        setLastError(null)
        // Checked after a successful sync rather than once at startup: the
        // user can install or uninstall a calendar app at any time, and this
        // decides whether local notifications stay on.
        const calendarAppPresent = await hasCalendarApp()
        if (isStale()) return
        setStatus(calendarAppPresent ? 'active' : 'no-calendar-app')
      } catch (error) {
        if (isStale()) return
        // Fall back to Calino's own notifications rather than trusting a
        // mirror we failed to write.
        setStatus('failed')
        setLastError(error instanceof Error ? error.message : String(error))
      }
    }

    const scheduleSync = (): void => {
      clearTimeout(debounceId)
      debounceId = setTimeout(() => {
        if (!cancelled) void runSync()
      }, MIRROR_DEBOUNCE_MS)
    }

    scheduleSync()

    const appStateListenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !cancelled) void runSync()
    })

    return () => {
      cancelled = true
      clearTimeout(debounceId)
      void appStateListenerPromise.then((handle) => handle.remove())
    }
  }, [events, calendars, enableCalendarMirror, defaultReminderMinutes, setStatus, setLastError])
}
