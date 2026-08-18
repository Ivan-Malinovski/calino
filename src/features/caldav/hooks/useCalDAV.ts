import { useState, useCallback, useEffect } from 'react'
import { addDays } from 'date-fns'
import type { CalendarEvent } from '@/types'
import { showToast, showBrokenEventsNotification, showDuplicateUidNotification } from '@/lib/toast'
import type {
  CalDAVAccount,
  CalDAVCalendar,
  SyncState,
  ConflictInfo,
  CreateCalendarOptions,
  UpdateCalendarOptions,
  MovePendingData,
  DeleteHrefPendingData,
  PendingChange,
} from '../types'
import { createCalDAVClient } from '../client/CalDAVClient'
import type { SyncCollectionChange } from '../client/CalDAVClient'
import { probeConnection, expandProviderUrl, type ProbeResult } from '../client/discovery'
import { CalDAVConnectionError } from '../client/errors'
import {
  saveCredentials,
  getCredentialById,
  deleteCredential,
  updateCredential,
} from '../client/credentials'
import { parseICALData } from '../adapter/iCalendarAdapter'
import { detectUidCollisions, type ParsedWithHref } from '../sync/detectUidCollisions'
import { putAttachments } from '@/lib/attachmentStore'
import { putRawIcs, deleteRawIcs } from '@/lib/rawIcsStore'
import { mapWithConcurrency, CALDAV_FETCH_CONCURRENCY } from '@/lib/mapWithConcurrency'
import * as storage from '../sync/accountStorage'
import {
  classifyPendingChangeError,
  backoffDelayMs,
  pendingChangeDropMessage,
} from '../sync/pendingChangePolicy'
import { SyncEngine, eventResourceFilename, resourceIsInCollection } from '../sync/syncEngine'
import { moveEventGroup, MoveLostSourceError } from '../sync/moveEvent'
import type { MoveResult } from '../sync/moveEvent'
import { pendingGuardedEventIds } from '../sync/pendingChanges'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAVSyncStore } from '@/store/caldavSyncStore'
import { useConfigStore } from '@/store/configStore'
import { EVENT_COLORS } from '@/store/settingsStore'
import {
  selectAddEvent,
  selectUpdateEvent,
  selectDeleteEvent,
  selectAddCalendar,
  selectDeleteCalendar,
  selectUpdateCalendar,
  selectCalendars,
  selectAddCategory,
} from '@/store/calendarStore'

const selectCalDavDebugMode = (state: { caldavDebugMode: boolean }) => state.caldavDebugMode
const selectConflictResolution = (state: { conflictResolution: string }) => state.conflictResolution

// Bug 23 fix: ref to prevent concurrent processPendingChanges execution
const isProcessingRef = { current: false }

// Module-level guard for auto-connect (shared across all hook instances)
let autoConnectDone = false
// Module-level guard: only sync once per page session (set when timer fires, not when effect runs)
// Module-level guard: event IDs whose server DELETE is currently in flight. A
// concurrent sync must skip these — otherwise it can re-add an event the user
// just deleted (the pending-change tombstone only exists on the failure path,
// so the happy path had a resurrection window). Shared across hook instances.
const inFlightDeletes = new Set<string>()
// Module-level guard: in-flight syncs keyed by account id. syncAccount snapshots
// the store's events before its network fetch and then runs an authoritative
// delete-reconciliation pass against that snapshot, so two overlapping runs for
// the same account each reconcile against stale state. Callers get the existing
// promise instead of starting a second run.
const inFlightSyncs = new Map<string, Promise<void>>()

const MAX_RETRIES = 10

// Last-attempt timestamps for the pending-change backoff gate, keyed by change
// id. Kept here (not on the change record) so accountStorage's record shape
// stays untouched. A reload resets it, which is acceptable — a freshly opened
// app may retry immediately.
const lastAttemptAtByChangeId = new Map<string, number>()

// Server-issued Retry-After (seconds) per change id, remembered from the last
// counted failure's error (see the outer classifier). The backoff gate waits
// out max(exponential, retryAfter) so a rate-limited (429) change is not
// hammered before the server's own deadline. Cleared whenever the change is
// removed, dropped, or succeeds, mirroring lastAttemptAtByChangeId. On the
// web the header may be invisible (no Access-Control-Expose-Headers), in
// which case nothing is ever stored and the gate is pure exponential.
const retryAfterByChangeId = new Map<string, number>()

/**
 * Best-effort title for a pending change's payload, for toasts. The payload is
 * either a bare event (create/update/delete) or a { events: [...] } group
 * (move / MoveLostSourceError recovery / grouped create).
 */
function pendingChangeTitle(change: PendingChange): string {
  if (!change.data) return ''
  try {
    const parsed = JSON.parse(change.data) as { events?: unknown[] } & Record<string, unknown>
    const first =
      Array.isArray(parsed.events) && parsed.events.length > 0 ? parsed.events[0] : parsed
    return (first as CalendarEvent | undefined)?.title ?? ''
  } catch {
    return ''
  }
}

/** The resource href a write for `event` targets — mirrors SyncEngine. */
function eventWriteHref(event: CalendarEvent, calendar: { url: string }): string {
  return event.resourceHref && resourceIsInCollection(event.resourceHref, calendar.url)
    ? event.resourceHref
    : `${calendar.url}${eventResourceFilename(event.id)}`
}

/**
 * Apply a queued update, recovering from a stale-etag 412 exactly once:
 * re-fetch the resource's current etag and re-apply against it. Never replay
 * the dead etag — that is what 412s forever. A second 412 (or any other error
 * from the re-apply) propagates to the caller's classifier.
 */
async function applyUpdateWithStaleEtagRecovery(
  engine: SyncEngine,
  client: Awaited<ReturnType<typeof createCalDAVClient>>,
  event: CalendarEvent,
  groupedEvents: CalendarEvent[],
  useGroup: boolean,
  etag: string,
  href: string | undefined
): Promise<{ url: string; etag: string }> {
  const attempt = (withEtag: string) =>
    useGroup
      ? engine.updateEventGroup(groupedEvents, withEtag)
      : engine.updateEvent({ ...event, etag: withEtag }, withEtag)

  try {
    return await attempt(etag)
  } catch (err) {
    if ((err as { status?: number } | undefined)?.status !== 412) throw err
    const freshEtag = href ? await client.fetchEtag(href) : ''
    if (!freshEtag) throw err
    return await attempt(freshEtag)
  }
}

/**
 * Build a SyncEngine bound to `calendar`, reusing `sameAccountClient` when the
 * calendar belongs to `sameAccountId` so a same-account move doesn't open a
 * second connection. Returns null when the account or its credentials are gone,
 * which callers treat as "nothing to clean up on that side".
 */
async function engineForCalendar(
  calendar: { id: string; accountId?: string },
  sameAccountClient: Awaited<ReturnType<typeof createCalDAVClient>>,
  sameAccountId: string
): Promise<SyncEngine | null> {
  if (!calendar.accountId) return null
  if (calendar.accountId === sameAccountId) {
    return new SyncEngine(sameAccountClient, calendar.id)
  }
  const account = storage.getAllAccounts().find((a) => a.id === calendar.accountId)
  if (!account) return null
  const credential = await getCredentialById(account.credentialId)
  if (!credential) return null
  const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
  return new SyncEngine(client, calendar.id)
}

/**
 * Collect every event stored in the same CalDAV resource as `events`.
 *
 * Matching is on `resourceHref` ALONE. An href already identifies exactly one
 * resource in one collection, so a `calendarId` check adds nothing — and during
 * a move it is actively wrong: the modal writes the new `calendarId` to the
 * master before the CalDAV layer runs, while the detached overrides still carry
 * the old one. Filtering on it there would drop every override from the group
 * and silently strip a series' exceptions (#86).
 */
function withResourceSiblings(
  events: CalendarEvent[],
  allEvents: CalendarEvent[],
  resourceHref: string | undefined,
  excludedIds: string[] = []
): CalendarEvent[] {
  if (!resourceHref) return events

  const includedIds = new Set(events.map((event) => event.id))
  const excluded = new Set(excludedIds)
  return [
    ...events,
    ...allEvents.filter(
      (event) =>
        event.resourceHref === resourceHref && !includedIds.has(event.id) && !excluded.has(event.id)
    ),
  ]
}

/**
 * R2.7 — Find the master component a detached override belongs to.
 *
 * Matches on the local `recurrenceMasterId` first, falling back to the shared
 * UID. The UID fallback is what makes Nextcloud Tasks' split-resource writes
 * work: it PUTs the exception to a *separate* href, so the pair can arrive with
 * no href in common and only the UID to tie them together.
 */
function findRecurrenceMaster(override: CalendarEvent): CalendarEvent | undefined {
  return useCalendarStore.getState().events.find(
    (candidate) =>
      !candidate.recurrenceId &&
      // Scoped to the same collection and component type. This feeds a group
      // write that rewrites the matched master's whole resource, so a loose
      // match here corrupts an unrelated calendar object — a bare id/uid
      // comparison would happily pair a task override with a VEVENT of the
      // same uid in another calendar.
      candidate.calendarId === override.calendarId &&
      candidate.type === override.type &&
      (candidate.id === override.recurrenceMasterId ||
        (Boolean(override.uid) && candidate.uid === override.uid))
  )
}

/**
 * Parse every fetched CalDAV resource into events, pairing each with the
 * resource href it came from, and cache inline attachments in IndexedDB.
 * The href is what lets us detect UID collisions across independent resources
 * (issue #22) — the same logic both sync paths need.
 */
interface CollectParsedResult {
  items: ParsedWithHref[]
  /**
   * True when at least one fetched resource had a body but yielded zero
   * parsed components — i.e. ICAL.parse (or a VEVENT/VTODO/VJOURNAL mapper)
   * threw and the failure was swallowed by parseICALData. Such a resource
   * still exists on the server; it just couldn't be read. Callers must NOT
   * treat this calendar's listing as authoritative for deletions this cycle,
   * or the corresponding local event would be deleted even though it is
   * still present remotely (data loss).
   */
  hadParseFailures: boolean
}

async function collectParsedWithHref(
  fetchedEvents: { url: string; data: string; etag?: string }[],
  calendarId: string
): Promise<CollectParsedResult> {
  const result: ParsedWithHref[] = []
  let hadParseFailures = false
  for (const eventData of fetchedEvents) {
    if (!eventData.data) continue

    // Keep the server's own bytes so a later save can patch them instead of
    // rebuilding the resource from the modelled subset (which drops GEO, X-
    // properties, alarm detail, attendee parameters — see rawIcsStore).
    //
    // This is the only place both live fetch paths meet: `addAccount`'s
    // initial import and `syncAccount`'s recurring sync. `SyncEngine.fullSync`
    // looks like the natural home for it but has no callers.
    //
    // Non-fatal: failing to cache an original must never break a sync, it just
    // costs a fall back to the previous from-scratch behaviour.
    await putRawIcs(eventData.url, calendarId, eventData.data, eventData.etag).catch(() => {})

    const parsedEvents = parseICALData(eventData.data, calendarId)
    if (parsedEvents.length === 0 && eventData.data.trim()) {
      hadParseFailures = true
    }
    for (let parsedEvent of parsedEvents) {
      // Cache inline attachments in IndexedDB, keep only metadata in the store
      if (parsedEvent.attachments && parsedEvent.attachments.length > 0) {
        const hasInline = parsedEvent.attachments.some((att) => att.href.startsWith('data:'))
        if (hasInline) {
          await putAttachments(parsedEvent.id, parsedEvent.attachments)
          parsedEvent = {
            ...parsedEvent,
            attachments: parsedEvent.attachments.map((att) => ({
              ...att,
              href: att.href.startsWith('data:') ? '' : att.href,
            })),
          }
        }
      }
      result.push({
        event: {
          ...parsedEvent,
          resourceHref: eventData.url,
          etag: eventData.etag,
        },
        href: eventData.url,
      })
    }
  }
  return { items: result, hadParseFailures }
}

/**
 * Compare two resource hrefs for identity.
 *
 * Stored `resourceHref` values come from tsdav's `obj.url`; sync-collection
 * hrefs are resolved against the collection URL. The same resource can
 * therefore arrive as an absolute URL from one path and a server-relative one
 * from the other, and servers are inconsistent about a trailing slash. Compare
 * on the path only, and keep percent-encoding as-is — decoding would fold
 * `%2F` into a path separator.
 */
/** Human-readable identifier for sync logging. */
function calendarLabel(cal: { name?: string; id: string }): string {
  return cal.name || cal.id
}

function hrefKey(href: string): string {
  let path = href
  try {
    path = new URL(href, 'http://x.invalid').pathname
  } catch {
    // Not URL-shaped; fall through and compare the raw string.
  }
  return path.replace(/\/+$/, '')
}

interface UseCalDAVReturn {
  accounts: CalDAVAccount[]
  calendars: CalDAVCalendar[]
  syncState: SyncState
  addAccount: (
    serverUrl: string,
    username: string,
    password: string,
    name: string,
    proxyUrl?: string | null
  ) => Promise<void>
  removeAccount: (accountId: string) => Promise<void>
  updateAccount: (
    accountId: string,
    updates: {
      name: string
      serverUrl: string
      username: string
      /** Blank/undefined keeps the currently stored password. */
      password?: string
      proxyUrl?: string | null
    }
  ) => Promise<void>
  testAccount: (accountId: string) => Promise<ProbeResult>
  syncAccount: (accountId: string) => Promise<void>
  syncAll: () => Promise<void>
  createEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  updateEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  createEventGroup: (calendarId: string, events: CalendarEvent[]) => Promise<void>
  saveRecurrenceOverride: (
    calendarId: string,
    master: CalendarEvent,
    exception: CalendarEvent | null,
    removedExceptionIds?: string[]
  ) => Promise<void>
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>
  deleteEventByHref: (calendarId: string, href: string) => Promise<void>
  retryAllFailedSyncs: () => Promise<{ succeeded: number; failed: number }>
  createCalendar: (accountId: string, options: CreateCalendarOptions) => Promise<CalDAVCalendar>
  updateCalendar: (calendarId: string, options: UpdateCalendarOptions) => Promise<void>
  deleteCalendarFromServer: (calendarId: string) => Promise<void>
}

export function useCalDAV(): UseCalDAVReturn {
  const [accounts, setAccounts] = useState<CalDAVAccount[]>([])
  const [calendars, setCalendars] = useState<CalDAVCalendar[]>([])
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'idle',
    lastSyncAt: null,
    error: null,
    pendingChanges: 0,
    conflicts: [],
  })

  const storeAddEvent = useCalendarStore(selectAddEvent)
  const storeUpdateEvent = useCalendarStore(selectUpdateEvent)
  const storeDeleteEvent = useCalendarStore(selectDeleteEvent)
  const storeAddCalendar = useCalendarStore(selectAddCalendar)
  const storeDeleteCalendar = useCalendarStore(selectDeleteCalendar)
  const storeUpdateCalendar = useCalendarStore(selectUpdateCalendar)
  const storeCalendars = useCalendarStore(selectCalendars)
  const storeAddCategory = useCalendarStore(selectAddCategory)
  const caldavDebugMode = useSettingsStore(selectCalDavDebugMode)
  const conflictResolution = useSettingsStore(selectConflictResolution)

  // Bug 23 fix: prevent concurrent execution of processPendingChanges
  // Process any pending changes that failed in previous sessions
  const processPendingChanges = useCallback(async (): Promise<void> => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    try {
      // Never attempt network writes while the browser reports offline. The
      // client would throw "No network connection" for every change anyway;
      // skipping the whole cycle keeps the queue untouched (no retryCount
      // churn) and the writes land when the network returns.
      if (!navigator.onLine) return

      const changes = storage.getPendingChanges()
      if (changes.length === 0) return

      if (caldavDebugMode) {
        console.log(`[CalDAV] Processing ${changes.length} pending changes...`)
      }

      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()

      let succeeded = 0
      let failed = 0

      for (const change of changes) {
        // Bug 18 fix: enforce retry limit
        if (change.retryCount >= MAX_RETRIES) {
          console.warn(
            `[CalDAV] Dropping pending change ${change.id} after ${MAX_RETRIES} retries (type=${change.type}, eventId=${change.eventId})`
          )
          if (change.type === 'delete-href') {
            // Dropping this silently leaves a duplicate of a moved event sitting
            // in its old calendar, which then reappears on the next sync with no
            // explanation. Say so instead.
            const staleCalendar = allCalendars.find((c) => c.id === change.calendarId)
            showToast(
              `Couldn't remove the old copy of a moved event${
                staleCalendar ? ` from ${staleCalendar.name}` : ''
              }. It may show up twice — delete the duplicate manually.`
            )
          } else if (change.type === 'move') {
            // A move that never lands leaves the event stranded in its old
            // calendar with a 'failed' sync status and no explanation. Say so.
            const title = pendingChangeTitle(change)
            const targetCalendar = allCalendars.find((c) => c.id === change.calendarId)
            showToast(
              `Couldn't move "${title || 'event'}"${
                targetCalendar ? ` to ${targetCalendar.name}` : ''
              }. It may still be in its old calendar.`
            )
          } else {
            // create / update / delete carry user content — dropping them
            // silently would orphan the edit with no explanation. The change
            // itself is lost from the queue, but the local event stays in the
            // store with syncStatus 'failed', so the user can see it and edit
            // again.
            showToast(pendingChangeDropMessage(change.type, pendingChangeTitle(change)))
          }
          lastAttemptAtByChangeId.delete(change.id)
          retryAfterByChangeId.delete(change.id)
          storage.removePendingChange(change.id)
          failed++
          continue
        }

        // Exponential backoff: a change that failed with a countable error
        // waits out its window before the next attempt. Skipped changes are
        // neither counted nor dropped. A retryCount of 0 (fresh edit, or a
        // coalesced replacement) always attempts immediately.
        const lastAttempt = lastAttemptAtByChangeId.get(change.id)
        // A server Retry-After (remembered from the last counted failure)
        // acts as a lower bound on the wait — honor it even when the
        // exponential schedule would already have elapsed.
        const retryAfterMs = (retryAfterByChangeId.get(change.id) ?? 0) * 1000
        if (
          change.retryCount > 0 &&
          lastAttempt !== undefined &&
          Date.now() - lastAttempt < Math.max(backoffDelayMs(change.retryCount), retryAfterMs)
        ) {
          continue
        }

        try {
          const calendar = allCalendars.find((c) => c.id === change.calendarId)
          const account = allAccounts.find((a) => a.id === calendar?.accountId)

          if (!calendar || !account) {
            failed++
            storage.updatePendingChangeRetry(change.id)
            continue
          }

          const credential = await getCredentialById(account.credentialId)
          if (!credential) {
            failed++
            storage.updatePendingChangeRetry(change.id)
            continue
          }

          const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
          const engine = new SyncEngine(client, change.calendarId)

          // N1 — the update/delete second-412 handlers finish the change
          // themselves (toast + removePendingChange + failed++). A bare `break`
          // would fall through to the post-switch success cleanup below
          // (double-counting succeeded and re-calling removePendingChange), so
          // they set this flag and the loop continues here instead.
          let conflictHandled = false

          switch (change.type) {
            case 'create': {
              // Payload may be a bare event (legacy) or a { events: [...] }
              // group from the MoveLostSourceError recovery — a re-created
              // recurrence series must write every member in one resource or
              // its detached overrides are dropped.
              const raw = JSON.parse(change.data || '{}')
              const events = (Array.isArray(raw?.events) ? raw.events : [raw]) as CalendarEvent[]
              const event = events[0]
              const { url, etag } =
                events.length > 1
                  ? await engine.putEventGroup(events.map((e) => ({ ...e, sequence: 0 })))
                  : await engine.pushEvent({ ...event, sequence: 0 })
              storeUpdateEvent(change.eventId, { resourceHref: url, etag, syncStatus: 'synced' })
              for (const groupedEvent of events.slice(1)) {
                storeUpdateEvent(groupedEvent.id, {
                  resourceHref: url,
                  etag,
                  syncStatus: 'synced',
                })
              }
              break
            }
            case 'update': {
              const event = JSON.parse(change.data || '{}') as CalendarEvent
              const state = useCalendarStore.getState()
              const uid = event.uid || event.id
              const overrides = !event.recurrenceId
                ? state.events.filter(
                    (candidate) =>
                      candidate.calendarId === change.calendarId &&
                      Boolean(candidate.recurrenceId) &&
                      (candidate.uid === uid || candidate.recurrenceMasterId === event.id)
                  )
                : []
              const groupedEvents = withResourceSiblings(
                [event, ...overrides],
                state.events,
                event.resourceHref
              )
              const useGroup =
                groupedEvents.length > 1 &&
                groupedEvents.some((candidate) => !candidate.recurrenceId)
              const masterForHref =
                groupedEvents.find((candidate) => !candidate.recurrenceId) ?? event
              try {
                const { url, etag } = await applyUpdateWithStaleEtagRecovery(
                  engine,
                  client,
                  event,
                  groupedEvents,
                  useGroup,
                  event.etag || '',
                  eventWriteHref(masterForHref, calendar)
                )
                for (const groupedEvent of groupedEvents) {
                  storeUpdateEvent(groupedEvent.id, {
                    resourceHref: url,
                    etag,
                    syncStatus: 'synced',
                  })
                }
                // Mark as synced in the store
                storeUpdateEvent(change.eventId, {
                  resourceHref: url,
                  etag,
                  syncStatus: 'synced',
                })
              } catch (err) {
                if ((err as { status?: number } | undefined)?.status === 412) {
                  // Even re-applied against a fresh etag the server still
                  // refuses: the resource changed again mid-recovery. Do not
                  // loop — surface the conflict and keep the local edit (it
                  // stays in the store with syncStatus 'failed').
                  showToast(
                    `Couldn't save "${pendingChangeTitle(change) || 'this event'}" — it changed on the server while this edit was queued. Your version is saved locally.`
                  )
                  lastAttemptAtByChangeId.delete(change.id)
                  retryAfterByChangeId.delete(change.id)
                  storage.removePendingChange(change.id)
                  failed++
                  conflictHandled = true
                  break
                }
                throw err
              }
              break
            }
            case 'move': {
              const parsed = JSON.parse(change.data || '{}') as MovePendingData
              const events = (parsed.events ?? []) as CalendarEvent[]
              if (events.length === 0) break

              const sourceCalendar = allCalendars.find((c) => c.id === parsed.sourceCalendarId)
              // Source unresolvable (account removed mid-flight): retry rather
              // than push a half-move.
              if (!sourceCalendar) {
                failed++
                storage.updatePendingChangeRetry(change.id)
                continue
              }
              const sourceEngine = await engineForCalendar(sourceCalendar, client, account.id)

              let result: MoveResult
              try {
                result = await moveEventGroup(events, {
                  targetEngine: engine,
                  sourceEngine,
                  sourceHref: parsed.sourceHref,
                  sourceEtag: parsed.sourceEtag,
                })
              } catch (err) {
                if (err instanceof MoveLostSourceError) {
                  // The source was deleted to satisfy a UID-conflict server but
                  // the destination write then failed: replaying a move has
                  // nothing to move. Re-create at the destination instead (the
                  // same recovery the live path uses) and consume this change
                  // so the doomed move stops retrying.
                  // Serialise the WHOLE group (master + detached overrides),
                  // not just the master: a series with RECURRENCE-ID
                  // exceptions must be re-created as one resource or its
                  // overrides are lost forever.
                  storage.addPendingChange({
                    type: 'create',
                    eventId: change.eventId,
                    calendarId: change.calendarId,
                    data: JSON.stringify({
                      events: events.map((e) => ({
                        ...e,
                        resourceHref: undefined,
                        etag: undefined,
                      })),
                    }),
                  })
                  storeUpdateEvent(change.eventId, { syncStatus: 'failed' })
                  break
                }
                throw err
              }
              for (const id of result.memberIds) {
                storeUpdateEvent(id, {
                  calendarId: change.calendarId,
                  resourceHref: result.url,
                  etag: result.etag,
                  syncStatus: 'synced',
                })
              }
              if (!result.sourceDeleted && parsed.sourceHref) {
                storage.addPendingChange({
                  type: 'delete-href',
                  eventId: change.eventId,
                  calendarId: sourceCalendar.id,
                  data: JSON.stringify({
                    href: parsed.sourceHref,
                    etag: parsed.sourceEtag,
                    memberIds: result.memberIds,
                  }),
                })
              }
              break
            }
            case 'delete-href': {
              // Removes ONE leftover resource after a move. Deliberately does
              // not touch the store: the event still exists, it just lives at a
              // different href now. Using 'delete' here would erase it.
              const parsed = JSON.parse(change.data || '{}') as DeleteHrefPendingData
              if (!parsed.href) break
              try {
                // Unconditional DELETE: the href belongs to the moved event's
                // own old resource, and replaying the pre-move etag would 412
                // forever on a strict server that touched it meanwhile — an
                // unrecoverable death-loop. A conditional delete buys nothing
                // when the resource is being discarded anyway.
                await engine.deleteEvent(parsed.href, '')
              } catch (err) {
                const status = (err as { status?: number } | undefined)?.status
                // Already gone is the outcome we wanted.
                if (status !== 404 && status !== 410) throw err
              }
              break
            }
            case 'delete': {
              let pendingEvent: CalendarEvent | undefined
              // Try to get etag from pending change data first (for broken events),
              // then from the live store
              let etag = ''
              if (change.data) {
                try {
                  pendingEvent = JSON.parse(change.data) as CalendarEvent
                  etag = pendingEvent.etag || ''
                } catch {
                  /* ignore parse errors */
                }
              }
              const eventUrl =
                pendingEvent?.resourceHref ||
                `${calendar.url}${eventResourceFilename(change.eventId)}`
              if (!etag) {
                const eventInStore = useCalendarStore
                  .getState()
                  .events.find((e) => e.id === change.eventId)
                etag = eventInStore?.etag || ''
              }
              if (caldavDebugMode) {
                console.log('[CalDAV] Deleting event from server:', eventUrl, 'etag:', etag)
              }
              try {
                await engine.deleteEvent(eventUrl, etag)
              } catch (err) {
                if ((err as { status?: number } | undefined)?.status !== 412) throw err
                // Stale If-Match: re-fetch the current etag and retry once.
                const freshEtag = await client.fetchEtag(eventUrl)
                if (!freshEtag) throw err
                try {
                  await engine.deleteEvent(eventUrl, freshEtag)
                } catch (retryErr) {
                  if ((retryErr as { status?: number } | undefined)?.status !== 412) {
                    throw retryErr
                  }
                  // Even against a fresh etag the server still refuses: the
                  // resource changed again mid-recovery. Do not loop — surface
                  // the conflict and keep the local event (it stays in the
                  // store with syncStatus 'failed' so the user can see it and
                  // delete again). Mirrors the update path's second-412
                  // handling.
                  showToast(
                    `Couldn't delete "${pendingChangeTitle(change) || 'this event'}" — it changed on the server while this delete was queued. The event stays on the server.`
                  )
                  lastAttemptAtByChangeId.delete(change.id)
                  retryAfterByChangeId.delete(change.id)
                  storage.removePendingChange(change.id)
                  failed++
                  conflictHandled = true
                  break
                }
              }
              // Remove from the store: a failed delete re-adds the event with
              // syncStatus='failed' (see deleteEventFn catch), so on a successful
              // retry we must clear it or it lingers as a ghost (gone on server,
              // still local).
              storeDeleteEvent(change.eventId)
              break
            }
          }

          if (conflictHandled) continue

          storage.removePendingChange(change.id)
          retryAfterByChangeId.delete(change.id)
          succeeded++
        } catch (err) {
          const disposition = classifyPendingChangeError(err, change.type)
          switch (disposition.kind) {
            case 'retry':
              // Transient network/offline: never count toward MAX_RETRIES and
              // never drop — the change carries user content.
              failed++
              break
            case 'retry-counted':
            case 'stale-etag': {
              // 'stale-etag' reaches here only when the in-case recovery could
              // not fetch a fresh etag — count it and retry later.
              storage.updatePendingChangeRetry(change.id)
              lastAttemptAtByChangeId.set(change.id, Date.now())
              // A 429 (or any rate-limited response) may carry Retry-After —
              // the server's own minimum wait. Remember it per change so the
              // backoff gate honors it on the next cycle.
              const retryAfter = (err as { retryAfter?: number } | undefined)?.retryAfter
              if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
                retryAfterByChangeId.set(change.id, retryAfter)
              }
              failed++
              break
            }
            case 'drop': {
              showToast(
                pendingChangeDropMessage(
                  change.type,
                  pendingChangeTitle(change),
                  disposition.message
                )
              )
              lastAttemptAtByChangeId.delete(change.id)
              retryAfterByChangeId.delete(change.id)
              storage.removePendingChange(change.id)
              failed++
              break
            }
          }
        }
      }

      const remaining = storage.getPendingChanges()
      setSyncState((prev) => ({ ...prev, pendingChanges: remaining.length }))

      console.log(
        `[CalDAV] Pending changes processed: ${succeeded} succeeded, ${failed} failed, ${remaining.length} remaining`
      )
    } finally {
      isProcessingRef.current = false
    }
  }, [storeUpdateEvent, storeDeleteEvent])

  // Retry pending changes on mount and on a 30-second interval
  useEffect(() => {
    processPendingChanges()

    const interval = setInterval(() => {
      processPendingChanges()
    }, 30000)
    return () => clearInterval(interval)
  }, [processPendingChanges])

  useEffect(() => {
    const loadedAccounts = storage.getAllAccounts()
    const loadedCalendars = storage.getAllCalendars()
    setAccounts(loadedAccounts)
    setCalendars(loadedCalendars)

    const existingIds = storeCalendars.map((c) => c.id)
    for (const cal of loadedCalendars) {
      // Skip the Calino Settings calendar — it's hidden from the UI
      const isSettingsCal = cal.name === 'Calino Settings' || cal.url?.includes('calino-settings')
      const caldavDebugMode = useSettingsStore.getState().caldavDebugMode
      if (isSettingsCal && !caldavDebugMode) continue

      if (!existingIds.includes(cal.id)) {
        storeAddCalendar({
          id: cal.id,
          name: cal.name,
          color: cal.color,
          isVisible: cal.isVisible,
          isDefault: cal.isDefault,
          accountId: cal.accountId,
          showTasksInViews: true,
          supportedComponents: cal.supportedComponents,
          readOnly: cal.readOnly,
        })
      }
    }

    const pending = storage.getPendingChanges()
    setSyncState((prev) => ({ ...prev, pendingChanges: pending.length }))

    // Check for CardDAV support on existing accounts
    const checkCardDAV = async (): Promise<void> => {
      for (const account of loadedAccounts) {
        try {
          const credential = await getCredentialById(account.credentialId)
          if (!credential) continue
          const { createCardDAVClient } = await import('@/features/carddav/client/CardDAVClient')
          const carddavClient = await createCardDAVClient(
            account.serverUrl,
            credential,
            account.proxyUrl
          )
          const addressBooks = await carddavClient.fetchAddressBooks()
          if (addressBooks.length > 0) {
            let hasContacts = false
            for (const book of addressBooks) {
              try {
                const contacts = await carddavClient.fetchContacts(book)
                if (contacts.length > 0) {
                  hasContacts = true
                  break
                }
              } catch {
                // ignore per-book errors
              }
            }
            const { contactsEnabled, updateSettings } = useSettingsStore.getState()
            if (!contactsEnabled && hasContacts) {
              console.log('[CalDAV] Enabling contacts (found contacts in address books)')
              updateSettings({ contactsEnabled: true })
            }
          }
        } catch (err) {
          console.warn('[CalDAV] CardDAV check failed:', err)
        }
      }
    }
    checkCardDAV()
  }, [])

  const addAccount = useCallback(
    async (
      serverUrl: string,
      username: string,
      password: string,
      name: string,
      proxyUrl?: string | null
    ): Promise<void> => {
      setSyncState((prev) => ({ ...prev, status: 'syncing', error: null }))
      useCalDAVSyncStore.getState().setStatus('syncing')

      try {
        console.log('[CalDAV] addAccount: probing server...', serverUrl)
        // probeConnection handles discovery, the PROPFIND, and the base-URL
        // fallback in one pass, and reports *why* a failure happened.
        const probe = await probeConnection(serverUrl, username, password, proxyUrl)
        console.log('[CalDAV] addAccount: probe result:', probe.ok, probe.status ?? '')

        if (!probe.ok) {
          throw new CalDAVConnectionError(
            probe.error ?? 'Failed to connect to server. Please check your credentials.',
            probe.hint
          )
        }

        const discoveredUrl = probe.resolvedUrl ?? serverUrl.replace(/\/$/, '')

        const credential = await saveCredentials({
          serverUrl: discoveredUrl,
          username,
          password,
        })

        console.log('[CalDAV] addAccount: creating client...')
        const client = await createCalDAVClient(discoveredUrl, credential, proxyUrl)
        console.log('[CalDAV] addAccount: fetching calendars...')
        const serverCalendars = await client.fetchCalendars()
        console.log('[CalDAV] addAccount: found', serverCalendars.length, 'calendars')

        const newAccount = storage.saveAccount({
          name,
          serverUrl: discoveredUrl,
          proxyUrl: proxyUrl || null,
          username,
          credentialId: credential.id,
        })

        for (const cal of serverCalendars) {
          // Store the collection without its change cursors. The tokens the
          // server just handed us describe state we have not imported yet — if
          // the import below fails halfway, a stored token would let the next
          // sync skip straight to "nothing changed" and the missing events
          // would never arrive. They are persisted after the import instead.
          storage.saveCalendar({
            ...cal,
            ctag: null,
            syncToken: null,
            accountId: newAccount.id,
          })
          // Hide the Calino Settings calendar from the sidebar (unless debug mode)
          const isSettingsCal =
            cal.name === 'Calino Settings' || cal.url?.includes('calino-settings')
          const caldavDebugMode = useSettingsStore.getState().caldavDebugMode
          if (!isSettingsCal || caldavDebugMode) {
            storeAddCalendar({
              id: cal.id,
              name: cal.name,
              color: cal.color,
              isVisible: cal.isVisible,
              isDefault: cal.isDefault,
              accountId: newAccount.id,
              showTasksInViews: true,
              supportedComponents: cal.supportedComponents,
              readOnly: cal.readOnly,
            })
          }
        }

        const storedCalendars = storage.getAllCalendars()
        const allCalendarsInStore = useCalendarStore.getState().calendars
        // Exclude the hidden Calino Settings calendar — it's never added to
        // the visible calendar store, so picking it as "first" would leave
        // no calendar actually marked default and fall back to Offline.
        const firstVisibleCal = serverCalendars.find(
          (cal) => cal.name !== 'Calino Settings' && !cal.url?.includes('calino-settings')
        )
        if (firstVisibleCal) {
          for (const cal of allCalendarsInStore) {
            if (cal.isDefault) {
              storeUpdateCalendar(cal.id, { isDefault: false })
            }
          }
          for (const cal of storedCalendars) {
            if (cal.isDefault) {
              storage.updateCalendar(cal.id, { isDefault: false })
            }
          }
          const storeCalId = storedCalendars.find((c) => c.url === firstVisibleCal.url)?.id
          if (storeCalId) {
            storeUpdateCalendar(storeCalId, { isDefault: true })
            storage.updateCalendar(storeCalId, { isDefault: true })
          }
        }

        setAccounts(storage.getAllAccounts())
        setCalendars(storage.getAllCalendars())

        // Read fresh state at call time to avoid stale closures
        const accountState = useCalendarStore.getState()
        const accountExistingEvents = accountState.events
        const accountExistingEventIds = new Set(accountExistingEvents.map((e) => e.id))
        const accountStoreCategories = accountState.categories

        const start = '1970-01-01T00:00:00.000Z'
        const end = addDays(new Date(), 365).toISOString()
        const newCategoryNames: string[] = []
        let eventsAdded = 0

        // Fresh connect — re-derive duplicate-UID issues from scratch (#22).
        useCalendarStore.getState().clearDuplicateUidIssues()

        // Fetch the calendars concurrently before processing any of them. This
        // is a fresh connect, so unlike syncAccount there are no pending local
        // changes to snapshot between fetch and reconcile — nothing depends on
        // the fetches being interleaved with the store writes below. Serially
        // this was one full round-trip per calendar.
        //
        // Bounded rather than all-at-once: each fetchEvents is itself three
        // REPORTs (VEVENT/VTODO/VJOURNAL), so an account with a dozen
        // collections would open dozens of simultaneous requests against a
        // server that is often a single-process Radicale. Results stay in
        // calendar order, which the dedup below depends on.
        const fetchedPerCalendar = await mapWithConcurrency(
          serverCalendars,
          CALDAV_FETCH_CONCURRENCY,
          async (cal) => {
            console.log('[CalDAV] addAccount: fetching events for', cal.name, cal.url)
            const fetchedEvents = await client.fetchEvents(cal.url, start, end)
            console.log(
              '[CalDAV] addAccount: got',
              fetchedEvents.length,
              'event objects for',
              cal.name
            )
            return { cal, fetchedEvents }
          }
        )

        // Store writes stay serial and in calendar order, so the
        // already-seen-this-pass dedup below behaves exactly as before.
        for (const { cal, fetchedEvents } of fetchedPerCalendar) {
          const { items: parsedWithHref } = await collectParsedWithHref(fetchedEvents, cal.id)

          // Detect independent events illegally sharing a UID across resources.
          // Keep one deterministically; record the rest as data issues (#22).
          const { issues, skip } = detectUidCollisions(parsedWithHref)
          for (const issue of issues) {
            useCalendarStore.getState().addDuplicateUidIssue(issue)
          }

          for (const item of parsedWithHref) {
            const parsedEvent = item.event
            // Skip collision "losers" so they don't overwrite the kept event.
            if (skip.has(item)) continue

            // Bug 31 fix: do not filter categories by UUID pattern.
            // Let users see all categories from their CalDAV server.
            if (parsedEvent.categories) {
              for (const catName of parsedEvent.categories) {
                const existingCat = accountStoreCategories.find((c) => c.name === catName)
                if (!existingCat && !newCategoryNames.includes(catName)) {
                  newCategoryNames.push(catName)
                }
              }
            }

            // Same UID can appear in more than one calendar on the server
            // (e.g. mirrored into a scheduling/aggregate collection) — treat
            // any id already seen this sync pass as an update, not a fresh
            // add, so it doesn't end up duplicated in the store.
            if (accountExistingEventIds.has(parsedEvent.id)) {
              storeUpdateEvent(parsedEvent.id, parsedEvent)
            } else {
              storeAddEvent(parsedEvent)
              accountExistingEventIds.add(parsedEvent.id)
            }
            eventsAdded++
          }
        }

        console.log(`[CalDAV] addAccount: done — ${eventsAdded} events added`)

        // The import succeeded, so the cursors captured *before* it are now a
        // truthful description of what we hold, and the next sync can go
        // incremental. Captured-before is deliberate: anything written to the
        // server during the import is simply reported again next cycle.
        for (const cal of serverCalendars) {
          const stored = storage.getAllCalendars().find((c) => c.url === cal.url)
          if (!stored) continue
          if (cal.syncToken) storage.updateCalendar(stored.id, { syncToken: cal.syncToken })
          if (cal.ctag) storage.updateCalendar(stored.id, { ctag: cal.ctag })
        }

        // After adding account, check if any journal entries exist and enable journaling if so
        const allEvents = useCalendarStore.getState().events
        const hasJournalEntries = allEvents.some((e) => e.type === 'journal')
        if (hasJournalEntries) {
          const { journalEnabled, updateSettings } = useSettingsStore.getState()
          if (!journalEnabled) {
            console.log('[CalDAV] Enabling journaling after addAccount (found journal entries)')
            updateSettings({ journalEnabled: true })
          }
        }

        for (const catName of newCategoryNames) {
          storeAddCategory({
            id: crypto.randomUUID(),
            name: catName,
            color: EVENT_COLORS[Math.floor(Math.random() * EVENT_COLORS.length)],
          })
        }

        // After calendar sync, check for CardDAV support
        try {
          const { createCardDAVClient } = await import('@/features/carddav/client/CardDAVClient')
          const carddavClient = await createCardDAVClient(serverUrl, credential, proxyUrl ?? null)
          const addressBooks = await carddavClient.fetchAddressBooks()
          if (addressBooks.length > 0) {
            // Only enable contacts if we actually find at least one contact
            let hasContacts = false
            for (const book of addressBooks) {
              try {
                const contacts = await carddavClient.fetchContacts(book)
                console.log(`[CalDAV] Address book "${book.name}" has ${contacts.length} contacts`)
                if (contacts.length > 0) {
                  hasContacts = true
                  break
                }
              } catch (err) {
                console.warn(`[CalDAV] Failed to fetch contacts from "${book.name}":`, err)
              }
            }
            const { contactsEnabled, updateSettings } = useSettingsStore.getState()
            if (!contactsEnabled && hasContacts) {
              console.log('[CalDAV] Enabling contacts (found contacts in address books)')
              updateSettings({ contactsEnabled: true })
            }
          }
        } catch (err) {
          console.warn('[CalDAV] CardDAV check failed:', err)
        }

        storage.updateAccountLastSync(newAccount.id)
        processPendingChanges()

        // Check for broken events after addAccount and notify
        const brokenEventsAfterAdd = useCalendarStore.getState().brokenEvents
        if (brokenEventsAfterAdd.length > 0) {
          showBrokenEventsNotification(brokenEventsAfterAdd.length)
        }

        // Surface any duplicate-UID data issues detected during the connect (#22)
        const duplicateIssuesAfterAdd = useCalendarStore.getState().duplicateUidIssues
        if (duplicateIssuesAfterAdd.length > 0) {
          showDuplicateUidNotification(duplicateIssuesAfterAdd.length)
        }

        setSyncState((prev) => ({
          ...prev,
          status: 'idle',
          lastSyncAt: new Date().toISOString(),
        }))
        useCalDAVSyncStore.getState().setStatus('idle')

        // Auto-discover settings calendar (per spec: check on every account add)
        try {
          const {
            getPrimaryAccountId,
            setPrimaryAccountId,
            setEtag,
            deriveCalendarHomeUrl,
            dtstampToISO,
            deserializeSettings,
            mergeSettings,
            resolveConflict,
            setLastSyncedAt,
          } = await import('@/lib/settingsSync')
          const existingPrimary = getPrimaryAccountId()
          if (!existingPrimary) {
            const { createCalDAVClient: createClient } = await import('../client/CalDAVClient')
            const settingsClient = await createClient(
              newAccount.serverUrl,
              credential,
              newAccount.proxyUrl
            )
            const calHomeUrl = deriveCalendarHomeUrl(newAccount.serverUrl, serverCalendars[0].url)
            const discovered = await settingsClient.discoverSettingsCalendar(calHomeUrl)
            if (discovered) {
              setPrimaryAccountId(newAccount.id)
              const remote = await settingsClient.fetchSettingsEvent(discovered.url)
              let appliedRemote = false
              if (remote) {
                const json = settingsClient.extractSettingsFromVEVENT(remote.data)
                if (json) {
                  const parsed = deserializeSettings(json)
                  if (parsed) {
                    const localSettings = useSettingsStore.getState()
                    const dtstampIso = dtstampToISO(remote.dtstamp)
                    const winner = resolveConflict(new Date(0).toISOString(), dtstampIso)
                    const merged =
                      winner === 'remote'
                        ? mergeSettings(localSettings, parsed.settings)
                        : localSettings
                    useSettingsStore.getState().updateSettings(merged)
                    appliedRemote = true
                  }
                }
                setEtag(remote.etag)
              }
              setLastSyncedAt(new Date().toISOString())
              // Only claim "settings applied" when we actually pulled and
              // applied a remote payload. The collection may exist on the
              // server while being empty — that's a fresh-install case,
              // and the user hasn't actually had anything synced yet.
              if (appliedRemote) {
                showToast('Calino Settings found — sync enabled automatically.')
              } else {
                showToast('Calino Settings calendar found — sync enabled.')
              }
            }
          }
        } catch (err) {
          console.warn('[CalDAV] Settings auto-discovery failed:', err)
        }
      } catch (error) {
        console.error('[CalDAV] addAccount failed:', error)
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to add account',
        }))
        useCalDAVSyncStore.getState().setStatus('idle')
        throw error
      }
    },
    [storeAddEvent, storeUpdateEvent]
  )

  // Auto-connect to preconfigured accounts when unlocked
  const isUnlocked = useConfigStore((state) => state.isUnlocked)
  const hasPreconfiguredAccounts = useConfigStore((state) => state.hasPreconfiguredAccounts)

  useEffect(() => {
    if (!isUnlocked || !hasPreconfiguredAccounts || autoConnectDone) {
      return
    }

    const { config, getDecryptedCredentials } = useConfigStore.getState()
    if (!config) return

    // Mark immediately to prevent any re-runs across all hook instances
    autoConnectDone = true

    const existingAccounts = storage.getAllAccounts()
    const decrypted = getDecryptedCredentials()

    // Run sequentially to avoid localStorage race conditions in saveCredentials
    const connectAccounts = async (): Promise<void> => {
      let connected = 0
      for (let i = 0; i < decrypted.length; i++) {
        const credential = decrypted[i]
        const accountName = config.accounts[i]?.name ?? credential.username

        // Skip if already connected (dedup by URL + username)
        const alreadyConnected = existingAccounts.some(
          (a) => a.serverUrl === credential.url && a.username === credential.username
        )
        if (alreadyConnected) continue

        console.log(`[CalDAV] Auto-connecting to preconfigured account: ${accountName}`)
        try {
          await addAccount(credential.url, credential.username, credential.password, accountName)
          connected++
        } catch (err) {
          console.error(`[CalDAV] Failed to auto-connect ${accountName}:`, err)
        }
      }

      // Remove the default offline calendar if we connected at least one account
      if (connected > 0) {
        const { calendars, events, deleteCalendar } = useCalendarStore.getState()
        const offlineCal = calendars.find((c) => c.id === 'default')
        if (offlineCal && !events.some((e) => e.calendarId === 'default')) {
          deleteCalendar('default')
        }
      }
    }
    connectAccounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked, hasPreconfiguredAccounts])

  const removeAccount = useCallback(async (accountId: string): Promise<void> => {
    const account = storage.getAccountById(accountId)
    if (account) {
      deleteCredential(account.credentialId)
      const accountCalendars = storage.getCalendarsByAccountId(accountId)
      for (const cal of accountCalendars) {
        storeDeleteCalendar(cal.id)
      }
      storage.deleteCalendarsByAccountId(accountId)
      storage.deleteAccount(accountId)

      setAccounts(storage.getAllAccounts())
      setCalendars(storage.getAllCalendars())
    }
  }, [])

  const runSyncAccount = useCallback(
    async (accountId: string): Promise<void> => {
      const account = storage.getAccountById(accountId)
      if (!account) {
        return
      }

      setSyncState((prev) => ({ ...prev, status: 'syncing', error: null }))
      useCalDAVSyncStore.getState().setStatus('syncing')

      // Errors from individual calendars, accumulated so one collection
      // failing never silences the others.
      const syncErrors: string[] = []

      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const accountCalendars = storage.getCalendarsByAccountId(accountId)
        let calendarsToSync = accountCalendars

        // Change cursors as the server reports them *right now*, keyed by
        // local calendar id. Deliberately not written to storage here: a token
        // is only truthful once the changes it excludes have actually been
        // reconciled, so each calendar persists its own after a successful
        // pass (see `commitCursors` below).
        const freshCursors = new Map<string, { ctag: string | null; syncToken: string | null }>()

        // Re-discover collections on every sync. This migrates capabilities
        // saved by older versions and picks up calendars created elsewhere.
        try {
          const serverCalendars = await client.fetchCalendars()

          // A PROPFIND that comes back empty almost always means a transient
          // failure, an auth/scope hiccup, or a misbehaving server response —
          // not "the user deleted every calendar." Treating it as authoritative
          // would wipe out every local calendar and all of their events in one
          // sync. Bail out of reconciliation for this cycle instead; it will be
          // retried on the next sync.
          if (serverCalendars.length === 0 && accountCalendars.length > 0) {
            throw new Error(
              'Server returned zero calendars; refusing to treat this as an authoritative listing'
            )
          }

          const storedByUrl = new Map(accountCalendars.map((calendar) => [calendar.url, calendar]))
          const serverUrls = new Set(serverCalendars.map((calendar) => calendar.url))
          const discoveredCalendars = accountCalendars.filter((calendar) =>
            serverUrls.has(calendar.url)
          )
          const caldavDebugMode = useSettingsStore.getState().caldavDebugMode

          // A collection deleted by another CalDAV client must not remain in
          // the sidebar or be fetched during this sync.
          for (const storedCalendar of accountCalendars) {
            if (!serverUrls.has(storedCalendar.url)) {
              storage.deleteCalendar(storedCalendar.id)
              storeDeleteCalendar(storedCalendar.id)
            }
          }

          for (const serverCalendar of serverCalendars) {
            const storedCalendar = storedByUrl.get(serverCalendar.url)
            if (storedCalendar) {
              // Collection metadata is server-authoritative. Keep UI-owned
              // visibility and default-calendar preferences intact.
              const updates = {
                name: serverCalendar.name,
                color: serverCalendar.color,
                supportedComponents: serverCalendar.supportedComponents,
                readOnly: serverCalendar.readOnly,
                isSubscribed: serverCalendar.isSubscribed,
                calendarOrder: serverCalendar.calendarOrder,
              }
              storage.updateCalendar(storedCalendar.id, updates)
              storeUpdateCalendar(storedCalendar.id, updates)
              freshCursors.set(storedCalendar.id, {
                ctag: serverCalendar.ctag,
                syncToken: serverCalendar.syncToken,
              })
              continue
            }

            // A collection we have never listed: store it cursor-less so the
            // first pass below is a full fetch. Persisting the server's token
            // here would make this sync's own skip check believe we are
            // already up to date with a calendar we hold nothing from.
            const newCalendar = { ...serverCalendar, accountId, ctag: null, syncToken: null }
            storage.saveCalendar(newCalendar)
            discoveredCalendars.push(newCalendar)
            freshCursors.set(serverCalendar.id, {
              ctag: serverCalendar.ctag,
              syncToken: serverCalendar.syncToken,
            })

            const isSettingsCalendar =
              serverCalendar.name === 'Calino Settings' ||
              serverCalendar.url?.includes('calino-settings')
            if (!isSettingsCalendar || caldavDebugMode) {
              storeAddCalendar({
                id: serverCalendar.id,
                name: serverCalendar.name,
                color: serverCalendar.color,
                isVisible: serverCalendar.isVisible,
                isDefault: serverCalendar.isDefault,
                accountId,
                showTasksInViews: true,
                supportedComponents: serverCalendar.supportedComponents,
                readOnly: serverCalendar.readOnly,
              })
            }
          }

          calendarsToSync = discoveredCalendars
          setCalendars(storage.getAllCalendars())
        } catch (error) {
          console.warn('[CalDAV] Could not refresh calendar collections:', error)
        }

        const start = '1970-01-01T00:00:00.000Z'
        const end = addDays(new Date(), 365).toISOString()

        // Read fresh state at call time to avoid stale closures
        const state = useCalendarStore.getState()
        const currentEvents = state.events
        const currentCategories = state.categories

        // Re-derive duplicate-UID issues from scratch each sync (#22). A
        // collision is only visible in a complete listing, so issues belonging
        // to calendars this pass does not fully re-list are restored
        // afterwards rather than silently dropped.
        const issuesBeforeSync = useCalendarStore.getState().duplicateUidIssues
        useCalendarStore.getState().clearDuplicateUidIssues()
        const fullyListedCalendarIds = new Set<string>()

        /**
         * Persist a calendar's change cursors. Called only after that
         * calendar's changes have been fully applied — a token committed any
         * earlier moves the cursor past changes we never stored, and the
         * server will never mention them again.
         */
        const commitCursors = (
          calendarId: string,
          syncToken: string | null,
          ctag: string | null
        ): void => {
          if (syncToken) storage.updateCalendar(calendarId, { syncToken })
          if (ctag) storage.updateCalendar(calendarId, { ctag })
        }

        for (const cal of calendarsToSync) {
          try {
            const fresh = freshCursors.get(cal.id) ?? { ctag: null, syncToken: null }
            const storedToken = cal.syncToken ?? null

            // ctag is a change hint, not a tombstone authority — and it is
            // only trusted to mean "skip" when we also hold a sync token, i.e.
            // when some earlier pass reconciled cleanly and left a cursor. A
            // missing or invalidated token always re-syncs.
            if (storedToken && cal.ctag && fresh.ctag && cal.ctag === fresh.ctag) {
              // Logged, because "skipped" and "silently did nothing" are
              // otherwise indistinguishable from the console — the whole
              // point of this branch is that it emits no network traffic.
              console.log(`[CalDAV] ${calendarLabel(cal)}: skipped, ctag unchanged`)
              continue
            }

            // `null` = no usable cursor, run the full-listing path below.
            let changes: SyncCollectionChange[] | null = null
            let nextToken: string | null = fresh.syncToken

            if (storedToken) {
              const report = await client.syncCollection(cal.url, storedToken)
              if (report.tokenInvalidated) {
                // RFC 6578 §3.2 — the cursor is dead. Fall back to a full
                // listing and re-establish a token from this cycle's PROPFIND.
                console.warn(
                  `[CalDAV] Sync token rejected for calendar ${cal.name || cal.id}; falling back to a full sync.`
                )
              } else {
                changes = report.changes
                // A server that returns no new token leaves us on the old one:
                // the same changes get replayed next cycle, which is harmless.
                nextToken = report.newSyncToken ?? storedToken
              }
            }

            // Hrefs whose local components this pass is allowed to delete.
            // In incremental mode that is exactly the resources the server
            // named; in full mode the whole collection is authoritative.
            const touchedHrefs: Set<string> | null = changes ? new Set<string>() : null
            const removedHrefs = new Set<string>()
            let fetchedEvents: { url: string; data: string; etag?: string }[]

            if (changes) {
              for (const change of changes) {
                touchedHrefs?.add(hrefKey(change.href))
                if (change.status === 'removed') removedHrefs.add(hrefKey(change.href))
              }

              // Resource-level GETs, not the time-windowed query: a changed
              // resource can sit far outside the sync window, or have changed
              // in a way that never moves DTSTART. A failure here throws and
              // is caught below, which leaves the old token in place.
              //
              // Bounded fan-out: a first delta can name hundreds of
              // resources. Results come back in REPORT order regardless of
              // which GET finished first, so everything downstream — parsing,
              // duplicate resolution, store writes — stays deterministic and
              // serial.
              const changed = changes.filter((change) => change.status === 'changed')
              console.log(
                `[CalDAV] ${calendarLabel(cal)}: incremental sync, ${changed.length} changed, ${
                  changes.length - changed.length
                } removed`
              )
              const fetched = await mapWithConcurrency(
                changed,
                CALDAV_FETCH_CONCURRENCY,
                async (change) => {
                  const resource = await client.fetchResourceByHref(change.href)
                  if (!resource) return { change, resource: null }
                  return {
                    change,
                    resource: { ...resource, etag: resource.etag ?? change.etag ?? undefined },
                  }
                }
              )

              fetchedEvents = []
              for (const { change, resource } of fetched) {
                if (!resource) {
                  // Deleted between the REPORT and the GET — a tombstone, not
                  // a failure.
                  removedHrefs.add(hrefKey(change.href))
                  continue
                }
                fetchedEvents.push(resource)
              }

              if (changes.length === 0) {
                // Nothing changed server-side; the cursor still advances.
                commitCursors(cal.id, nextToken, fresh.ctag)
                continue
              }
            } else {
              console.log(
                `[CalDAV] ${calendarLabel(cal)}: full listing${
                  storedToken ? ' (sync token unusable)' : ' (no stored sync token)'
                }`
              )
              fetchedEvents = await client.fetchEvents(cal.url, start, end, true)
              fullyListedCalendarIds.add(cal.id)
            }

            // Snapshot pending local changes after the network fetch, as late as
            // possible before reconciliation. They must win over remote state.
            const pendingLocalChangeIds = pendingGuardedEventIds(storage.getPendingChanges())
            // Also skip events whose server DELETE is in flight right now: on the
            // happy path no pending-change tombstone is written, so without this a
            // sync racing the delete would re-add the event.
            for (const id of inFlightDeletes) pendingLocalChangeIds.add(id)

            // Get events that belong to this calendar, indexed by id for O(1) lookup
            const calendarEvents = currentEvents.filter((e) => e.calendarId === cal.id)
            const calendarEventsById = new Map(calendarEvents.map((e) => [e.id, e]))
            const serverEventIds = new Set<string>()
            const newCategoryNames: string[] = []

            const { items: parsedWithHref, hadParseFailures } = await collectParsedWithHref(
              fetchedEvents,
              cal.id
            )

            // Detect independent events illegally sharing a UID across resources.
            // Keep one deterministically; record the rest as data issues (#22).
            const { issues, skip } = detectUidCollisions(parsedWithHref)
            for (const issue of issues) {
              useCalendarStore.getState().addDuplicateUidIssue(issue)
            }

            // R2.7 — UIDs whose *master* VTODO is cancelled. A cancelled master
            // takes its whole series with it, overrides included, per RFC 5545
            // §3.8.1.11: STATUS applies to the component it appears on, and the
            // master defines the recurrence set the overrides belong to.
            const cancelledTaskUids = new Set<string>()
            for (const item of parsedWithHref) {
              const e = item.event
              if (e.type === 'task' && !e.recurrenceId && e.taskStatus === 'CANCELLED') {
                cancelledTaskUids.add(e.uid || e.id)
              }
            }

            for (const item of parsedWithHref) {
              const parsedEvent = item.event

              // Skip collision "losers" so they don't overwrite the kept event.
              if (skip.has(item)) {
                continue
              }

              // Do not overwrite a local change waiting to be pushed.
              if (pendingLocalChangeIds.has(parsedEvent.id)) {
                serverEventIds.add(parsedEvent.id)
                continue
              }

              // Some CalDAV task clients retain deleted VTODO resources with
              // STATUS:CANCELLED instead of issuing DELETE. Treat that as a
              // remote deletion so the task does not remain in Calino.
              //
              // R2.7 — but only for a *master*. A cancelled detached override is
              // the RFC-blessed way to cancel a single occurrence of a recurring
              // task; dropping it here would let the master regenerate that
              // occurrence, so the cancellation would silently undo itself on
              // every sync. Overrides only go when their master goes.
              if (parsedEvent.type === 'task' && parsedEvent.taskStatus === 'CANCELLED') {
                if (!parsedEvent.recurrenceId) continue
              }
              if (
                parsedEvent.type === 'task' &&
                parsedEvent.recurrenceId &&
                cancelledTaskUids.has(parsedEvent.uid || parsedEvent.recurrenceMasterId || '')
              ) {
                continue
              }

              serverEventIds.add(parsedEvent.id)

              // Collect category names for auto-creation
              // Bug 31 fix: do not filter categories by UUID pattern.
              // Let users see all categories from their CalDAV server.
              if (parsedEvent.categories) {
                for (const catName of parsedEvent.categories) {
                  const existingCat = currentCategories.find((c) => c.name === catName)
                  if (!existingCat && !newCategoryNames.includes(catName)) {
                    newCategoryNames.push(catName)
                  }
                }
              }

              const existingEvent = calendarEventsById.get(parsedEvent.id) ?? null

              if (existingEvent) {
                const serverSeq = parsedEvent.sequence ?? 0
                const localSeq = existingEvent.sequence ?? 0

                let shouldUpdate = false
                const isConflict = serverSeq !== localSeq

                if (serverSeq > localSeq) {
                  shouldUpdate = conflictResolution === 'server-wins'
                } else if (localSeq > serverSeq) {
                  shouldUpdate = conflictResolution === 'local-wins'
                } else {
                  // Same sequence - no real conflict, safe to sync from server
                  shouldUpdate = true
                }

                // Bug 22 fix: for 'ask' mode, never auto-update on conflicts.
                // Store conflict info for UI display.
                if (isConflict && conflictResolution === 'ask') {
                  const conflict: ConflictInfo = {
                    eventId: parsedEvent.id,
                    localVersion: existingEvent,
                    serverVersion: parsedEvent,
                    resolution: 'ask',
                  }
                  setSyncState((prev) => ({
                    ...prev,
                    conflicts: [...prev.conflicts, conflict],
                  }))
                  console.log(
                    `[CalDAV] Conflict detected for event ${parsedEvent.id} (local seq ${localSeq} vs server seq ${serverSeq}). Awaiting user resolution.`
                  )
                  continue
                }

                if (shouldUpdate) {
                  storeUpdateEvent(parsedEvent.id, parsedEvent)
                }
              } else {
                storeAddEvent(parsedEvent)
              }
            }

            // Auto-create categories from server
            for (const catName of newCategoryNames) {
              storeAddCategory({
                id: crypto.randomUUID(),
                name: catName,
                color: EVENT_COLORS[Math.floor(Math.random() * EVENT_COLORS.length)],
              })
            }

            // The complete collection listing makes absence an authoritative
            // remote deletion. Never remove a local change waiting to be pushed.
            // Skip deletion entirely if any resource in this fetch failed to
            // parse: that resource's UID is unknown to us, so we cannot tell
            // whether the local event it corresponds to is genuinely gone or
            // just temporarily unreadable. Treating the listing as authoritative
            // in that case could delete an event that still exists on the
            // server. Adds/updates from resources that DID parse are unaffected.
            //
            // In incremental mode the listing is deliberately partial, so
            // absence is only authoritative for the resources the server
            // actually named this cycle: a tombstoned resource (nothing came
            // back for it) and a changed resource that no longer contains a
            // component it used to — a deleted recurrence override, say.
            // Every other local event is simply not covered by this REPORT.
            if (!hadParseFailures) {
              const deletionCandidates = touchedHrefs
                ? calendarEvents.filter(
                    (e) => e.resourceHref && touchedHrefs.has(hrefKey(e.resourceHref))
                  )
                : calendarEvents
              for (const localEvent of deletionCandidates) {
                if (
                  !serverEventIds.has(localEvent.id) &&
                  !pendingLocalChangeIds.has(localEvent.id)
                ) {
                  storeDeleteEvent(localEvent.id)
                  // Drop the cached original too, but only when the resource
                  // itself is gone: a resource that merely lost one component
                  // still has authoritative bytes worth keeping.
                  if (
                    localEvent.resourceHref &&
                    removedHrefs.has(hrefKey(localEvent.resourceHref))
                  ) {
                    await deleteRawIcs(localEvent.resourceHref).catch(() => {})
                  }
                }
              }
              commitCursors(cal.id, nextToken, fresh.ctag)
            } else {
              // Reconciliation is incomplete, so the cursors stay where they
              // are: advancing them would retire the server's only mention of
              // a resource we could not read. A body that failed to parse is
              // never a deletion — it is retried next cycle.
              console.warn(
                `[CalDAV] Skipping remote-deletion reconciliation for calendar ${cal.id}: one or more resources failed to parse this cycle.`
              )
            }
          } catch (err) {
            // One calendar failing must not stop the rest from syncing: log,
            // accumulate, and let the account sync finish — the pending queue
            // still drains (see the finally below).
            console.warn(`[CalDAV] Sync failed for calendar ${cal.id}:`, err)
            syncErrors.push(
              `calendar ${cal.name || cal.id}: ${err instanceof Error ? err.message : String(err)}`
            )
          }
        }

        // Collisions can only be seen in a complete listing. Calendars that
        // ran incrementally (or were skipped on an unchanged ctag) keep the
        // issues the last full listing found, instead of appearing clean.
        for (const issue of issuesBeforeSync) {
          if (!fullyListedCalendarIds.has(issue.calendarId)) {
            useCalendarStore.getState().addDuplicateUidIssue(issue)
          }
        }

        storage.updateAccountLastSync(accountId)

        // Check for broken events after sync and notify
        const brokenEventsAfterSync = useCalendarStore.getState().brokenEvents
        if (brokenEventsAfterSync.length > 0) {
          showBrokenEventsNotification(brokenEventsAfterSync.length)
        }

        // Surface any duplicate-UID data issues detected during the sync (#22)
        const duplicateIssuesAfterSync = useCalendarStore.getState().duplicateUidIssues
        if (duplicateIssuesAfterSync.length > 0) {
          showDuplicateUidNotification(duplicateIssuesAfterSync.length)
        }

        // After sync, check if any journal entries exist and enable journaling if so
        const allEvents = useCalendarStore.getState().events
        const hasJournalEntries = allEvents.some((e) => e.type === 'journal')
        console.log('[CalDAV] Journal check after sync:', {
          totalEvents: allEvents.length,
          journalEntries: allEvents.filter((e) => e.type === 'journal').length,
          hasJournalEntries,
        })
        if (hasJournalEntries) {
          const { journalEnabled, updateSettings } = useSettingsStore.getState()
          console.log('[CalDAV] Journal enabled status:', journalEnabled)
          if (!journalEnabled) {
            console.log('[CalDAV] Enabling journaling...')
            updateSettings({ journalEnabled: true })
          }
        }

        setSyncState((prev) => ({
          ...prev,
          status: 'idle',
          lastSyncAt: new Date().toISOString(),
        }))
        useCalDAVSyncStore.getState().setStatus('idle')

        // Pull CalDAV settings after calendar sync completes
        try {
          const {
            getPrimaryAccountId,
            deriveCalendarHomeUrl,
            dtstampToISO,
            deserializeSettings,
            mergeSettings,
            resolveConflict,
            setEtag,
            setLastSyncedAt,
            getLastSyncedAt,
          } = await import('@/lib/settingsSync')
          if (getPrimaryAccountId() === accountId) {
            const { createCalDAVClient: createClient } = await import('../client/CalDAVClient')
            const cal = accountCalendars[0]
            if (cal) {
              const calHomeUrl = deriveCalendarHomeUrl(account.serverUrl, cal.url)
              const settingsClient = await createClient(
                account.serverUrl,
                credential,
                account.proxyUrl
              )
              const discovered = await settingsClient.discoverSettingsCalendar(calHomeUrl)
              if (discovered) {
                const remote = await settingsClient.fetchSettingsEvent(discovered.url)
                if (remote) {
                  const json = settingsClient.extractSettingsFromVEVENT(remote.data)
                  if (json) {
                    const parsed = deserializeSettings(json)
                    if (parsed) {
                      const localSettings = useSettingsStore.getState()
                      const dtstampIso = dtstampToISO(remote.dtstamp)
                      const localSyncedAt = getLastSyncedAt()
                      const winner = resolveConflict(
                        localSyncedAt || '1970-01-01T00:00:00Z',
                        dtstampIso
                      )
                      if (winner === 'remote') {
                        const merged = mergeSettings(localSettings, parsed.settings)
                        useSettingsStore.getState().updateSettings(merged)
                      }
                      setLastSyncedAt(new Date().toISOString())
                    }
                  }
                  setEtag(remote.etag)
                }
              }
            }
          }
        } catch (err) {
          console.warn('[CalDAV] Settings pull after sync failed:', err)
        }
      } catch (error) {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Sync failed',
        }))
        useCalDAVSyncStore.getState().setStatus('idle')
        throw error
      } finally {
        // Drain the queue even when the sync itself failed: a queued edit
        // must not wait for a fully successful sync.
        await processPendingChanges()
      }

      if (syncErrors.length > 0) {
        throw new Error(`Sync finished with errors: ${syncErrors.join('; ')}`)
      }
    },
    [conflictResolution]
  )

  const syncAccount = useCallback(
    (accountId: string): Promise<void> => {
      const existing = inFlightSyncs.get(accountId)
      if (existing) return existing
      const run = runSyncAccount(accountId).finally(() => {
        inFlightSyncs.delete(accountId)
      })
      inFlightSyncs.set(accountId, run)
      return run
    },
    [runSyncAccount]
  )

  /** Probe an existing account's stored credentials. Read-only — persists nothing. */
  const testAccount = useCallback(async (accountId: string): Promise<ProbeResult> => {
    const account = storage.getAccountById(accountId)
    if (!account) {
      return { ok: false, error: 'Account not found' }
    }
    const credential = await getCredentialById(account.credentialId)
    if (!credential) {
      return { ok: false, error: 'Credentials not found' }
    }
    return probeConnection(
      account.serverUrl,
      account.username,
      credential.password,
      account.proxyUrl
    )
  }, [])

  const updateAccount = useCallback(
    async (
      accountId: string,
      updates: {
        name: string
        serverUrl: string
        username: string
        password?: string
        proxyUrl?: string | null
      }
    ): Promise<void> => {
      const account = storage.getAccountById(accountId)
      if (!account) {
        return
      }
      const credential = await getCredentialById(account.credentialId)
      if (!credential) {
        throw new Error('Credentials not found')
      }

      // A blank password means "keep the current one".
      const effectivePassword = updates.password || credential.password
      const proxyUrl = updates.proxyUrl ?? null

      const expanded = expandProviderUrl(updates.serverUrl, updates.username)
      const effectiveUrl = expanded || updates.serverUrl

      // Probe before touching storage: a failed edit must leave the account
      // exactly as it was, not half-written with credentials that don't work.
      const probe = await probeConnection(
        effectiveUrl,
        updates.username,
        effectivePassword,
        proxyUrl,
        updates.serverUrl
      )
      if (!probe.ok) {
        throw new Error(probe.error ?? 'Could not connect with these settings')
      }
      const resolvedUrl = probe.resolvedUrl ?? effectiveUrl

      // Only a different principal invalidates the calendars stored for this
      // account — a rename or password rotation leaves their URLs valid.
      const principalChanged =
        resolvedUrl !== account.serverUrl || updates.username !== account.username

      await updateCredential(account.credentialId, {
        serverUrl: resolvedUrl,
        username: updates.username,
        // updateCredential re-encrypts only when this is truthy, so a blank
        // password leaves the stored one untouched.
        password: updates.password || undefined,
      })
      storage.updateAccount(accountId, {
        name: updates.name,
        serverUrl: resolvedUrl,
        username: updates.username,
        proxyUrl,
      })

      if (principalChanged) {
        // syncAccount only walks calendars already stored for the account, so
        // it can never discover the new principal's calendars. Re-fetch and
        // reconcile by url here, before handing off to it for the event pull.
        const freshCredential = {
          ...credential,
          serverUrl: resolvedUrl,
          username: updates.username,
          password: effectivePassword,
        }
        const client = await createCalDAVClient(resolvedUrl, freshCredential, proxyUrl)
        const serverCalendars = await client.fetchCalendars()

        const storedCalendars = storage.getCalendarsByAccountId(accountId)
        const serverUrls = new Set(serverCalendars.map((c) => c.url))
        const storedUrls = new Set(storedCalendars.map((c) => c.url))

        // Drop calendars the new principal doesn't have, so they don't linger
        // in the sidebar pointing at the old account's URLs.
        for (const cal of storedCalendars) {
          if (!serverUrls.has(cal.url)) {
            storage.deleteCalendar(cal.id)
            storeDeleteCalendar(cal.id)
          }
        }

        // Add only genuinely new calendars. Survivors are left alone so their
        // local color, visibility, and default flag are preserved.
        const caldavDebugMode = useSettingsStore.getState().caldavDebugMode
        for (const cal of serverCalendars) {
          if (storedUrls.has(cal.url)) {
            continue
          }
          storage.saveCalendar({ ...cal, accountId })
          const isSettingsCal =
            cal.name === 'Calino Settings' || cal.url?.includes('calino-settings')
          if (!isSettingsCal || caldavDebugMode) {
            storeAddCalendar({
              id: cal.id,
              name: cal.name,
              color: cal.color,
              isVisible: cal.isVisible,
              isDefault: cal.isDefault,
              accountId,
              showTasksInViews: true,
              supportedComponents: cal.supportedComponents,
              readOnly: cal.readOnly,
            })
          }
        }
      }

      await syncAccount(accountId)

      setAccounts(storage.getAllAccounts())
      setCalendars(storage.getAllCalendars())
    },
    [syncAccount, storeAddCalendar, storeDeleteCalendar]
  )

  const syncAll = useCallback(async (): Promise<void> => {
    // One account failing must not prevent the rest from syncing: runSyncAccount
    // reports failures through syncState and rethrows, so catch here, keep
    // going, and surface a combined error only after every account had a turn.
    const errors: string[] = []
    for (const account of accounts) {
      try {
        await syncAccount(account.id)
      } catch (err) {
        console.warn(`[CalDAV] Sync failed for account ${account.id}:`, err)
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    if (errors.length > 0) {
      throw new Error(`Sync finished with errors: ${errors.join('; ')}`)
    }
  }, [accounts, syncAccount])

  const createEvent = useCallback(
    async (calendarId: string, event: CalendarEvent): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] createEvent called:', {
          calendarId,
          eventId: event.id,
          eventTitle: event.title,
        })
      }

      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((c) => c.id === calendarId)
      const account = allAccounts.find((a) => a.id === calendar?.accountId)

      if (caldavDebugMode) {
        console.log('[CalDAV] Looking up calendar:', {
          calendarId,
          foundCalendar: !!calendar,
          calendar,
          accountId: calendar?.accountId,
        })
        console.log(
          '[CalDAV] Available calendars:',
          allCalendars.map((c) => ({ id: c.id, accountId: c.accountId, name: c.name }))
        )
        console.log(
          '[CalDAV] Available accounts:',
          allAccounts.map((a) => ({ id: a.id, name: a.name }))
        )
      }

      if (!calendar || !account) {
        console.warn('[CalDAV] createEvent: No calendar or account found', {
          calendarId,
          calendarFound: !!calendar,
          accountFound: !!account,
        })
        // Offline / sample-data mode: no CalDAV accounts configured, so there is
        // nothing to sync. Skip silently instead of surfacing a sync error.
        if (allAccounts.length === 0) return
        showToast('Failed to sync event with CalDAV server. It will be retried.')
        return
      }

      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const engine = new SyncEngine(client, calendarId)

        const eventWithSequence: CalendarEvent = {
          ...event,
          sequence: 0,
        }

        if (caldavDebugMode) {
          console.log('[CalDAV] Pushing event to server...')
        }

        const { url, etag } = await engine.pushEvent(eventWithSequence)

        if (caldavDebugMode) {
          console.log('[CalDAV] Event pushed successfully!')
        }

        // Capture the server-assigned etag so the next sync round-trip
        // sends If-Match against the current server resource. Without this
        // we'd send the empty pre-push etag and strict servers (Radicale,
        // iCloud) would reject the next update.
        storeUpdateEvent(event.id, { resourceHref: url, etag, syncStatus: 'synced' })

        storage.updateAccountLastSync(account.id)
        processPendingChanges()
      } catch (error) {
        if (caldavDebugMode) {
          console.log('[CalDAV] createEvent failed, adding to pending changes:', error)
        }
        storage.addPendingChange({
          type: 'create',
          eventId: event.id,
          calendarId,
          data: JSON.stringify(event),
        })
        // Mark the event as failed in the store so the user can see the sync error
        storeUpdateEvent(event.id, { syncStatus: 'failed' })
        setSyncState((prev) => ({
          ...prev,
          pendingChanges: prev.pendingChanges + 1,
        }))
        throw error
      }
    },
    [caldavDebugMode, storeUpdateEvent]
  )

  /**
   * Create every component of ONE calendar object resource in a single PUT.
   *
   * A recurrence master and its RECURRENCE-ID overrides share a UID and MUST
   * live in one resource (RFC 4791 §4.1); `createEvent` writes one resource
   * per component, which splits them. Used by .ics import, where a file
   * routinely carries a master plus overrides under the same UID.
   *
   * `putEventGroup` sends an empty `If-Match` on purpose (tsdav drops a falsy
   * one), so a retried import overwrites its own partial result rather than
   * 412-ing the way tsdav's `If-None-Match: *` create would.
   */
  const createEventGroup = useCallback(
    async (calendarId: string, events: CalendarEvent[]): Promise<void> => {
      if (events.length === 0) return

      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((c) => c.id === calendarId)
      const account = allAccounts.find((a) => a.id === calendar?.accountId)

      // Local-only calendar, or sample-data mode with no accounts: the events
      // are already in the store and there is nothing to sync.
      if (!calendar || !account) {
        if (allAccounts.length === 0) return
        showToast('Failed to sync event with CalDAV server. It will be retried.')
        return
      }

      // Same convention as createEvent: a freshly created resource starts at
      // SEQUENCE 0 regardless of what the source file claimed.
      const group = events.map((event) => ({ ...event, sequence: 0 }))
      const master = group.find((event) => !event.recurrenceId) ?? group[0]

      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) throw new Error('Credentials not found')

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const engine = new SyncEngine(client, calendarId)
        const { url, etag } =
          group.length > 1 ? await engine.putEventGroup(group) : await engine.pushEvent(master)

        for (const event of group) {
          storeUpdateEvent(event.id, { resourceHref: url, etag, syncStatus: 'synced' })
        }
        storage.updateAccountLastSync(account.id)
        processPendingChanges()
      } catch (error) {
        // Queue the whole group as one 'create' — that handler already accepts
        // a { events: [...] } payload and replays it through putEventGroup, so
        // an offline import lands as a single resource when the network returns.
        storage.addPendingChange({
          type: 'create',
          eventId: master.id,
          calendarId,
          data: JSON.stringify({ events: group }),
        })
        for (const event of group) {
          storeUpdateEvent(event.id, { syncStatus: 'failed' })
        }
        setSyncState((prev) => ({ ...prev, pendingChanges: prev.pendingChanges + 1 }))
        throw error
      }
    },
    [storeUpdateEvent, processPendingChanges]
  )

  const saveRecurrenceOverrideFn = useCallback(
    async (
      calendarId: string,
      master: CalendarEvent,
      exception: CalendarEvent | null,
      removedExceptionIds: string[] = []
    ): Promise<void> => {
      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((item) => item.id === calendarId)
      const account = allAccounts.find((item) => item.id === calendar?.accountId)

      // Local-only calendars have no remote resource to update.
      if (!calendar) {
        storeUpdateEvent(master.id, master)
        for (const eventId of removedExceptionIds) storeDeleteEvent(eventId)
        if (exception) storeAddEvent(exception)
        return
      }
      if (!account) throw new Error('Calendar account not found')

      const credential = await getCredentialById(account.credentialId)
      if (!credential) throw new Error('Credentials not found')

      const uid = master.uid || master.id
      const existingOverrides = useCalendarStore
        .getState()
        .events.filter(
          (event) =>
            event.id !== exception?.id &&
            !removedExceptionIds.includes(event.id) &&
            event.calendarId === calendarId &&
            Boolean(event.recurrenceId) &&
            (event.uid === uid || event.recurrenceMasterId === master.id)
        )
      const masterWithSequence = { ...master, uid, sequence: (master.sequence ?? 0) + 1 }
      const normalizedException = exception
        ? {
            ...exception,
            uid,
            recurrenceMasterId: master.id,
            sequence: masterWithSequence.sequence,
          }
        : null

      const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
      const engine = new SyncEngine(client, calendarId)
      const groupedEvents = withResourceSiblings(
        [
          masterWithSequence,
          ...existingOverrides,
          ...(normalizedException ? [normalizedException] : []),
        ],
        useCalendarStore.getState().events,
        master.resourceHref,
        removedExceptionIds
      )
      let url: string
      let etag: string
      try {
        ;({ url, etag } = await engine.updateEventGroup(groupedEvents, master.etag ?? ''))
      } catch (error) {
        // R2.7 — Offline or a failed PUT must not silently swallow the edit.
        // Everything here used to be written only after a successful round
        // trip, so a dropped connection lost the change entirely with no toast
        // and nothing queued — and completing a recurring task now routes
        // through this function, which made that path much easier to hit.
        // Apply the change locally, queue a replay of the master (whose update
        // rebuilds the whole group), and let the caller see the throw.
        storeUpdateEvent(master.id, { ...masterWithSequence, syncStatus: 'pending' })
        for (const eventId of removedExceptionIds) storeDeleteEvent(eventId)
        if (normalizedException) {
          storeAddEvent({ ...normalizedException, syncStatus: 'pending' })
        }
        storage.addPendingChange({
          type: 'update',
          eventId: master.id,
          calendarId,
          data: JSON.stringify(masterWithSequence),
        })
        setSyncState((prev) => ({ ...prev, pendingChanges: prev.pendingChanges + 1 }))
        showToast('Failed to sync with CalDAV server. It will be retried.')
        throw error
      }

      for (const groupedEvent of groupedEvents) {
        storeUpdateEvent(groupedEvent.id, { resourceHref: url, etag, syncStatus: 'synced' })
      }
      storeUpdateEvent(master.id, {
        ...masterWithSequence,
        resourceHref: url,
        etag,
        syncStatus: 'synced',
      })
      for (const eventId of removedExceptionIds) storeDeleteEvent(eventId)
      if (normalizedException) {
        storeAddEvent({
          ...normalizedException,
          resourceHref: url,
          etag,
          syncStatus: 'synced',
        })
      }
      storage.updateAccountLastSync(account.id)
    },
    [storeAddEvent, storeDeleteEvent, storeUpdateEvent]
  )

  const updateEventFn = useCallback(
    async (calendarId: string, event: CalendarEvent): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] updateEvent called:', {
          calendarId,
          eventId: event.id,
          eventTitle: event.title,
        })
      }

      // R2.7 — Never PUT a task override as a standalone resource. RFC 4791
      // §4.1 requires every component sharing a UID to live in one calendar
      // object resource; splitting them orphans the override on its own href
      // and trips detectUidCollisions. Route it through the group write, which
      // rebuilds the master's resource with every override in it. (VEVENT
      // overrides reach the same place via withResourceSiblings below, since
      // they already carry the master's resourceHref.)
      if (event.type === 'task' && event.recurrenceId) {
        const master = findRecurrenceMaster(event)
        // Only when the two already share a resource, mirroring deleteEvent.
        // Nextcloud Tasks PUTs its exceptions to a SEPARATE href; folding such
        // an override into the master's resource here would write a second
        // copy while leaving the original standalone resource on the server,
        // and it would come back as a duplicate on the next sync. Rewriting
        // its own resource in place is correct there.
        if (master && (!event.resourceHref || master.resourceHref === event.resourceHref)) {
          await saveRecurrenceOverrideFn(calendarId, master, event, [])
          return
        }
      }

      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((c) => c.id === calendarId)
      const account = allAccounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        console.warn('[CalDAV] updateEvent: No calendar or account found', {
          calendarId,
          calendarFound: !!calendar,
          accountFound: !!account,
        })
        // Offline / sample-data mode: no CalDAV accounts configured, so there is
        // nothing to sync. Skip silently instead of surfacing a sync error.
        if (allAccounts.length === 0) return
        showToast('Failed to sync event with CalDAV server. It will be retried.')
        return
      }

      // Computed inside the try (needs the store + client), but consumed by the
      // catch: a failed move must re-queue the WHOLE recurrence group, not just
      // the master, or a replayed move silently strips the series' overrides.
      let groupedEvents: CalendarEvent[] = []

      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const engine = new SyncEngine(client, calendarId)

        // Bug 29 fix: only increment sequence if event data actually changed.
        // Unconditional increment causes false conflict detection.
        const existingEvent = useCalendarStore.getState().events.find((e) => e.id === event.id)
        const hasChanged =
          !existingEvent ||
          existingEvent.title !== event.title ||
          existingEvent.description !== event.description ||
          existingEvent.location !== event.location ||
          existingEvent.start !== event.start ||
          existingEvent.end !== event.end ||
          existingEvent.isAllDay !== event.isAllDay ||
          existingEvent.transparency !== event.transparency ||
          existingEvent.rruleString !== event.rruleString ||
          existingEvent.completed !== event.completed ||
          existingEvent.priority !== event.priority ||
          existingEvent.parentTaskId !== event.parentTaskId ||
          existingEvent.dueDate !== event.dueDate ||
          existingEvent.type !== event.type ||
          JSON.stringify(existingEvent.categories ?? []) !==
            JSON.stringify(event.categories ?? []) ||
          JSON.stringify(existingEvent.recurrence) !== JSON.stringify(event.recurrence) ||
          JSON.stringify(existingEvent.reminders) !== JSON.stringify(event.reminders) ||
          JSON.stringify(existingEvent.excludedDates) !== JSON.stringify(event.excludedDates) ||
          JSON.stringify(existingEvent.attachments ?? []) !==
            JSON.stringify(event.attachments ?? [])

        const currentSequence = event.sequence ?? 0
        const eventWithSequence: CalendarEvent = {
          ...event,
          sequence: hasChanged ? currentSequence + 1 : currentSequence,
        }

        if (caldavDebugMode) {
          console.log('[CalDAV] Updating event on server...')
        }

        // Which collection does this event live in RIGHT NOW? It cannot be read
        // from the store: the modal writes the new calendarId locally before
        // calling us, so the only truthful signal is the href's collection.
        const sourceCalendar = event.resourceHref
          ? allCalendars.find((c) => resourceIsInCollection(event.resourceHref as string, c.url))
          : undefined
        const isMove = Boolean(sourceCalendar && sourceCalendar.id !== calendarId)

        const uid = eventWithSequence.uid || eventWithSequence.id
        const overrides = !eventWithSequence.recurrenceId
          ? useCalendarStore.getState().events.filter(
              (candidate) =>
                // Mid-move the master already carries the target calendarId
                // while its overrides still carry the source's, so accept
                // either side — otherwise the series loses its exceptions.
                (candidate.calendarId === calendarId ||
                  (isMove && candidate.calendarId === sourceCalendar?.id)) &&
                Boolean(candidate.recurrenceId) &&
                (candidate.uid === uid || candidate.recurrenceMasterId === eventWithSequence.id)
            )
          : []
        groupedEvents = withResourceSiblings(
          [eventWithSequence, ...overrides],
          useCalendarStore.getState().events,
          event.resourceHref
        )

        if (isMove) {
          const sourceEngine = await engineForCalendar(sourceCalendar!, client, account.id)
          const result = await moveEventGroup(groupedEvents, {
            targetEngine: engine,
            sourceEngine,
            sourceHref: event.resourceHref,
            sourceEtag: event.etag,
          })

          // Rewrite every member, not just the master: they all now live in a
          // different collection at a different href.
          for (const id of result.memberIds) {
            storeUpdateEvent(id, {
              calendarId,
              resourceHref: result.url,
              etag: result.etag,
              syncStatus: 'synced',
            })
          }
          storeUpdateEvent(event.id, { sequence: eventWithSequence.sequence })

          if (!result.sourceDeleted && event.resourceHref) {
            // The copy is safely in the new calendar but the old one is still
            // there. Queue the cleanup; until it lands, pendingGuardedEventIds
            // keeps a sync from re-importing the leftover.
            storage.addPendingChange({
              type: 'delete-href',
              eventId: event.id,
              calendarId: sourceCalendar!.id,
              data: JSON.stringify({
                href: event.resourceHref,
                etag: event.etag,
                memberIds: result.memberIds,
              }),
            })
            showToast(
              `Moved "${event.title}", but the old copy in ${sourceCalendar!.name} couldn't be removed yet. Retrying.`
            )
          }

          storage.updateAccountLastSync(account.id)
          processPendingChanges()
          return
        }

        const { url, etag } =
          groupedEvents.length > 1 && groupedEvents.some((candidate) => !candidate.recurrenceId)
            ? await engine.updateEventGroup(groupedEvents, event.etag ?? '')
            : await engine.updateEvent(eventWithSequence, event.etag ?? '')

        for (const groupedEvent of groupedEvents) {
          storeUpdateEvent(groupedEvent.id, { resourceHref: url, etag, syncStatus: 'synced' })
        }

        if (caldavDebugMode) {
          console.log('[CalDAV] Event updated successfully!')
        }

        // Capture the new etag returned by the server so the next update
        // sends If-Match against the current server resource. Without this
        // we'd keep using the pre-update etag and strict servers would
        // reject subsequent edits as stale.
        storeUpdateEvent(event.id, {
          resourceHref: url,
          etag,
          sequence: eventWithSequence.sequence,
          syncStatus: 'synced',
        })

        storage.updateAccountLastSync(account.id)
        processPendingChanges()
      } catch (error) {
        if (caldavDebugMode) {
          console.log('[CalDAV] updateEvent failed, adding to pending changes:', error)
        }
        const sourceCalendarForRetry = event.resourceHref
          ? storage
              .getAllCalendars()
              .find((c) => resourceIsInCollection(event.resourceHref as string, c.url))
          : undefined

        if (error instanceof MoveLostSourceError) {
          // The source resource is already gone, so replaying a move would have
          // nothing to move. Re-create at the destination instead — the full
          // group (master + detached overrides), never just the master: a
          // series' exceptions must survive the recovery or they are lost.
          storage.addPendingChange({
            type: 'create',
            eventId: event.id,
            calendarId,
            data: JSON.stringify({
              events: groupedEvents.map((e) => ({
                ...e,
                resourceHref: undefined,
                etag: undefined,
              })),
            }),
          })
        } else if (sourceCalendarForRetry && sourceCalendarForRetry.id !== calendarId) {
          // Queue a move, NOT an update: an update replays against the stored
          // href and would write the event straight back into its old calendar.
          storage.addPendingChange({
            type: 'move',
            eventId: event.id,
            calendarId,
            data: JSON.stringify({
              // The full group, not just the master: a replayed move writes
              // every member, so a series' detached overrides survive a
              // failed first attempt.
              events: groupedEvents.length > 0 ? groupedEvents : [event],
              sourceCalendarId: sourceCalendarForRetry.id,
              sourceHref: event.resourceHref,
              sourceEtag: event.etag,
            }),
          })
        } else {
          storage.addPendingChange({
            type: 'update',
            eventId: event.id,
            calendarId,
            data: JSON.stringify(event),
          })
        }
        // Mark the event as failed in the store so the user can see the sync error
        storeUpdateEvent(event.id, { syncStatus: 'failed' })
        setSyncState((prev) => ({
          ...prev,
          pendingChanges: prev.pendingChanges + 1,
        }))
        throw error
      }
    },
    [caldavDebugMode, storeUpdateEvent, saveRecurrenceOverrideFn]
  )

  const deleteEventFn = useCallback(
    async (calendarId: string, eventId: string): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] deleteEvent called:', { calendarId, eventId })
      }

      // Capture the event data before it might be deleted from the store
      // by the caller's optimistic delete
      const eventData = useCalendarStore.getState().events.find((e) => e.id === eventId)
      // Also check brokenEvents — broken events aren't in events[]
      const brokenData = eventData
        ? null
        : useCalendarStore.getState().brokenEvents.find((be) => be.event.id === eventId)
      const effectiveData = eventData ?? brokenData?.event

      // R2.7 — Deleting a task override must not DELETE its resource: that href
      // holds the master too, so the whole series would vanish. Rewrite the
      // group without this override instead, which is also what "restore this
      // occurrence to what the master says" means in RFC 5545 terms.
      if (effectiveData?.type === 'task' && effectiveData.recurrenceId) {
        const master = findRecurrenceMaster(effectiveData)
        if (master && master.resourceHref === effectiveData.resourceHref) {
          await saveRecurrenceOverrideFn(calendarId, master, null, [eventId])
          return
        }
      }

      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((c) => c.id === calendarId)
      const account = allAccounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        console.warn('[CalDAV] deleteEvent: No calendar or account found', {
          calendarId,
          calendarFound: !!calendar,
          accountFound: !!account,
        })
        // Offline / sample-data mode: no CalDAV accounts configured, so there is
        // nothing to sync. Skip silently instead of surfacing a sync error.
        if (allAccounts.length === 0) return
        showToast('Failed to sync event with CalDAV server. It will be retried.')
        // Re-add to store so the user can see the failure
        if (eventData) {
          storeUpdateEvent(eventId, { syncStatus: 'failed' })
        }
        return
      }

      // Mark this event as being deleted so a concurrent sync won't re-add it
      // during the server round-trip. Cleared in finally once the outcome is
      // settled (event removed, or a pending-change tombstone written).
      inFlightDeletes.add(eventId)
      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const engine = new SyncEngine(client, calendarId)

        if (caldavDebugMode) {
          console.log('[CalDAV] Deleting event from server...')
        }

        const eventUrl =
          effectiveData?.resourceHref || `${calendar.url}${eventResourceFilename(eventId)}`
        // Bug 17 fix: use the event's etag from the store instead of empty string
        await engine.deleteEvent(eventUrl, effectiveData?.etag || '')

        // Only remove from store if the UI hasn't already done an optimistic
        // delete (the caller may have already removed it before calling us).
        const stillInStore = useCalendarStore.getState().events.some((e) => e.id === eventId)
        if (stillInStore) {
          storeDeleteEvent(eventId)
        }

        if (caldavDebugMode) {
          console.log('[CalDAV] Event deleted successfully!')
        }

        storage.updateAccountLastSync(account.id)
        processPendingChanges()
      } catch (error) {
        if (caldavDebugMode) {
          console.log('[CalDAV] deleteEvent failed, adding to pending changes:', error)
        }
        storage.addPendingChange({
          type: 'delete',
          eventId,
          calendarId,
          data: effectiveData ? JSON.stringify(effectiveData) : undefined,
        })
        // Re-add the event to the store with syncStatus='failed' so the user
        // can see it and retry the deletion
        if (eventData) {
          storeAddEvent({ ...eventData, syncStatus: 'failed' })
        }
        setSyncState((prev) => ({
          ...prev,
          pendingChanges: prev.pendingChanges + 1,
        }))
        throw error
      } finally {
        // Outcome is settled: either the event is gone (success) or a pending
        // delete tombstone now guards it (failure). Safe to stop shadowing it.
        inFlightDeletes.delete(eventId)
      }
    },
    [caldavDebugMode, storeDeleteEvent, storeAddEvent, saveRecurrenceOverrideFn]
  )

  // Delete a specific CalDAV resource by its raw href rather than by local
  // event id. Needed for duplicate-UID "loser" resources (#22 follow-up):
  // those never get a local CalendarEvent (they're skipped to avoid
  // clobbering the kept event), so the usual eventId-based lookup/URL
  // reconstruction in deleteEventFn doesn't apply — the href is all we have.
  const deleteEventByHref = useCallback(async (calendarId: string, href: string): Promise<void> => {
    const allCalendars = storage.getAllCalendars()
    const allAccounts = storage.getAllAccounts()
    const calendar = allCalendars.find((c) => c.id === calendarId)
    const account = allAccounts.find((a) => a.id === calendar?.accountId)

    if (!calendar || !account) {
      throw new Error('No CalDAV account found for this calendar')
    }

    const credential = await getCredentialById(account.credentialId)
    if (!credential) {
      throw new Error('Credentials not found')
    }

    const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
    const engine = new SyncEngine(client, calendarId)
    await engine.deleteEvent(href, '')
  }, [])

  // Retry all events in the store that have syncStatus='failed'
  const retryAllFailedSyncs = useCallback(async (): Promise<{
    succeeded: number
    failed: number
  }> => {
    if (caldavDebugMode) {
      console.log('[CalDAV] Retrying all failed syncs...')
    }

    const failedEvents = useCalendarStore.getState().events.filter((e) => e.syncStatus === 'failed')

    if (failedEvents.length === 0) {
      console.log('[CalDAV] No failed events to retry')
      return { succeeded: 0, failed: 0 }
    }

    console.log(`[CalDAV] Retrying ${failedEvents.length} failed events...`)

    let succeeded = 0
    let failed = 0

    for (const event of failedEvents) {
      // Check if there's already a pending change for this event
      const pendingChanges = storage.getPendingChanges()
      const existingChange = pendingChanges.find((c) => c.eventId === event.id)

      if (existingChange) {
        // A pending change already exists; rely on processPendingChanges
        // to retry it, but mark the event as pending in the meantime
        storeUpdateEvent(event.id, { syncStatus: 'pending' })
        continue
      }

      // Determine the calendar and account
      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((c) => c.id === event.calendarId)
      const account = allAccounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        console.warn(`[CalDAV] Cannot retry event ${event.id}: no calendar or account`)
        continue
      }

      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const engine = new SyncEngine(client, event.calendarId)

        if (event.etag) {
          // Event previously existed on server; update it
          const { url, etag } = await engine.updateEvent(event, event.etag)
          storeUpdateEvent(event.id, { resourceHref: url, etag, syncStatus: 'synced' })
        } else {
          // Event is new; create it
          const { url, etag } = await engine.pushEvent({ ...event, sequence: event.sequence ?? 0 })
          storeUpdateEvent(event.id, { resourceHref: url, etag, syncStatus: 'synced' })
        }

        succeeded++
      } catch {
        // Failed again; store a pending change for background retry
        storage.addPendingChange({
          type: event.etag ? 'update' : 'create',
          eventId: event.id,
          calendarId: event.calendarId,
          data: JSON.stringify(event),
        })
        failed++
      }
    }

    // Also process any pending changes that accumulated
    await processPendingChanges()

    const remaining = storage.getPendingChanges()
    setSyncState((prev) => ({ ...prev, pendingChanges: remaining.length }))

    console.log(
      `[CalDAV] RetryAll: ${succeeded} succeeded, ${failed} failed, ${remaining.length} pending remaining`
    )

    return { succeeded, failed }
  }, [caldavDebugMode, storeUpdateEvent, processPendingChanges])

  // Calendar management methods
  const createCalDAVCalendar = useCallback(
    async (accountId: string, options: CreateCalendarOptions): Promise<CalDAVCalendar> => {
      const account = storage.getAccountById(accountId)
      if (!account) {
        throw new Error('Account not found')
      }

      const credential = await getCredentialById(account.credentialId)
      if (!credential) {
        throw new Error('Credentials not found')
      }

      const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
      const newCalendar = await client.createCalendar(options)

      // Set the correct accountId before saving
      newCalendar.accountId = accountId

      // Save to local storage
      storage.saveCalendar(newCalendar)
      storeAddCalendar({
        id: newCalendar.id,
        name: newCalendar.name,
        color: newCalendar.color,
        isVisible: true,
        isDefault: false,
        accountId,
        showTasksInViews: true,
        supportedComponents: newCalendar.supportedComponents,
      })

      setCalendars(storage.getAllCalendars())

      return newCalendar
    },
    [storeAddCalendar]
  )

  const updateCalDAVCalendar = useCallback(
    async (calendarId: string, options: UpdateCalendarOptions): Promise<void> => {
      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((c) => c.id === calendarId)
      const account = allAccounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        throw new Error('Calendar or account not found')
      }

      const credential = await getCredentialById(account.credentialId)
      if (!credential) {
        throw new Error('Credentials not found')
      }

      const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
      await client.updateCalendar(calendar.url, options)

      // Update local storage
      const updates: Partial<CalDAVCalendar> = {}
      if (options.name !== undefined) updates.name = options.name
      if (options.color !== undefined) updates.color = options.color
      storage.updateCalendar(calendarId, updates)
      storeUpdateCalendar(calendarId, updates)

      setCalendars(storage.getAllCalendars())
    },
    [storeUpdateCalendar]
  )

  const deleteCalDAVCalendar = useCallback(
    async (calendarId: string): Promise<void> => {
      const allCalendars = storage.getAllCalendars()
      const allAccounts = storage.getAllAccounts()
      const calendar = allCalendars.find((c) => c.id === calendarId)
      const account = allAccounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        throw new Error('Calendar or account not found')
      }

      const credential = await getCredentialById(account.credentialId)
      if (!credential) {
        throw new Error('Credentials not found')
      }

      const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
      await client.deleteCalendar(calendar.url)

      // Remove from local storage
      storage.deleteCalendar(calendarId)
      storeDeleteCalendar(calendarId)

      setCalendars(storage.getAllCalendars())
    },
    [storeDeleteCalendar]
  )

  return {
    accounts,
    calendars,
    syncState,
    addAccount,
    removeAccount,
    updateAccount,
    testAccount,
    syncAccount,
    syncAll,
    createEvent,
    createEventGroup,
    updateEvent: updateEventFn,
    saveRecurrenceOverride: saveRecurrenceOverrideFn,
    deleteEvent: deleteEventFn,
    deleteEventByHref,
    retryAllFailedSyncs,
    createCalendar: createCalDAVCalendar,
    updateCalendar: updateCalDAVCalendar,
    deleteCalendarFromServer: deleteCalDAVCalendar,
  }
}
