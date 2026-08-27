import { useState, useCallback, useEffect } from 'react'
import { createUuid } from '@/lib/uuid'
import type { Calendar } from '@/types'
import { fetchWebcalIcs, normalizeWebcalUrl } from '../fetchWebcal'
import { parseICALDataAsync } from '@/features/caldav/adapter/iCalendarAdapter'
import * as storage from '../subscriptionStorage'
import type { WebcalSubscription } from '../types'
import {
  useCalendarStore,
  selectAddCalendar,
  selectDeleteCalendar,
  selectApplyEventChanges,
} from '@/store/calendarStore'
import { useConfigStore } from '@/store/configStore'
import { withProgress } from '@/store/progressStore'

// Module-level guard: useWebcalSubscriptions() may be instantiated in
// multiple components (settings panel, sidebar), same reasoning as
// autoConnectDone in useCalDAV.ts.
let webcalAutoConnectDone = false

// How often we check whether any subscription is due for a refresh — not
// the refresh interval itself, which is per-subscription.
const DUE_CHECK_INTERVAL_MS = 5 * 60 * 1000

export interface AddWebcalSubscriptionOptions {
  url: string
  name: string
  color: string
  refreshIntervalMinutes: number
  proxyUrl?: string | null
  isPreconfigured?: boolean
}

interface UseWebcalSubscriptionsReturn {
  subscriptions: WebcalSubscription[]
  addSubscription: (options: AddWebcalSubscriptionOptions) => Promise<WebcalSubscription>
  removeSubscription: (id: string) => void
  syncSubscription: (id: string) => Promise<void>
  syncAll: (options?: { silent?: boolean }) => Promise<void>
}

function isDue(subscription: WebcalSubscription): boolean {
  if (!subscription.lastFetchedAt) return true
  const last = new Date(subscription.lastFetchedAt).getTime()
  const dueAt = last + subscription.refreshIntervalMinutes * 60_000
  return Date.now() >= dueAt
}

export function useWebcalSubscriptions(): UseWebcalSubscriptionsReturn {
  const [subscriptions, setSubscriptions] = useState<WebcalSubscription[]>([])

  const storeAddCalendar = useCalendarStore(selectAddCalendar)
  const storeDeleteCalendar = useCalendarStore(selectDeleteCalendar)
  const applyEventChanges = useCalendarStore(selectApplyEventChanges)

  useEffect(() => {
    setSubscriptions(storage.getAllSubscriptions())
  }, [])

  const addSubscription = useCallback(
    async (options: AddWebcalSubscriptionOptions): Promise<WebcalSubscription> => {
      const normalizedUrl = normalizeWebcalUrl(options.url)
      // The feed lives on someone else's server and a big ICS takes a while to
      // parse, so narrate both stages rather than leaving the dialog silent.
      return withProgress('Adding subscription…', async (report) => {
        const icsText = await fetchWebcalIcs(normalizedUrl, options.proxyUrl)
        report({ label: 'Importing events…' })
        const calendarId = createUuid()
        const events = await parseICALDataAsync(icsText, calendarId)

        const calendar: Calendar = {
          id: calendarId,
          name: options.name,
          color: options.color,
          isVisible: true,
          isDefault: false,
          showTasksInViews: true,
          source: 'webcal',
          readOnly: true,
        }
        storeAddCalendar(calendar)
        applyEventChanges({ upserts: events, deleteIds: [] })

        const saved = storage.saveSubscription({
          calendarId,
          name: options.name,
          url: normalizedUrl,
          refreshIntervalMinutes: options.refreshIntervalMinutes,
          proxyUrl: options.proxyUrl ?? null,
          isPreconfigured: options.isPreconfigured,
        })
        storage.updateSubscription(saved.id, { lastFetchedAt: new Date().toISOString() })
        const withFetchTime = { ...saved, lastFetchedAt: new Date().toISOString() }
        setSubscriptions((prev) => [...prev, withFetchTime])
        return withFetchTime
      })
    },
    [storeAddCalendar, applyEventChanges]
  )

  const removeSubscription = useCallback(
    (id: string): void => {
      const subscription = storage.getSubscriptionById(id)
      if (!subscription) return
      storeDeleteCalendar(subscription.calendarId)
      storage.deleteSubscription(id)
      setSubscriptions((prev) => prev.filter((s) => s.id !== id))
    },
    [storeDeleteCalendar]
  )

  // Progress-free core, so `syncAll` can report one task for the whole loop
  // instead of one per subscription.
  const runSync = useCallback(
    async (id: string, report?: (patch: { label?: string }) => void): Promise<void> => {
      const subscription = storage.getSubscriptionById(id)
      if (!subscription) return

      try {
        const icsText = await fetchWebcalIcs(subscription.url, subscription.proxyUrl)
        report?.({ label: 'Importing events…' })
        const freshEvents = await parseICALDataAsync(icsText, subscription.calendarId)
        const freshById = new Map(freshEvents.map((e) => [e.id, e]))

        const existingEvents = useCalendarStore
          .getState()
          .events.filter((e) => e.calendarId === subscription.calendarId)
        const existingById = new Map(existingEvents.map((e) => [e.id, e]))

        const upserts: typeof freshEvents = []
        for (const [id, event] of freshById) {
          const existing = existingById.get(id)
          if (!existing) {
            upserts.push(event)
          } else if (
            // #112 — a feed without CREATED parses to `created: undefined`,
            // while the stored copy carries the stamp we gave it on first
            // sight. Comparing those directly reports every event as changed
            // on every refresh, so hold the local stamps steady here; the
            // store keeps them anyway.
            JSON.stringify(existing) !==
            JSON.stringify({
              ...event,
              created: event.created ?? existing.created,
              lastModified: event.lastModified ?? existing.lastModified,
            })
          ) {
            upserts.push(event)
          }
        }
        const deleteIds = [...existingById.keys()].filter((eventId) => !freshById.has(eventId))
        applyEventChanges({ upserts, deleteIds })

        const now = new Date().toISOString()
        storage.updateSubscription(id, { lastFetchedAt: now, lastError: null })
        setSubscriptions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, lastFetchedAt: now, lastError: null } : s))
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh calendar.'
        storage.updateSubscription(id, { lastError: message })
        setSubscriptions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, lastError: message } : s))
        )
      }
    },
    [applyEventChanges]
  )

  const syncSubscription = useCallback(
    (id: string): Promise<void> =>
      withProgress('Refreshing subscription…', (report) => runSync(id, report)),
    [runSync]
  )

  // `silent` is for the timer below: nobody is waiting on a background refresh,
  // so it must not pop the pill over whatever the user is actually doing.
  const syncAll = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      const due = storage.getAllSubscriptions().filter(isDue)
      if (due.length === 0) return
      const run = async (report: (patch: { done?: number; total?: number }) => void) => {
        report({ done: 0, total: due.length })
        for (const [index, subscription] of due.entries()) {
          await runSync(subscription.id)
          report({ done: index + 1, total: due.length })
        }
      }
      if (options?.silent) {
        await run(() => {})
        return
      }
      await withProgress('Refreshing subscriptions…', run)
    },
    [runSync]
  )

  // Background refresh — checks periodically which subscriptions are due.
  useEffect(() => {
    const interval = setInterval(() => {
      syncAll({ silent: true })
    }, DUE_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [syncAll])

  // Auto-subscribe to preconfigured webcal feeds (calino.config.json) once
  // the master password unlocks them — mirrors useCalDAV.ts's CalDAV
  // auto-connect effect.
  const isUnlocked = useConfigStore((state) => state.isUnlocked)
  const hasPreconfiguredWebcal = useConfigStore((state) => state.hasPreconfiguredWebcal)

  useEffect(() => {
    if (!isUnlocked || !hasPreconfiguredWebcal || webcalAutoConnectDone) {
      return
    }
    webcalAutoConnectDone = true

    const { decryptedWebcalSubscriptions } = useConfigStore.getState()
    const existing = storage.getAllSubscriptions()

    const connect = async (): Promise<void> => {
      for (const entry of decryptedWebcalSubscriptions) {
        const normalizedUrl = normalizeWebcalUrl(entry.url)
        const alreadySubscribed = existing.some((s) => s.url === normalizedUrl)
        if (alreadySubscribed) continue

        console.log(`[Webcal] Auto-subscribing to preconfigured feed: ${entry.name}`)
        try {
          await addSubscription({
            url: normalizedUrl,
            name: entry.name,
            color: '#4285F4',
            refreshIntervalMinutes: entry.refreshIntervalMinutes ?? 60,
            proxyUrl: entry.proxyUrl,
            isPreconfigured: true,
          })
        } catch (err) {
          console.error(`[Webcal] Failed to auto-subscribe ${entry.name}:`, err)
        }
      }
    }
    connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked, hasPreconfiguredWebcal])

  return { subscriptions, addSubscription, removeSubscription, syncSubscription, syncAll }
}
