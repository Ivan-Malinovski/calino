import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { StoredEvent, StoredCalendar, StoredAccount, SyncQueueItem } from '@/types/storage'

const { mockEvents, mockCalendars, mockAccounts, mockSyncQueue, mockDb } = vi.hoisted(() => {
  const mockEvents = new Map<string, StoredEvent>()
  const mockCalendars = new Map<string, StoredCalendar>()
  const mockAccounts = new Map<string, StoredAccount>()
  const mockSyncQueue = new Map<number, SyncQueueItem>()
  let syncQueueIdCounter = 1

  const mockDb = {
    events: {
      get: vi.fn((key: string) => Promise.resolve(mockEvents.get(key))),
      put: vi.fn((item: StoredEvent) => {
        mockEvents.set(item.id, item)
        return Promise.resolve(item.id)
      }),
      add: vi.fn((item: StoredEvent) => {
        mockEvents.set(item.id, item)
        return Promise.resolve(item.id)
      }),
      update: vi.fn((key: string, updates: Partial<StoredEvent>) => {
        const existing = mockEvents.get(key)
        if (existing) {
          mockEvents.set(key, { ...existing, ...updates })
        }
        return Promise.resolve(1)
      }),
      delete: vi.fn((key: string) => {
        mockEvents.delete(key)
        return Promise.resolve()
      }),
      clear: vi.fn(() => {
        mockEvents.clear()
        return Promise.resolve()
      }),
      toArray: vi.fn(() => Promise.resolve(Array.from(mockEvents.values()))),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn(() => Promise.resolve([])),
          first: vi.fn(() => Promise.resolve(undefined)),
        })),
        belowOrEqual: vi.fn(() => ({
          and: vi.fn(() => ({
            toArray: vi.fn(() => Promise.resolve([])),
          })),
        })),
        between: vi.fn(() => ({
          toArray: vi.fn(() => Promise.resolve([])),
        })),
      })),
      count: vi.fn(() => Promise.resolve(mockEvents.size)),
      orderBy: vi.fn(() => ({
        toArray: vi.fn(() => Promise.resolve([])),
      })),
      bulkAdd: vi.fn((items: StoredEvent[]) => {
        items.forEach((item) => mockEvents.set(item.id, item))
        return Promise.resolve()
      }),
      bulkUpdate: vi.fn((items: Array<{ key: string; changes: Partial<StoredEvent> }>) => {
        items.forEach(({ key, changes }) => {
          const existing = mockEvents.get(key)
          if (existing) {
            mockEvents.set(key, { ...existing, ...changes })
          }
        })
        return Promise.resolve()
      }),
    },
    calendars: {
      get: vi.fn((key: string) => Promise.resolve(mockCalendars.get(key))),
      put: vi.fn((item: StoredCalendar) => {
        mockCalendars.set(item.id, item)
        return Promise.resolve(item.id)
      }),
      add: vi.fn((item: StoredCalendar) => {
        mockCalendars.set(item.id, item)
        return Promise.resolve(item.id)
      }),
      update: vi.fn((key: string, updates: Partial<StoredCalendar>) => {
        const existing = mockCalendars.get(key)
        if (existing) {
          mockCalendars.set(key, { ...existing, ...updates })
        }
        return Promise.resolve(1)
      }),
      delete: vi.fn((key: string) => {
        mockCalendars.delete(key)
        return Promise.resolve()
      }),
      clear: vi.fn(() => {
        mockCalendars.clear()
        return Promise.resolve()
      }),
      toArray: vi.fn(() => Promise.resolve(Array.from(mockCalendars.values()))),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn(() => Promise.resolve([])),
          first: vi.fn(() => Promise.resolve(undefined)),
        })),
      })),
      count: vi.fn(() => Promise.resolve(mockCalendars.size)),
    },
    accounts: {
      get: vi.fn((key: string) => Promise.resolve(mockAccounts.get(key))),
      put: vi.fn((item: StoredAccount) => {
        mockAccounts.set(item.id, item)
        return Promise.resolve(item.id)
      }),
      add: vi.fn((item: StoredAccount) => {
        mockAccounts.set(item.id, item)
        return Promise.resolve(item.id)
      }),
      update: vi.fn((key: string, updates: Partial<StoredAccount>) => {
        const existing = mockAccounts.get(key)
        if (existing) {
          mockAccounts.set(key, { ...existing, ...updates })
        }
        return Promise.resolve(1)
      }),
      delete: vi.fn((key: string) => {
        mockAccounts.delete(key)
        return Promise.resolve()
      }),
      clear: vi.fn(() => {
        mockAccounts.clear()
        return Promise.resolve()
      }),
      toArray: vi.fn(() => Promise.resolve(Array.from(mockAccounts.values()))),
      count: vi.fn(() => Promise.resolve(mockAccounts.size)),
    },
    syncQueue: {
      get: vi.fn((key: number) => Promise.resolve(mockSyncQueue.get(key))),
      put: vi.fn((item: SyncQueueItem & { id?: number }) => {
        const id = item.id ?? syncQueueIdCounter++
        mockSyncQueue.set(id, { ...item, id })
        return Promise.resolve(id)
      }),
      add: vi.fn((item: Omit<SyncQueueItem, 'id'>) => {
        const id = syncQueueIdCounter++
        const newItem = { ...item, id } as SyncQueueItem
        mockSyncQueue.set(id, newItem)
        return Promise.resolve(id)
      }),
      delete: vi.fn((key: number) => {
        mockSyncQueue.delete(key)
        return Promise.resolve()
      }),
      clear: vi.fn(() => {
        mockSyncQueue.clear()
        return Promise.resolve()
      }),
      toArray: vi.fn(() => Promise.resolve(Array.from(mockSyncQueue.values()))),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn(() => Promise.resolve([])),
          first: vi.fn(() => Promise.resolve(undefined)),
        })),
        belowOrEqual: vi.fn(() => ({
          and: vi.fn(() => ({
            toArray: vi.fn(() => Promise.resolve([])),
          })),
        })),
        between: vi.fn(() => ({
          toArray: vi.fn(() => Promise.resolve([])),
        })),
      })),
      count: vi.fn(() => Promise.resolve(mockSyncQueue.size)),
      orderBy: vi.fn(() => ({
        toArray: vi.fn(() => Promise.resolve(Array.from(mockSyncQueue.values()))),
      })),
      bulkDelete: vi.fn((keys: number[]) => {
        keys.forEach((k) => mockSyncQueue.delete(k))
        return Promise.resolve()
      }),
      update: vi.fn((key: number, updates: Partial<SyncQueueItem>) => {
        const existing = mockSyncQueue.get(key)
        if (existing) {
          mockSyncQueue.set(key, { ...existing, ...updates })
        }
        return Promise.resolve(1)
      }),
    },
    transaction: vi.fn((_mode: string, _tables: string[], callback: () => Promise<void>) =>
      callback()
    ),
  }

  return { mockEvents, mockCalendars, mockAccounts, mockSyncQueue, mockDb }
})

vi.mock('@/lib/db/db', () => ({
  db: mockDb,
}))

import { addEvent, getEventById, getAllEvents, deleteEvent, updateEvent } from '../events'
import {
  addCalendar,
  getCalendarById,
  getAllCalendars,
  deleteCalendar,
  updateCalendar,
} from '../calendars'
import { addAccount, getAccountById, getAllAccounts, deleteAccount } from '../accounts'
import { addToSyncQueue, getSyncQueue, clearSyncQueue, getSyncQueueCount } from '../syncQueue'

describe('Events Repository', () => {
  beforeEach(async () => {
    mockEvents.clear()
    vi.clearAllMocks()
  })

  describe('addEvent', () => {
    it('adds an event to the database', async () => {
      const event: StoredEvent = {
        id: 'event-1',
        calendarId: 'default',
        title: 'Test Event',
        start: '2024-03-15T10:00:00Z',
        end: '2024-03-15T11:00:00Z',
        isAllDay: false,
        syncStatus: 'synced',
        createdAt: '2024-03-15T09:00:00Z',
        updatedAt: '2024-03-15T09:00:00Z',
      }

      const result = await addEvent(event)
      expect(result).toBe('event-1')
    })
  })

  describe('getEventById', () => {
    it('retrieves an event by id', async () => {
      const event: StoredEvent = {
        id: 'event-2',
        calendarId: 'default',
        title: 'Test Event',
        start: '2024-03-15T10:00:00Z',
        end: '2024-03-15T11:00:00Z',
        isAllDay: false,
        syncStatus: 'synced',
        createdAt: '2024-03-15T09:00:00Z',
        updatedAt: '2024-03-15T09:00:00Z',
      }

      await addEvent(event)
      const retrieved = await getEventById('event-2')
      expect(retrieved?.title).toBe('Test Event')
    })

    it('returns undefined for non-existent event', async () => {
      const retrieved = await getEventById('non-existent')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('updateEvent', () => {
    it('updates an existing event', async () => {
      const event: StoredEvent = {
        id: 'event-3',
        calendarId: 'default',
        title: 'Original Title',
        start: '2024-03-15T10:00:00Z',
        end: '2024-03-15T11:00:00Z',
        isAllDay: false,
        syncStatus: 'synced',
        createdAt: '2024-03-15T09:00:00Z',
        updatedAt: '2024-03-15T09:00:00Z',
      }

      await addEvent(event)
      await updateEvent('event-3', { title: 'Updated Title' })

      const updated = await getEventById('event-3')
      expect(updated?.title).toBe('Updated Title')
    })
  })

  describe('deleteEvent', () => {
    it('deletes an event', async () => {
      const event: StoredEvent = {
        id: 'event-4',
        calendarId: 'default',
        title: 'To Delete',
        start: '2024-03-15T10:00:00Z',
        end: '2024-03-15T11:00:00Z',
        isAllDay: false,
        syncStatus: 'synced',
        createdAt: '2024-03-15T09:00:00Z',
        updatedAt: '2024-03-15T09:00:00Z',
      }

      await addEvent(event)
      await deleteEvent('event-4')

      const retrieved = await getEventById('event-4')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('getAllEvents', () => {
    it('returns all events', async () => {
      const event1: StoredEvent = {
        id: 'event-5',
        calendarId: 'default',
        title: 'Event 1',
        start: '2024-03-15T10:00:00Z',
        end: '2024-03-15T11:00:00Z',
        isAllDay: false,
        syncStatus: 'synced',
        createdAt: '2024-03-15T09:00:00Z',
        updatedAt: '2024-03-15T09:00:00Z',
      }

      const event2: StoredEvent = {
        id: 'event-6',
        calendarId: 'default',
        title: 'Event 2',
        start: '2024-03-16T10:00:00Z',
        end: '2024-03-16T11:00:00Z',
        isAllDay: false,
        syncStatus: 'synced',
        createdAt: '2024-03-16T09:00:00Z',
        updatedAt: '2024-03-16T09:00:00Z',
      }

      await addEvent(event1)
      await addEvent(event2)

      const events = await getAllEvents()
      expect(events.length).toBe(2)
    })
  })
})

describe('Calendars Repository', () => {
  beforeEach(async () => {
    mockCalendars.clear()
    vi.clearAllMocks()
  })

  describe('addCalendar', () => {
    it('adds a calendar to the database', async () => {
      const calendar: StoredCalendar = {
        id: 'cal-1',
        name: 'Test Calendar',
        color: '#FF0000',
        isVisible: true,
        isDefault: false,
      }

      const result = await addCalendar(calendar)
      expect(result).toBe('cal-1')
    })
  })

  describe('getCalendarById', () => {
    it('retrieves a calendar by id', async () => {
      const calendar: StoredCalendar = {
        id: 'cal-2',
        name: 'My Calendar',
        color: '#00FF00',
        isVisible: true,
        isDefault: true,
      }

      await addCalendar(calendar)
      const retrieved = await getCalendarById('cal-2')
      expect(retrieved?.name).toBe('My Calendar')
    })
  })

  describe('updateCalendar', () => {
    it('updates an existing calendar', async () => {
      const calendar: StoredCalendar = {
        id: 'cal-3',
        name: 'Original Name',
        color: '#0000FF',
        isVisible: true,
        isDefault: false,
      }

      await addCalendar(calendar)
      await updateCalendar('cal-3', { name: 'Updated Name' })

      const updated = await getCalendarById('cal-3')
      expect(updated?.name).toBe('Updated Name')
    })
  })

  describe('deleteCalendar', () => {
    it('deletes a calendar', async () => {
      const calendar: StoredCalendar = {
        id: 'cal-4',
        name: 'To Delete',
        color: '#FF0000',
        isVisible: true,
        isDefault: false,
      }

      await addCalendar(calendar)
      await deleteCalendar('cal-4')

      const retrieved = await getCalendarById('cal-4')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('getAllCalendars', () => {
    it('returns all calendars', async () => {
      const cal1: StoredCalendar = {
        id: 'cal-5',
        name: 'Calendar 1',
        color: '#FF0000',
        isVisible: true,
        isDefault: false,
      }

      const cal2: StoredCalendar = {
        id: 'cal-6',
        name: 'Calendar 2',
        color: '#00FF00',
        isVisible: true,
        isDefault: false,
      }

      await addCalendar(cal1)
      await addCalendar(cal2)

      const calendars = await getAllCalendars()
      expect(calendars.length).toBe(2)
    })
  })
})

describe('Accounts Repository', () => {
  beforeEach(async () => {
    mockAccounts.clear()
    vi.clearAllMocks()
  })

  describe('addAccount', () => {
    it('adds an account to the database', async () => {
      const account: StoredAccount = {
        id: 'acc-1',
        name: 'Test Account',
        serverUrl: 'https://example.com/caldav',
        username: 'user@example.com',
      }

      const result = await addAccount(account)
      expect(result).toBe('acc-1')
    })
  })

  describe('getAccountById', () => {
    it('retrieves an account by id', async () => {
      const account: StoredAccount = {
        id: 'acc-2',
        name: 'My Account',
        serverUrl: 'https://example.com/caldav',
        username: 'user',
      }

      await addAccount(account)
      const retrieved = await getAccountById('acc-2')
      expect(retrieved?.name).toBe('My Account')
    })
  })

  describe('deleteAccount', () => {
    it('deletes an account', async () => {
      const account: StoredAccount = {
        id: 'acc-3',
        name: 'To Delete',
        serverUrl: 'https://example.com/caldav',
        username: 'user',
      }

      await addAccount(account)
      await deleteAccount('acc-3')

      const retrieved = await getAccountById('acc-3')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('getAllAccounts', () => {
    it('returns all accounts', async () => {
      const acc1: StoredAccount = {
        id: 'acc-4',
        name: 'Account 1',
        serverUrl: 'https://example.com/caldav',
        username: 'user1',
      }

      const acc2: StoredAccount = {
        id: 'acc-5',
        name: 'Account 2',
        serverUrl: 'https://example2.com/caldav',
        username: 'user2',
      }

      await addAccount(acc1)
      await addAccount(acc2)

      const accounts = await getAllAccounts()
      expect(accounts.length).toBe(2)
    })
  })
})

describe('Sync Queue', () => {
  beforeEach(async () => {
    mockSyncQueue.clear()
    vi.clearAllMocks()
  })

  describe('addToSyncQueue', () => {
    it('adds an item to the sync queue', async () => {
      const result = await addToSyncQueue('create', 'event', 'event-1', { title: 'Test' })
      expect(result).toBeDefined()
    })
  })

  describe('getSyncQueue', () => {
    it('returns all items in the sync queue', async () => {
      await addToSyncQueue('create', 'event', 'event-1')
      await addToSyncQueue('update', 'calendar', 'cal-1')

      const queue = await getSyncQueue()
      expect(queue.length).toBe(2)
    })
  })

  describe('clearSyncQueue', () => {
    it('clears all items from the sync queue', async () => {
      await addToSyncQueue('create', 'event', 'event-1')
      await clearSyncQueue()

      const queue = await getSyncQueue()
      expect(queue.length).toBe(0)
    })
  })

  describe('getSyncQueueCount', () => {
    it('returns the count of items in the queue', async () => {
      await addToSyncQueue('create', 'event', 'event-1')
      await addToSyncQueue('update', 'event', 'event-2')
      await addToSyncQueue('delete', 'calendar', 'cal-1')

      const count = await getSyncQueueCount()
      expect(count).toBe(3)
    })
  })
})
