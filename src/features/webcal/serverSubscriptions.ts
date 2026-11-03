import type { Calendar } from '@/types'
import type { ServerSubscription } from '@/features/caldav/types'
import { parseICALDataAsync } from '@/features/caldav/adapter/iCalendarAdapter'
import { useCalendarStore } from '@/store/calendarStore'
import { createUuid } from '@/lib/uuid'
import { fetchWebcalIcs, normalizeWebcalUrl } from './fetchWebcal'
import * as storage from './subscriptionStorage'

/** Fired after a CalDAV sync changes the stored subscriptions behind the UI's back. */
export const WEBCAL_SUBSCRIPTIONS_CHANGED = 'calino:webcal-subscriptions-changed'

function notifyChanged(): void {
  window.dispatchEvent(new Event(WEBCAL_SUBSCRIPTIONS_CHANGED))
}

// Same default the manual "subscribe" flow offers.
const DEFAULT_REFRESH_MINUTES = 60

/**
 * Pull one feed into its calendar. Failures are recorded on the subscription
 * (shown in settings) instead of thrown: a feed host that is down or blocks
 * CORS must never fail the CalDAV sync that discovered it.
 */
async function fetchInto(subscriptionId: string): Promise<void> {
  const subscription = storage.getSubscriptionById(subscriptionId)
  if (!subscription) return
  try {
    const icsText = await fetchWebcalIcs(subscription.url, subscription.proxyUrl)
    const events = await parseICALDataAsync(icsText, subscription.calendarId)
    const store = useCalendarStore.getState()
    const existingIds = store.events
      .filter((event) => event.calendarId === subscription.calendarId)
      .map((event) => event.id)
    const freshIds = new Set(events.map((event) => event.id))
    store.applyEventChanges({
      upserts: events,
      deleteIds: existingIds.filter((id) => !freshIds.has(id)),
    })
    storage.updateSubscription(subscriptionId, {
      lastFetchedAt: new Date().toISOString(),
      lastError: null,
    })
  } catch (error) {
    storage.updateSubscription(subscriptionId, {
      lastError: error instanceof Error ? error.message : String(error),
    })
  }
  notifyChanged()
}

/**
 * Mirror the external-feed collections a CalDAV account holds (Radicale
 * `VSUBSCRIBED`) as read-only webcal subscriptions. The server stores no events
 * for them, only the feed URL, so Calino reads the feed itself, exactly like a
 * subscription added by hand.
 *
 * - New collection → calendar + subscription, first fetch started in the
 *   background.
 * - Known collection → name follows the server; a changed feed URL is
 *   re-fetched. Colour stays whatever the user chose.
 * - Collection gone from the server → its calendar and subscription are
 *   removed. Pass `null` for `found` when the listing could not be read, so a
 *   failed PROPFIND never wipes anything.
 * - A feed the user already subscribed to by hand is left alone.
 */
export function reconcileServerSubscriptions(
  accountId: string,
  found: ServerSubscription[] | null,
  proxyUrl: string | null
): void {
  if (found === null) return

  const all = storage.getAllSubscriptions()
  const mine = all.filter((s) => s.serverAccountId === accountId)
  const byCollection = new Map(mine.map((s) => [s.serverCollectionUrl, s]))
  const manualUrls = new Set(all.filter((s) => !s.serverAccountId).map((s) => s.url))
  const store = useCalendarStore.getState()

  const seen = new Set<string>()
  for (const item of found) {
    const feedUrl = normalizeWebcalUrl(item.source)
    seen.add(item.url)

    const known = byCollection.get(item.url)
    if (known) {
      if (known.name !== item.name) {
        storage.updateSubscription(known.id, { name: item.name })
        store.updateCalendar(known.calendarId, { name: item.name })
      }
      if (known.url !== feedUrl) {
        storage.updateSubscription(known.id, { url: feedUrl, lastFetchedAt: null })
        void fetchInto(known.id)
      }
      continue
    }
    if (manualUrls.has(feedUrl)) continue

    const calendarId = createUuid()
    const calendar: Calendar = {
      id: calendarId,
      name: item.name,
      color: item.color,
      isVisible: true,
      isDefault: false,
      showTasksInViews: true,
      source: 'webcal',
      readOnly: true,
      notifyReminders: false,
    }
    store.addCalendar(calendar)
    const saved = storage.saveSubscription({
      calendarId,
      name: item.name,
      url: feedUrl,
      refreshIntervalMinutes: DEFAULT_REFRESH_MINUTES,
      proxyUrl,
      serverAccountId: accountId,
      serverCollectionUrl: item.url,
    })
    void fetchInto(saved.id)
  }

  for (const subscription of mine) {
    if (seen.has(subscription.serverCollectionUrl ?? '')) continue
    store.deleteCalendar(subscription.calendarId)
    storage.deleteSubscription(subscription.id)
  }
  notifyChanged()
}

/** Drop every subscription mirrored from an account (the account was removed). */
export function removeServerSubscriptions(accountId: string): void {
  reconcileServerSubscriptions(accountId, [], null)
}
