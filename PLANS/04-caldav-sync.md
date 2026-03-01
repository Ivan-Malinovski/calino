# Plan 04: CalDAV Integration

## Objective
Implement CalDAV synchronization for remote calendar access.

## Requirements (from project_requirements.txt)

### Connection
- CalDAV server discovery (well-known URIs)
- Baikal server specific compatibility
- Secure credential storage (local encrypted storage)
- Multiple account support

### Authentication
- Username/password authentication
- Credential testing on setup
- Session management
- Logout/reconnect functionality

### Synchronization
- Full calendar sync on startup
- Incremental sync (CTag/SyncToken)
- Manual refresh trigger
- Offline mode with queue for changes
- Conflict resolution strategy

### Multi-User Support
- Account isolation (each user's data separate)
- Store user preferences per account
- Support switching between accounts
- Shared calendars (future consideration)

### CalDAV Operations
- PROPFIND (discover calendars)
- REPORT (query events with time-range)
- PUT (create/update events)
- DELETE (remove events)
- Handle VCALENDAR/VEVENT iCalendar format

## Technical Approach

### Library: tsdav
tsdav provides a high-level API for CalDAV:
- Authentication (Basic, Digest, OAuth)
- Calendar queries
- Event creation/updates
- Synchronization support

### Architecture
```
src/features/caldav/
├── client/
│   ├── CalDAVClient.ts       # Main client wrapper
│   ├── credentials.ts        # Credential management
│   └── discovery.ts         # Server discovery
├── sync/
│   ├── syncEngine.ts        # Sync logic
│   ├── ctagManager.ts       # CTag tracking
│   └── conflictResolver.ts  # Conflict handling
├── adapter/
│   ├── iCalendarAdapter.ts  # Convert VEVENT ↔ internal
│   └── accountAdapter.ts    # Account data
├── hooks/
│   ├── useCalDAV.ts         # Main sync hook
│   └── useCalendarSync.ts   # Per-calendar sync
├── types/
│   └── index.ts
└── index.ts
```

### Data Flow
1. User enters credentials
2. Client discovers calendars (PROPFIND)
3. Client fetches events (REPORT with time-range)
4. Convert iCal to internal format
5. Merge with local state
6. Track changes for incremental sync

### Credential Storage
- Use electron-store or localStorage with encryption
- Never store plain passwords
- Consider using keytar for secure storage

## Implementation Steps

### Step 4.1: Install Dependencies
```bash
pnpm add tsdav ical.js
```

### Step 4.2: Create CalDAV Client Wrapper
- Initialize tsdav client
- Handle authentication
- Test connection on setup

### Step 4.3: Implement Server Discovery
- Try well-known URI: `/.well-known/caldav`
- Fall back to common paths
- Support custom server URL

### Step 4.4: Implement Calendar Discovery
- Fetch all calendars via PROPFIND
- Filter to user calendars (not addressbooks)
- Store calendar metadata

### Step 4.5: Implement Event Sync
- Fetch events with time-range (REPORT)
- Parse iCalendar format
- Convert to internal event model

### Step 4.6: Implement CRUD Operations
- Create: PUT new VEVENT
- Update: PUT modified VEVENT
- Delete: DELETE request

### Step 4.7: Implement Incremental Sync
- Track CTag or SyncToken
- Only fetch changed events
- Handle deleted events

### Step 4.8: Handle Offline Mode
- Queue changes when offline
- Apply queue when online
- Show pending sync indicator

### Step 4.9: Implement Conflict Resolution
- Detect conflicts (server vs local changes)
- Strategies: last-write-wins, prompt user, merge
- Default: server wins with local backup

### Step 4.10: Build Account Settings UI
- Add/edit/remove accounts
- Test connection button
- Sync status indicator

### Step 4.11: Multi-User Support
- Design data store for account isolation
- Each account has separate credential storage
- Account switcher in UI
- User preferences stored per account
- Handle concurrent sync of multiple accounts

## Edge Cases and Challenges
- Invalid credentials → Clear error message
- Server timeout → Retry with exponential backoff
- Unsupported recurrence → Flatten to individual events
- Large calendars → Paginate requests
- Timezone handling → Store as UTC, display in local

## Testing Strategy
- Mock CalDAV server responses
- Test each operation (PROPFIND, REPORT, PUT, DELETE)
- Test sync conflict scenarios
- Integration tests with Baikal Docker container

## Success Criteria
- [ ] Can add CalDAV account with credentials
- [ ] Can discover calendars on server
- [ ] Full sync fetches all events
- [ ] Incremental sync works (CTag tracking)
- [ ] Can create event on server
- [ ] Can update event on server
- [ ] Can delete event on server
- [ ] Multiple accounts work
- [ ] Offline mode queues changes
- [ ] Conflict handling works
- [ ] All tests passing
