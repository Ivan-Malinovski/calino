# Plan 06: Local Data Persistence

## Objective
Implement offline-first data storage using IndexedDB for local event/calendar storage.

## Why IndexedDB?

-**: local **CapacityStorage is limited to ~5MB; IndexedDB can store hundreds of MB
- **Async**: IndexedDB is non-blocking, better for performance
- **Queryable**: Can create indexes for fast lookups
- **Dexie.js**: Clean Promise-based API

## Data Model

### Tables
```typescript
interface StoredEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;      // ISO 8601 UTC
  end: string;        // ISO 8601 UTC
  isAllDay: boolean;
  color?: string;
  recurrence?: string; // RRule as string
  etag?: string;      // For sync
  remoteId?: string;  // CalDAV resource ID
  syncStatus: 'synced' | 'pending' | 'conflict';
  createdAt: string;
  updatedAt: string;
}

interface StoredCalendar {
  id: string;
  accountId: string;
  name: string;
  color: string;
  ctag?: string;     // For incremental sync
  syncToken?: string;
  isVisible: boolean;
  isDefault: boolean;
}

interface StoredAccount {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  // Credentials stored separately (encrypted)
}
```

### Indexes
- Events: `id`, `calendarId`, `start`, `end`, `syncStatus`
- Calendars: `id`, `accountId`
- Accounts: `id`

## Architecture

```
src/lib/db/
├── db.ts              # Dexie instance
├── events.ts         # Event CRUD operations
├── calendars.ts      # Calendar CRUD operations
├── accounts.ts       # Account CRUD operations
├── syncQueue.ts      # Offline change queue
└── index.ts
```

## Implementation Steps

### Step 6.1: Install Dependencies
```bash
pnpm add dexie
pnpm add -D @types/dexie
```

### Step 6.2: Create Dexie Database
- Define schema with version 1
- Create tables: events, calendars, accounts
- Set up indexes

### Step 6.3: Implement Event Repository
- addEvent(event)
- updateEvent(id, updates)
- deleteEvent(id)
- getEventById(id)
- getEventsByDateRange(start, end)
- getEventsByCalendar(calendarId)
- getPendingEvents() - for sync queue

### Step 6.4: Implement Calendar Repository
- addCalendar(calendar)
- updateCalendar(id, updates)
- deleteCalendar(id)
- getCalendarsByAccount(accountId)

### Step 6.5: Implement Account Repository
- addAccount(account)
- updateAccount(id, updates)
- deleteAccount(id)
- getAllAccounts()

### Step 6.6: Sync Queue Management
- Track local changes when offline
- Queue structure: { operation, entity, data, timestamp }
- Process queue when online
- Retry failed operations

### Step 6.7: Integrate with Zustand
- Create middleware to sync Zustand store with IndexedDB
- Load from DB on app start
- Write to DB on every change

### Step 6.8: Encryption (Future)
- Encrypt sensitive data (credentials)
- Use Web Crypto API or library

## Sync Flow

```
1. App Start:
   Load from IndexedDB → Populate Zustand Store → Render UI

2. User Creates Event:
   Update Zustand (optimistic) → Write to IndexedDB → Queue CalDAV sync

3. CalDAV Sync:
   Fetch from server → Merge with local → Update IndexedDB → Update Zustand

4. Offline Change:
   Update Zustand → Write to IndexedDB → Add to sync queue

5. Come Online:
   Process sync queue → Update server → Clear queue → Update IndexedDB
```

## Testing Strategy
- Test CRUD operations for each table
- Test sync queue (add, process, retry)
- Test offline/online scenarios
- Performance test with 10,000+ events

## Dependencies to Add
- [ ] dexie

## Success Criteria
- [ ] Events persist after page reload
- [ ] Calendars persist after page reload
- [ ] Can query events by date range efficiently
- [ ] Sync queue works when offline
- [ ] All tests passing
