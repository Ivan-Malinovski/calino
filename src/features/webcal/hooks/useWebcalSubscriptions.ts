import { useState, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Calendar } from '@/types'
import { fetchWebcalIcs, normalizeWebcalUrl } from '../fetchWebcal'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import * as storage from '../subscriptionStorage'
import type { WebcalSubscription } from '../types'
import {
  useCalendarStore,
  selectAddEvent,
  selectUpdateEvent,
  selectDeleteEvent,
  selectAddCalendar,
  selectDeleteCalendar,
} from '@/store/calendarStore'
import { useConfigStore } from '@/store/configStore'

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
  syncAll: () => Promise<void>
}

function isDue(subscription: WebcalSubscription): boolean {
  if (!subscription.lastFetchedAt) return true
  const last = new Date(subscription.lastFetchedAt).getTime()
  const dueAt = last + subscription.refreshIntervalMinutes * 60_000
  return Date.now() >= dueAt
}

export function useWebcalSubscriptions(): UseWebcalSubscriptionsReturn {
  const [subscriptions, setSubscriptions] = useState<WebcalSubscription[]>([])

  const storeAddEvent = useCalendarStore(selectAddEvent)
  const storeUpdateEvent = useCalendarStore(selectUpdateEvent)
  const storeDeleteEvent = useCalendarStore(selectDeleteEvent)
  const storeAddCalendar = useCalendarStore(selectAddCalendar)
  const storeDeleteCalendar = useCalendarStore(selectDeleteCalendar)

  useEffect(() => {
    setSubscriptions(storage.getAllSubscriptions())
  }, [])

  const addSubscription = useCallback(
    async (options: AddWebcalSubscriptionOptions): Promise<WebcalSubscription> => {
      const normalizedUrl = normalizeWebcalUrl(options.url)
      const icsText = await fetchWebcalIcs(normalizedUrl, options.proxyUrl)
      const calendarId = uuidv4()
      const events = parseICALData(icsText, calendarId)

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
      for (const event of events) {
        storeAddEvent(event)
      }

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
    },
    [storeAddCalendar, storeAddEvent]
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

  const syncSubscription = useCallback(
    async (id: string): Promise<void> => {
      const subscription = storage.getSubscriptionById(id)
      if (!subscription) return

      try {
        const icsText = await fetchWebcalIcs(subscription.url, subscription.proxyUrl)
        const freshEvents = parseICALData(icsText, subscription.calendarId)
        const freshById = new Map(freshEvents.map((e) => [e.id, e]))

        const existingEvents = useCalendarStore
          .getState()
          .events.filter((e) => e.calendarId === subscription.calendarId)
        const existingById = new Map(existingEvents.map((e) => [e.id, e]))

        for (const [id, event] of freshById) {
          const existing = existingById.get(id)
          if (!existing) {
            storeAddEvent(event)
          } else if (JSON.stringify(existing) !== JSON.stringify(event)) {
            storeUpdateEvent(id, event)
          }
        }
        for (const [id] of existingById) {
          if (!freshById.has(id)) {
            storeDeleteEvent(id)
          }
        }

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
    [storeAddEvent, storeUpdateEvent, storeDeleteEvent]
  )

  const syncAll = useCallback(async (): Promise<void> => {
    const due = storage.getAllSubscriptions().filter(isDue)
    for (const subscription of due) {
      await syncSubscription(subscription.id)
    }
  }, [syncSubscription])

  // Background refresh — checks periodically which subscriptions are due.
  useEffect(() => {
    const interval = setInterval(() => {
      syncAll()
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
