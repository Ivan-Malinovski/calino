import { useState, useCallback, useEffect } from 'react'
import { addDays } from 'date-fns'
import type { CalendarEvent, CalendarStore } from '@/types'
import type { CalDAVAccount, CalDAVCalendar, SyncState } from '../types'
import { createCalDAVClient } from '../client/CalDAVClient'
import { testConnection, discoverServerUrl } from '../client/discovery'
import { saveCredentials, getCredentialById, deleteCredential } from '../client/credentials'
import { parseICALData } from '../adapter/iCalendarAdapter'
import * as storage from '../sync/accountStorage'
import { SyncEngine } from '../sync/syncEngine'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'

const selectAddEvent = (state: CalendarStore) => state.addEvent
const selectUpdateEvent = (state: CalendarStore) => state.updateEvent
const selectDeleteEvent = (state: CalendarStore) => state.deleteEvent
const selectAddCalendar = (state: CalendarStore) => state.addCalendar
const selectDeleteCalendar = (state: CalendarStore) => state.deleteCalendar
const selectCalendars = (state: CalendarStore) => state.calendars
const selectEvents = (state: CalendarStore) => state.events
const selectCalDavDebugMode = (state: { caldavDebugMode: boolean }) => state.caldavDebugMode

interface UseCalDAVReturn {
  accounts: CalDAVAccount[]
  calendars: CalDAVCalendar[]
  syncState: SyncState
  addAccount: (serverUrl: string, username: string, password: string, name: string) => Promise<void>
  removeAccount: (accountId: string) => Promise<void>
  syncAccount: (accountId: string) => Promise<void>
  syncAll: () => Promise<void>
  createEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  updateEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>
}

export function useCalDAV(): UseCalDAVReturn {
  const [accounts, setAccounts] = useState<CalDAVAccount[]>([])
  const [calendars, setCalendars] = useState<CalDAVCalendar[]>([])
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'idle',
    lastSyncAt: null,
    error: null,
    pendingChanges: 0,
  })

  const storeAddEvent = useCalendarStore(selectAddEvent)
  const storeUpdateEvent = useCalendarStore(selectUpdateEvent)
  const storeDeleteEvent = useCalendarStore(selectDeleteEvent)
  const storeAddCalendar = useCalendarStore(selectAddCalendar)
  const storeDeleteCalendar = useCalendarStore(selectDeleteCalendar)
  const storeCalendars = useCalendarStore(selectCalendars)
  const existingEvents = useCalendarStore(selectEvents)
  const caldavDebugMode = useSettingsStore(selectCalDavDebugMode)

  useEffect(() => {
    const loadedAccounts = storage.getAllAccounts()
    const loadedCalendars = storage.getAllCalendars()
    setAccounts(loadedAccounts)
    setCalendars(loadedCalendars)

    const existingIds = storeCalendars.map((c) => c.id)
    for (const cal of loadedCalendars) {
      if (!existingIds.includes(cal.id)) {
        storeAddCalendar({
          id: cal.id,
          name: cal.name,
          color: cal.color,
          isVisible: cal.isVisible,
          isDefault: cal.isDefault,
        })
      }
    }

    const pending = storage.getPendingChanges()
    setSyncState((prev) => ({ ...prev, pendingChanges: pending.length }))
  }, [])

  const addAccount = useCallback(
    async (serverUrl: string, username: string, password: string, name: string): Promise<void> => {
      setSyncState((prev) => ({ ...prev, status: 'syncing', error: null }))

      try {
        const discoveredUrl = await discoverServerUrl(serverUrl)
        const connected = await testConnection(discoveredUrl, { username, password })

        if (!connected) {
          throw new Error('Failed to connect to server. Please check your credentials.')
        }

        const credential = saveCredentials({
          serverUrl: discoveredUrl,
          username,
          password,
        })

        const client = await createCalDAVClient(discoveredUrl, credential)
        const serverCalendars = await client.fetchCalendars()

        const newAccount = storage.saveAccount({
          name,
          serverUrl: discoveredUrl,
          username,
          credentialId: credential.id,
        })

        for (const cal of serverCalendars) {
          storage.saveCalendar({
            ...cal,
            accountId: newAccount.id,
          })
          storeAddCalendar({
            id: cal.id,
            name: cal.name,
            color: cal.color,
            isVisible: cal.isVisible,
            isDefault: cal.isDefault,
          })
        }

        setAccounts(storage.getAllAccounts())
        setCalendars(storage.getAllCalendars())

        const start = '1970-01-01T00:00:00.000Z'
        const end = addDays(new Date(), 365).toISOString()

        for (const cal of serverCalendars) {
          const fetchedEvents = await client.fetchEvents(cal.url, start, end)

          for (const eventData of fetchedEvents) {
            if (eventData.data) {
              const parsedEvents = parseICALData(eventData.data, cal.id)

              for (const parsedEvent of parsedEvents) {
                const existingIndex = existingEvents.findIndex((e) => e.id === parsedEvent.id)

                if (existingIndex >= 0) {
                  storeUpdateEvent(parsedEvent.id, parsedEvent)
                } else {
                  storeAddEvent(parsedEvent)
                }
              }
            }
          }
        }

        storage.updateAccountLastSync(newAccount.id)

        setSyncState((prev) => ({
          ...prev,
          status: 'idle',
          lastSyncAt: new Date().toISOString(),
        }))
      } catch (error) {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to add account',
        }))
        throw error
      }
    },
    [existingEvents, storeAddEvent, storeUpdateEvent]
  )

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

      try {
        const credential = getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential)
        const accountCalendars = storage.getCalendarsByAccountId(accountId)

        const start = '1970-01-01T00:00:00.000Z'
        const end = addDays(new Date(), 365).toISOString()

        for (const cal of accountCalendars) {
          const fetchedEvents = await client.fetchEvents(cal.url, start, end)

          // Get events that belong to this calendar
          const calendarEvents = existingEvents.filter((e) => e.calendarId === cal.id)
          const serverEventIds = new Set<string>()

          for (const eventData of fetchedEvents) {
            if (eventData.data) {
              const parsedEvents = parseICALData(eventData.data, cal.id)

              for (const parsedEvent of parsedEvents) {
                serverEventIds.add(parsedEvent.id)
                const existingIndex = calendarEvents.findIndex((e) => e.id === parsedEvent.id)

                if (existingIndex >= 0) {
                  storeUpdateEvent(parsedEvent.id, parsedEvent)
                } else {
                  storeAddEvent(parsedEvent)
                }
              }
            }
          }

          // Delete events that exist locally but not on server
          for (const localEvent of calendarEvents) {
            if (!serverEventIds.has(localEvent.id)) {
              storeDeleteEvent(localEvent.id)
            }
          }
        }

        storage.updateAccountLastSync(accountId)

        setSyncState((prev) => ({
          ...prev,
          status: 'idle',
          lastSyncAt: new Date().toISOString(),
        }))
      } catch (error) {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Sync failed',
        }))
      }
    },
    [existingEvents]
  )

  const syncAll = useCallback(async (): Promise<void> => {
    for (const account of accounts) {
      await syncAccount(account.id)
    }
  }, [accounts, syncAccount])

  const createEvent = useCallback(
    async (calendarId: string, event: CalendarEvent): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] createEvent called:', { calendarId, eventId: event.id, eventTitle: event.title })
      }

      const calendar = calendars.find((c) => c.id === calendarId)
      const account = accounts.find((a) => a.id === calendar?.accountId)

      if (caldavDebugMode) {
        console.log('[CalDAV] Looking up calendar:', { calendarId, foundCalendar: !!calendar, calendar, accountId: calendar?.accountId })
        console.log('[CalDAV] Available calendars:', calendars.map(c => ({ id: c.id, accountId: c.accountId, name: c.name })))
        console.log('[CalDAV] Available accounts:', accounts.map(a => ({ id: a.id, name: a.name })))
      }

      if (!calendar || !account) {
        if (caldavDebugMode) {
          console.log('[CalDAV] createEvent: No calendar or account found, silently returning')
        }
        return
      }

      try {
        const credential = getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential)
        const engine = new SyncEngine(client, calendarId)

        if (caldavDebugMode) {
          console.log('[CalDAV] Pushing event to server...')
        }

        await engine.pushEvent(event)

        if (caldavDebugMode) {
          console.log('[CalDAV] Event pushed successfully!')
        }

        storage.updateAccountLastSync(account.id)
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
        setSyncState((prev) => ({
          ...prev,
          pendingChanges: prev.pendingChanges + 1,
        }))
        throw error
      }
    },
    [accounts, calendars, caldavDebugMode]
  )

  const updateEventFn = useCallback(
    async (calendarId: string, event: CalendarEvent): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] updateEvent called:', { calendarId, eventId: event.id, eventTitle: event.title })
      }

      const calendar = calendars.find((c) => c.id === calendarId)
      const account = accounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        if (caldavDebugMode) {
          console.log('[CalDAV] updateEvent: No calendar or account found, silently returning')
        }
        return
      }

      try {
        const credential = getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential)
        const engine = new SyncEngine(client, calendarId)

        if (caldavDebugMode) {
          console.log('[CalDAV] Updating event on server...')
        }

        await engine.updateEvent(event, '')

        if (caldavDebugMode) {
          console.log('[CalDAV] Event updated successfully!')
        }

        storage.updateAccountLastSync(account.id)
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
        setSyncState((prev) => ({
          ...prev,
          pendingChanges: prev.pendingChanges + 1,
        }))
        throw error
      }
    },
    [accounts, calendars, caldavDebugMode]
  )

  const deleteEventFn = useCallback(
    async (calendarId: string, eventId: string): Promise<void> => {
      if (caldavDebugMode) {
        console.log('[CalDAV] deleteEvent called:', { calendarId, eventId })
      }

      const calendar = calendars.find((c) => c.id === calendarId)
      const account = accounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        if (caldavDebugMode) {
          console.log('[CalDAV] deleteEvent: No calendar or account found, silently returning')
        }
        return
      }

      try {
        const credential = getCredentialById(account.credentialId)
        if (!credential) {
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential)
        const engine = new SyncEngine(client, calendarId)

        if (caldavDebugMode) {
          console.log('[CalDAV] Deleting event from server...')
        }

        const eventUrl = `${calendar.url}${eventId}.ics`
        await engine.deleteEvent(eventUrl, '')

        storeDeleteEvent(eventId)

        if (caldavDebugMode) {
          console.log('[CalDAV] Event deleted successfully!')
        }

        storage.updateAccountLastSync(account.id)
      } catch (error) {
        if (caldavDebugMode) {
          console.log('[CalDAV] deleteEvent failed, adding to pending changes:', error)
        }
        storage.addPendingChange({
          type: 'delete',
          eventId,
          calendarId,
        })
        setSyncState((prev) => ({
          ...prev,
          pendingChanges: prev.pendingChanges + 1,
        }))
        throw error
      }
    },
    [accounts, calendars, storeDeleteEvent, caldavDebugMode]
  )

  return {
    accounts,
    calendars,
    syncState,
    addAccount,
    removeAccount,
    syncAccount,
    syncAll,
    createEvent,
    updateEvent: updateEventFn,
    deleteEvent: deleteEventFn,
  }
}
