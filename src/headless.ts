/**
 * Background sync entry point — the page `HeadlessSyncWorker` loads.
 *
 * This exists so the calendar mirror can be refreshed while Calino is closed.
 * The mirror makes Android's calendar provider own reminder alarms, which is
 * reliable in a way `LocalNotifications` is not, but the provider can only
 * alarm events it has been given: without a background refresh an event created
 * on another device never reaches it, and never alerts. This is the other half
 * of that feature.
 *
 * It is deliberately not the app. No React, no stores, no UI — it reads the
 * state the app persisted, does one CalDAV pass, writes the provider, and says
 * it is done. See `HeadlessSyncWorker` for why there is no Capacitor here.
 *
 * ## Read-only with respect to app state
 *
 * Nothing here writes `localStorage`. The foreground app keeps its own
 * in-memory zustand copy and rehydrates only at startup, so a background write
 * would race it — either clobbering a change the user just made or being
 * silently overwritten by the app's next save. The provider is the only thing
 * this page mutates, and the app reconciles the mirror from its own state when
 * it next opens, so the two converge.
 */

import type { Calendar, CalendarEvent } from '@/types'
import type { CalDAVCalendar } from '@/features/caldav/types'
import { getHeadlessBridge } from '@/lib/headlessBridge'
import { getAllAccounts, getCalendarsByAccountId } from '@/features/caldav/sync/accountStorage'
import { getCredentialById } from '@/features/caldav/client/credentials'
import { createCalDAVClient } from '@/features/caldav/client/CalDAVClient'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import { buildMirrorPayload, MIRROR_PAST_DAYS, MIRROR_FUTURE_DAYS } from '@/lib/calendarMirror'

const DAY_MS = 24 * 60 * 60 * 1000

/** Mirrors the app's `zustand/persist` key. Read, never written. */
function readPersisted<T>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    return ((JSON.parse(raw) as { state?: Partial<T> }).state ?? {}) as Partial<T>
  } catch {
    return {}
  }
}

interface HeadlessResult {
  accounts: number
  calendars: number
  events: number
}

/**
 * Fetches every CalDAV calendar the app has marked visible and writes the
 * result to the mirror.
 *
 * One account failing does not fail the pass: the others still refresh, and the
 * partial reconcile leaves the failed account's existing rows in place rather
 * than deleting events it merely could not reach.
 */
export async function runHeadlessSync(): Promise<HeadlessResult> {
  const bridge = getHeadlessBridge()
  if (!bridge) throw new Error('runHeadlessSync called outside the headless WebView')

  // Visibility and colour live only in the app's store, so it is the authority
  // on what gets mirrored — the same source the foreground pass uses.
  const storeCalendars = readPersisted<{ calendars: Calendar[] }>('calino-storage').calendars ?? []
  const visibleById = new Map(storeCalendars.filter((c) => c.isVisible).map((c) => [c.id, c]))
  const now = Date.now()
  const rangeStart = new Date(now - MIRROR_PAST_DAYS * DAY_MS).toISOString()
  const rangeEnd = new Date(now + MIRROR_FUTURE_DAYS * DAY_MS).toISOString()

  const events: CalendarEvent[] = []
  const fetched: Calendar[] = []
  let accountsSynced = 0

  for (const account of getAllAccounts()) {
    const targets = getCalendarsByAccountId(account.id).filter((calendar: CalDAVCalendar) =>
      visibleById.has(calendar.id)
    )
    if (targets.length === 0) continue

    try {
      const credentials = await getCredentialById(account.credentialId)
      if (!credentials) {
        bridge.log(`Skipping account ${account.name}: credentials are gone`)
        continue
      }
      const client = await createCalDAVClient(account.serverUrl, credentials, account.proxyUrl)

      for (const calendar of targets) {
        try {
          const resources = await client.fetchEvents(calendar.url, rangeStart, rangeEnd)
          for (const resource of resources) {
            events.push(...parseICALData(resource.data, calendar.id))
          }
          fetched.push(visibleById.get(calendar.id)!)
        } catch (error) {
          bridge.log(`Calendar ${calendar.name} failed: ${String(error)}`)
        }
      }
      accountsSynced++
    } catch (error) {
      bridge.log(`Account ${account.name} failed: ${String(error)}`)
    }
  }

  if (fetched.length === 0) {
    // Writing an empty payload here would be indistinguishable from "the user
    // deleted everything" — and with nothing fetched we have no evidence of
    // that. Leave the mirror as the app last left it.
    bridge.log('No calendars fetched; leaving the mirror untouched')
    return { accounts: accountsSynced, calendars: 0, events: 0 }
  }

  const payload = buildMirrorPayload(events, fetched)
  const result = JSON.parse(bridge.mirrorSync(JSON.stringify(payload))) as { error?: string }
  if (result.error) throw new Error(result.error)

  return {
    accounts: accountsSynced,
    calendars: payload.calendars.length,
    events: payload.events.length,
  }
}

const bridge = getHeadlessBridge()
if (bridge) {
  runHeadlessSync()
    .then((result) => {
      bridge.log(
        `Background sync done: ${result.events} events across ${result.calendars} calendars ` +
          `from ${result.accounts} account(s)`
      )
      bridge.finish('')
    })
    .catch((error: unknown) => {
      bridge.finish(error instanceof Error ? error.message : String(error))
    })
}
