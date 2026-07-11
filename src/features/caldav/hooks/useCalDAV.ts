import { useState, useCallback, useEffect } from 'react'
import { addDays } from 'date-fns'
import { toast as sonnerToast } from 'sonner'
import type { CalendarEvent } from '@/types'
import { showBrokenEventsNotification, showDuplicateUidNotification } from '@/lib/toast'
import type { CalDAVAccount, CalDAVCalendar, SyncState, ConflictInfo, CreateCalendarOptions, UpdateCalendarOptions } from '../types'
import { createCalDAVClient } from '../client/CalDAVClient'
import { probeConnection, expandProviderUrl, type ProbeResult } from '../client/discovery'
import { CalDAVConnectionError } from '../client/errors'
import { saveCredentials, getCredentialById, deleteCredential, updateCredential } from '../client/credentials'
import { parseICALData } from '../adapter/iCalendarAdapter'
import { detectUidCollisions, type ParsedWithHref } from '../sync/detectUidCollisions'
import { putAttachments } from '@/lib/attachmentStore'
import * as storage from '../sync/accountStorage'
import { SyncEngine } from '../sync/syncEngine'
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

const MAX_RETRIES = 10

function showToast(message: string): void {
  sonnerToast(message)
}

/**
 * Parse every fetched CalDAV resource into events, pairing each with the
 * resource href it came from, and cache inline attachments in IndexedDB.
 * The href is what lets us detect UID collisions across independent resources
 * (issue #22) — the same logic both sync paths need.
 */
async function collectParsedWithHref(
  fetchedEvents: { url: string; data: string; etag?: string }[],
  calendarId: string,
): Promise<ParsedWithHref[]> {
  const result: ParsedWithHref[] = []
  for (const eventData of fetchedEvents) {
    if (!eventData.data) continue
    const parsedEvents = parseICALData(eventData.data, calendarId)
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
      result.push({ event: parsedEvent, href: eventData.url })
    }
  }
  return result
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
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>
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
        storage.removePendingChange(change.id)
        failed++
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

        switch (change.type) {
          case 'create': {
            const event = JSON.parse(change.data || '{}') as CalendarEvent
            await engine.pushEvent({ ...event, sequence: 0 })
            // Mark as synced in the store
            storeUpdateEvent(change.eventId, { syncStatus: 'synced' })
            break
          }
          case 'update': {
            const event = JSON.parse(change.data || '{}') as CalendarEvent
            await engine.updateEvent(event, event.etag || '')
            // Mark as synced in the store
            storeUpdateEvent(change.eventId, { syncStatus: 'synced' })
            break
          }
          case 'delete': {
            const eventUrl = `${calendar.url}${change.eventId}.ics`
            // Try to get etag from pending change data first (for broken events),
            // then from the live store
            let etag = ''
            if (change.data) {
              try {
                const eventData = JSON.parse(change.data) as CalendarEvent
                etag = eventData.etag || ''
              } catch { /* ignore parse errors */ }
            }
            if (!etag) {
              const eventInStore = useCalendarStore.getState().events.find(
                (e) => e.id === change.eventId
              )
              etag = eventInStore?.etag || ''
            }
            if (caldavDebugMode) {
              console.log('[CalDAV] Deleting event from server:', eventUrl, 'etag:', etag)
            }
            await engine.deleteEvent(eventUrl, etag)
            // Remove from the store: a failed delete re-adds the event with
            // syncStatus='failed' (see deleteEventFn catch), so on a successful
            // retry we must clear it or it lingers as a ghost (gone on server,
            // still local).
            storeDeleteEvent(change.eventId)
            break
          }
        }

        storage.removePendingChange(change.id)
        succeeded++
      } catch {
        storage.updatePendingChangeRetry(change.id)
        failed++
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
          const carddavClient = await createCardDAVClient(account.serverUrl, credential, account.proxyUrl)
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
          storage.saveCalendar({
            ...cal,
            accountId: newAccount.id,
          })
          // Hide the Calino Settings calendar from the sidebar (unless debug mode)
          const isSettingsCal = cal.name === 'Calino Settings' || cal.url?.includes('calino-settings')
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
            })
          }
        }

        const storedCalendars = storage.getAllCalendars()
        const allCalendarsInStore = useCalendarStore.getState().calendars
        if (serverCalendars.length > 0) {
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
          const firstCal = serverCalendars[0]
          const storeCalId = storedCalendars.find((c) => c.url === firstCal.url)?.id
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

        for (const cal of serverCalendars) {
          console.log('[CalDAV] addAccount: fetching events for', cal.name, cal.url)
          const fetchedEvents = await client.fetchEvents(cal.url, start, end)
          console.log('[CalDAV] addAccount: got', fetchedEvents.length, 'event objects for', cal.name)

          const parsedWithHref = await collectParsedWithHref(fetchedEvents, cal.id)

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

            if (accountExistingEventIds.has(parsedEvent.id)) {
              storeUpdateEvent(parsedEvent.id, parsedEvent)
            } else {
              storeAddEvent(parsedEvent)
            }
            eventsAdded++
          }
        }

        console.log(`[CalDAV] addAccount: done — ${eventsAdded} events added`)

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
          const { getPrimaryAccountId, setPrimaryAccountId, setEtag, deriveCalendarHomeUrl, dtstampToISO, deserializeSettings, mergeSettings, resolveConflict, setLastSyncedAt } = await import('@/lib/settingsSync')
          const existingPrimary = getPrimaryAccountId()
          if (!existingPrimary) {
            const { createCalDAVClient: createClient } = await import('../client/CalDAVClient')
            const settingsClient = await createClient(newAccount.serverUrl, credential, newAccount.proxyUrl)
            const calHomeUrl = deriveCalendarHomeUrl(newAccount.serverUrl, serverCalendars[0].url)
            const discovered = await settingsClient.discoverSettingsCalendar(calHomeUrl)
            if (discovered) {
              setPrimaryAccountId(newAccount.id)
              const remote = await settingsClient.fetchSettingsEvent(discovered.url)
              if (remote) {
                const json = settingsClient.extractSettingsFromVEVENT(remote.data)
                if (json) {
                  const parsed = deserializeSettings(json)
                  if (parsed) {
                    const localSettings = useSettingsStore.getState()
                    const dtstampIso = dtstampToISO(remote.dtstamp)
                    const winner = resolveConflict(new Date(0).toISOString(), dtstampIso)
                    const merged = winner === 'remote'
                      ? mergeSettings(localSettings, parsed.settings)
                      : localSettings
                    useSettingsStore.getState().updateSettings(merged)
                  }
                }
                setEtag(remote.etag)
              }
              setLastSyncedAt(new Date().toISOString())
              showToast('Calino Settings found — sync enabled automatically.')
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

  const syncAccount = useCallback(
    async (accountId: string): Promise<void> => {
      const account = storage.getAccountById(accountId)
      if (!account) {
        return
      }

      setSyncState((prev) => ({ ...prev, status: 'syncing', error: null }))
      useCalDAVSyncStore.getState().setStatus('syncing')

      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const accountCalendars = storage.getCalendarsByAccountId(accountId)
        let calendarsToSync = accountCalendars

        // Re-discover collections on every sync. This migrates capabilities
        // saved by older versions and picks up calendars created elsewhere.
        try {
          const serverCalendars = await client.fetchCalendars()
          const storedByUrl = new Map(accountCalendars.map((calendar) => [calendar.url, calendar]))
          const discoveredCalendars = [...accountCalendars]
          const caldavDebugMode = useSettingsStore.getState().caldavDebugMode

          for (const serverCalendar of serverCalendars) {
            const storedCalendar = storedByUrl.get(serverCalendar.url)
            if (storedCalendar) {
              // Collection metadata is server-authoritative. Keep UI-owned
              // visibility and default-calendar preferences intact.
              const updates = {
                name: serverCalendar.name,
                color: serverCalendar.color,
                supportedComponents: serverCalendar.supportedComponents,
              }
              storage.updateCalendar(storedCalendar.id, updates)
              storeUpdateCalendar(storedCalendar.id, updates)
              continue
            }

            const newCalendar = { ...serverCalendar, accountId }
            storage.saveCalendar(newCalendar)
            discoveredCalendars.push(newCalendar)

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

        // Re-derive duplicate-UID issues from scratch each sync (#22).
        useCalendarStore.getState().clearDuplicateUidIssues()

        for (const cal of calendarsToSync) {
          const fetchedEvents = await client.fetchEvents(cal.url, start, end)

          // Snapshot pending deletes AFTER the network fetch, as late as possible
          // before reconciliation: a delete queued while the fetch was in flight
          // must be observed, otherwise sync would re-freshen an event the user
          // just deleted. Read once per calendar (O(N)), not per event.
          const pendingDeleteIds = new Set(
            storage.getPendingChanges()
              .filter((p) => p.type === 'delete')
              .map((p) => p.eventId)
          )
          // Also skip events whose server DELETE is in flight right now: on the
          // happy path no pending-change tombstone is written, so without this a
          // sync racing the delete would re-add the event.
          for (const id of inFlightDeletes) pendingDeleteIds.add(id)

          // Get events that belong to this calendar, indexed by id for O(1) lookup
          const calendarEvents = currentEvents.filter((e) => e.calendarId === cal.id)
          const calendarEventsById = new Map(calendarEvents.map((e) => [e.id, e]))
          const serverEventIds = new Set<string>()
          const newCategoryNames: string[] = []

          const parsedWithHref = await collectParsedWithHref(fetchedEvents, cal.id)

          // Detect independent events illegally sharing a UID across resources.
          // Keep one deterministically; record the rest as data issues (#22).
          const { issues, skip } = detectUidCollisions(parsedWithHref)
          for (const issue of issues) {
            useCalendarStore.getState().addDuplicateUidIssue(issue)
          }

          for (const item of parsedWithHref) {
            const parsedEvent = item.event

            serverEventIds.add(parsedEvent.id)

            // Skip collision "losers" so they don't overwrite the kept event.
            if (skip.has(item)) {
              continue
            }

            // Skip events that have a pending delete
            if (pendingDeleteIds.has(parsedEvent.id)) {
              continue
            }

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

          // Bug 19 fix: Do NOT delete local events during sync based on
          // their absence from the server response. CalDAV REPORT queries
          // may not return all events due to pagination, server-side limits,
          // or network issues. Deleting events that were simply not returned
          // would cause data loss. Events should only be deleted through
          // explicit user actions.
        }

        storage.updateAccountLastSync(accountId)
        await processPendingChanges()

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
          const { getPrimaryAccountId, deriveCalendarHomeUrl, dtstampToISO, deserializeSettings, mergeSettings, resolveConflict, setEtag, setLastSyncedAt, getLastSyncedAt } = await import('@/lib/settingsSync')
          if (getPrimaryAccountId() === accountId) {
            const { createCalDAVClient: createClient } = await import('../client/CalDAVClient')
            const cal = accountCalendars[0]
            if (cal) {
              const calHomeUrl = deriveCalendarHomeUrl(account.serverUrl, cal.url)
              const settingsClient = await createClient(account.serverUrl, credential, account.proxyUrl)
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
                      const winner = resolveConflict(localSyncedAt || '1970-01-01T00:00:00Z', dtstampIso)
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
      }
    },
    [conflictResolution]
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
    for (const account of accounts) {
      await syncAccount(account.id)
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

        const { etag } = await engine.pushEvent(eventWithSequence)

        if (caldavDebugMode) {
          console.log('[CalDAV] Event pushed successfully!')
        }

        // Capture the server-assigned etag so the next sync round-trip
        // sends If-Match against the current server resource. Without this
        // we'd send the empty pre-push etag and strict servers (Radicale,
        // iCloud) would reject the next update.
        storeUpdateEvent(event.id, { etag, syncStatus: 'synced' })

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

  const updateEventFn = useCallback(
    async (calendarId: string, event: CalendarEvent): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] updateEvent called:', {
          calendarId,
          eventId: event.id,
          eventTitle: event.title,
        })
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

      try {
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const engine = new SyncEngine(client, calendarId)

        // Bug 29 fix: only increment sequence if event data actually changed.
        // Unconditional increment causes false conflict detection.
        const existingEvent = useCalendarStore.getState().events.find(
          (e) => e.id === event.id
        )
        const hasChanged = !existingEvent || (
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
          JSON.stringify(existingEvent.categories ?? []) !== JSON.stringify(event.categories ?? []) ||
          JSON.stringify(existingEvent.recurrence) !== JSON.stringify(event.recurrence) ||
          JSON.stringify(existingEvent.reminders) !== JSON.stringify(event.reminders) ||
          JSON.stringify(existingEvent.excludedDates) !== JSON.stringify(event.excludedDates) ||
          JSON.stringify(existingEvent.attachments ?? []) !== JSON.stringify(event.attachments ?? [])
        )

        const currentSequence = event.sequence ?? 0
        const eventWithSequence: CalendarEvent = {
          ...event,
          sequence: hasChanged ? currentSequence + 1 : currentSequence,
        }

        if (caldavDebugMode) {
          console.log('[CalDAV] Updating event on server...')
        }

        const { etag } = await engine.updateEvent(eventWithSequence, event.etag ?? '')

        if (caldavDebugMode) {
          console.log('[CalDAV] Event updated successfully!')
        }

        // Capture the new etag returned by the server so the next update
        // sends If-Match against the current server resource. Without this
        // we'd keep using the pre-update etag and strict servers would
        // reject subsequent edits as stale.
        storeUpdateEvent(event.id, { etag, syncStatus: 'synced' })

        storage.updateAccountLastSync(account.id)
        processPendingChanges()
      } catch (error) {
        if (caldavDebugMode) {
          console.log('[CalDAV] updateEvent failed, adding to pending changes:', error)
        }
        storage.addPendingChange({
          type: 'update',
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

  const deleteEventFn = useCallback(
    async (calendarId: string, eventId: string): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] deleteEvent called:', { calendarId, eventId })
      }

      // Capture the event data before it might be deleted from the store
      // by the caller's optimistic delete
      const eventData = useCalendarStore.getState().events.find((e) => e.id === eventId)
      // Also check brokenEvents — broken events aren't in events[]
      const brokenData = eventData ? null : useCalendarStore.getState().brokenEvents.find((be) => be.event.id === eventId)
      const effectiveData = eventData ?? brokenData?.event

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

        const eventUrl = `${calendar.url}${eventId}.ics`
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
    [caldavDebugMode, storeDeleteEvent, storeAddEvent]
  )

  // Retry all events in the store that have syncStatus='failed'
  const retryAllFailedSyncs = useCallback(async (): Promise<{ succeeded: number; failed: number }> => {
    if (caldavDebugMode) {
      console.log('[CalDAV] Retrying all failed syncs...')
    }

    const failedEvents = useCalendarStore.getState().events.filter(
      (e) => e.syncStatus === 'failed'
    )

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
          const { etag } = await engine.updateEvent(event, event.etag)
          storeUpdateEvent(event.id, { etag, syncStatus: 'synced' })
        } else {
          // Event is new; create it
          const { etag } = await engine.pushEvent({ ...event, sequence: event.sequence ?? 0 })
          storeUpdateEvent(event.id, { etag, syncStatus: 'synced' })
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
    updateEvent: updateEventFn,
    deleteEvent: deleteEventFn,
    retryAllFailedSyncs,
    createCalendar: createCalDAVCalendar,
    updateCalendar: updateCalDAVCalendar,
    deleteCalendarFromServer: deleteCalDAVCalendar,
  }
}
