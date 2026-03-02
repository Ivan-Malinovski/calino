import { useState, useCallback, useEffect } from 'react'
import { addDays } from 'date-fns'
import type { CalendarEvent } from '@/types'
import type { CalDAVAccount, CalDAVCalendar, SyncState } from '../types'
import { createCalDAVClient } from '../client/CalDAVClient'
import { testConnection, discoverServerUrl } from '../client/discovery'
import { saveCredentials, getCredentialById, deleteCredential } from '../client/credentials'
import { parseICALEvent } from '../adapter/iCalendarAdapter'
import * as storage from '../sync/accountStorage'
import { SyncEngine } from '../sync/syncEngine'
import { useCalendarStore } from '@/store/calendarStore'

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

  const storeAddEvent = useCalendarStore((state) => state.addEvent)
  const storeUpdateEvent = useCalendarStore((state) => state.updateEvent)
  const storeDeleteEvent = useCalendarStore((state) => state.deleteEvent)
  const storeAddCalendar = useCalendarStore((state) => state.addCalendar)
  const storeDeleteCalendar = useCalendarStore((state) => state.deleteCalendar)
  const storeCalendars = useCalendarStore((state) => state.calendars)
  const existingEvents = useCalendarStore((state) => state.events)

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
    []
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

          for (const eventData of fetchedEvents) {
            if (eventData.data) {
              const parsedEvents = parseICALEvent(eventData.data, cal.id)

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
      console.log('[CalDAV] createEvent called', {
        calendarId,
        eventId: event.id,
        title: event.title,
      })
      const calendar = calendars.find((c) => c.id === calendarId)
      const account = accounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        console.log('[CalDAV] No CalDAV account found, skipping server push')
        return
      }

      try {
        const credential = getCredentialById(account.credentialId)
        if (!credential) {
          console.error('[CalDAV] Credentials not found', { credentialId: account.credentialId })
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential)
        const engine = new SyncEngine(client, calendarId)

        console.log('[CalDAV] Pushing event to', {
          calendarUrl: calendar.url,
          filename: `${event.id}.ics`,
        })
        await engine.pushEvent(event)

        storage.updateAccountLastSync(account.id)
        console.log('[CalDAV] createEvent succeeded', { eventId: event.id })
      } catch (error) {
        console.error('[CalDAV] createEvent failed', error)
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
    [accounts, calendars]
  )

  const updateEventFn = useCallback(
    async (calendarId: string, event: CalendarEvent): Promise<void> => {
      console.log('[CalDAV] updateEventFn called', {
        calendarId,
        eventId: event.id,
        title: event.title,
      })
      const calendar = calendars.find((c) => c.id === calendarId)
      const account = accounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        console.log('[CalDAV] No CalDAV account found, skipping server push')
        return
      }

      try {
        const credential = getCredentialById(account.credentialId)
        if (!credential) {
          console.error('[CalDAV] Credentials not found', { credentialId: account.credentialId })
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential)
        const engine = new SyncEngine(client, calendarId)

        console.log('[CalDAV] Updating event on server', {
          calendarUrl: calendar.url,
          eventUrl: `${calendar.url}${event.id}.ics`,
        })
        await engine.updateEvent(event, '')

        storage.updateAccountLastSync(account.id)
        console.log('[CalDAV] updateEventFn succeeded', { eventId: event.id })
      } catch (error) {
        console.error('[CalDAV] updateEventFn failed', error)
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
    [accounts, calendars]
  )

  const deleteEventFn = useCallback(
    async (calendarId: string, eventId: string): Promise<void> => {
      console.log('[CalDAV] deleteEventFn called', { calendarId, eventId })
      const calendar = calendars.find((c) => c.id === calendarId)
      const account = accounts.find((a) => a.id === calendar?.accountId)

      if (!calendar || !account) {
        console.log('[CalDAV] No CalDAV account found, skipping server delete')
        return
      }

      try {
        const credential = getCredentialById(account.credentialId)
        if (!credential) {
          console.error('[CalDAV] Credentials not found', { credentialId: account.credentialId })
          throw new Error('Credentials not found')
        }

        const client = await createCalDAVClient(account.serverUrl, credential)
        const engine = new SyncEngine(client, calendarId)

        const eventUrl = `${calendar.url}${eventId}.ics`
        console.log('[CalDAV] Deleting event from server', { eventUrl })
        await engine.deleteEvent(eventUrl, '')

        storage.updateAccountLastSync(account.id)
        console.log('[CalDAV] deleteEventFn succeeded', { eventId })
      } catch (error) {
        console.error('[CalDAV] deleteEventFn failed', error)
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
    [accounts, calendars, storeDeleteEvent]
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
