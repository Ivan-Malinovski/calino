# GoodCal - AI Agent Guidelines

## Project Overview

GoodCal is a modern calendar application with CalDAV synchronization and natural language event creation. Built with React, TypeScript, and Vite.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Package Manager**: pnpm
- **Testing**: Vitest + React Testing Library
- **Styling**: CSS Modules or Tailwind CSS
- **Date Handling**: date-fns + chrono-node (NLP parsing)
- **CalDAV**: tsdav library
- **State Management**: Zustand (Recommended) or React Context
- **Local Storage**: IndexedDB via Dexie.js

---

## Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm dev              # Start development server
pnpm build            # Production build

# Quality
pnpm lint             # Run ESLint
pnpm lint:fix         # Auto-fix lint issues
pnpm typecheck        # TypeScript type checking
pnpm format           # Format with Prettier

# Testing
pnpm test             # Run tests in watch mode
pnpm test -- {file}   # Run single test file
pnpm test -- --run    # Run tests once (no watch)
pnpm test:coverage    # Coverage report
```

---

## Code Style Guidelines

### Imports

Organize imports in this order (separate with blank lines):

1. React/core imports
2. External libraries
3. Internal components/hooks
4. Types/interfaces
5. Styles/assets

```typescript
// 1. React
import { useState, useCallback } from 'react';

// 2. External
import { format, addDays } from 'date-fns';
import { Chrono } from 'chrono-node';

// 3. Internal
import { CalendarGrid } from '@/components/CalendarGrid';
import { useCalendarSync } from '@/hooks/useCalendarSync';

// 4. Types
import type { CalendarEvent, CalDAVAccount } from '@/types';

// 5. Styles
import styles from './EventModal.module.css';
```

### Formatting (Prettier)

- 2-space indentation
- Single quotes for strings
- Trailing commas (ES5 style)
- Print width: 100
- Single empty line at EOF

### TypeScript

- **Always** use explicit types for function parameters and return values
- **Never** use `any` - use `unknown` if type is truly unknown
- Use interfaces for objects, types for unions/primitives
- Enable strict mode in tsconfig.json

```typescript
// Good
function getEventById(id: string): CalendarEvent | undefined {
  return events.find(e => e.id === id);
}

// Bad
function getEventById(id) {
  return events.find(e => e.id === id);
}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables/functions | camelCase | `getEvents()`, `isLoading` |
| Components | PascalCase | `CalendarGrid`, `EventModal` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_EVENT_TITLE_LENGTH` |
| File names (components) | PascalCase | `EventModal.tsx` |
| File names (utilities) | camelCase | `dateUtils.ts` |
| Hooks | camelCase with `use` prefix | `useCalendarSync.ts` |

### Component Guidelines

- Use **functional components only** (no class components)
- Use **hooks** for all state management
- Keep components small and focused (single responsibility)
- Extract reusable logic into custom hooks
- Use composition over inheritance
- Always destructure props

```typescript
// Good
interface EventCardProps {
  event: CalendarEvent;
  onClick?: (event: CalendarEvent) => void;
}

export function EventCard({ event, onClick }: EventCardProps): JSX.Element {
  const handleClick = useCallback(() => {
    onClick?.(event);
  }, [event, onClick]);

  return (
    <div className={styles.card} onClick={handleClick}>
      {event.title}
    </div>
  );
}
```

### Error Handling

- Create custom error classes for domain-specific errors
- Use error boundaries for React component tree
- Always show user-friendly error messages
- Log errors for debugging (not to user)
- Handle async operations with try/catch

```typescript
// Custom error class
export class CalendarSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'CalendarSyncError';
  }
}

// Usage
try {
  await syncCalendar(account);
} catch (error) {
  if (error instanceof CalendarSyncError) {
    showToast(error.recoverable ? 'Sync failed. Retrying...' : 'Sync failed');
  }
}
```

### Testing

- Use **Vitest** for unit tests
- Use **React Testing Library** for component tests
- Follow AAA pattern: Arrange → Act → Assert
- Test behavior, not implementation
- Name tests descriptively: `describe('CalendarGrid', () => { it('renders current month days') })`

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('EventModal', () => {
  it('calls onSave when save button is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<EventModal onSave={onSave} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
```

---

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── CalendarGrid/
│   ├── EventCard/
│   ├── EventModal/
│   └── common/          # Buttons, inputs, modals
├── features/            # Feature-based modules
│   ├── calendar/        # Calendar views and logic
│   ├── events/          # Event CRUD operations
│   ├── caldav/          # CalDAV sync integration
│   └── nlp/             # Natural language parsing
├── hooks/               # Custom React hooks
├── lib/                 # Utilities and services
├── types/               # TypeScript interfaces
├── styles/              # Global styles
└── utils/               # Helper functions
```

---

## Best Practices

1. **Always write tests** for new features before committing
2. Use **absolute imports** (configure in tsconfig.json path aliases)
3. Keep components under 200 lines
4. Extract complex logic into utility functions
5. Use environment variables for configuration (never hardcode secrets)
6. Follow conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
7. Run `pnpm typecheck && pnpm lint && pnpm test` before committing

## Future Considerations

### PWA/Mobile Ready
- Use responsive design from the start (mobile-first CSS)
- Use semantic HTML for accessibility
- Consider PWA features: service worker, manifest.json, offline-first data
- Use viewport-relative units and responsive breakpoints
- Test on mobile/tablet sizes during development

### Multi-User Support
- Design for account isolation from the start
- Store user preferences separately from calendar data
- Consider shared calendars/collaboration later

### Search Feature
- Plan for full-text search on event titles, descriptions, locations
- Consider indexing with Fuse.js for client-side search
- Server-side search via CalDAV if available

### Modern UX Features
- Drag-and-drop event rescheduling in week/day views
- Keyboard shortcuts for power users
- Toast notifications for sync status
- Optimistic UI updates for instant feedback

---

## UX & Animations

**Smooth user experience and polished animations are of utmost importance.**

### Principles
- **Instant feedback**: Optimistic UI updates (update UI immediately, sync in background)
- **Smooth transitions**: Use CSS transitions or Framer Motion for all state changes
- **Loading states**: Never show raw loading spinners - use skeleton screens or subtle animations
- **Micro-interactions**: Animate button presses, hover states, modal opens/closes

### Implementation Guidelines
- Use CSS transitions for simple animations (200-300ms)
- Use `framer-motion` for complex animations (drag-drop, layout changes)
- Animate: modal open/close, day/week/month view switches, event creation, toast notifications
- Avoid jarring jumps - animate height/position changes

```typescript
// Example: Smooth modal with framer-motion
import { motion, AnimatePresence } from 'framer-motion';

<AnimatePresence>
  {isOpen && (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <EventModal />
    </motion.div>
  )}
</AnimatePresence>
```

### Performance
- Keep animations at 60fps
- Use `transform` and `opacity` for GPU-accelerated animations
- Avoid animating `width`, `height`, `top`, `left` (trigger layout recalculations)
- Test on lower-end devices

---

## State Management Guidelines

### Recommended: Zustand
- Use Zustand for global state (calendars, events, accounts)
- Simple API with hooks: `useCalendarStore()`
- Supports persistence middleware for local storage
- Avoids boilerplate of Redux

```typescript
// Example store
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CalendarState {
  events: CalendarEvent[];
  calendars: Calendar[];
  addEvent: (event: CalendarEvent) => void;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set) => ({
      events: [],
      calendars: [],
      addEvent: (event) => set((state) => ({ events: [...state.events, event] })),
      updateEvent: (id, updates) => set((state) => ({
        events: state.events.map(e => e.id === id ? { ...e, ...updates } : e)
      })),
      deleteEvent: (id) => set((state) => ({
        events: state.events.filter(e => e.id !== id)
      })),
    }),
    { name: 'goodcal-storage' }
  )
);
```

### Alternative: React Context
- Use for small-scale state (theme, user preferences)
- Use for provider composition (CalendarProvider, SyncProvider)

---

## Date/Time Handling Guidelines

### Storage Format
- **Always store dates in UTC** in the database
- Convert to local time only for display
- Use `date-fns` for all date operations

### Key Rules
- Never use JavaScript `Date` object directly for storage
- Use ISO 8601 strings for serialization
- Use `date-fns` functions: `toISOString()`, `parseISO()`, `format()`, `parse()`
- Store timezone offset if needed, but prefer UTC

```typescript
// Good
const eventStart = parseISO('2024-03-15T14:00:00Z'); // UTC
const displayTime = format(eventStart, 'h:mm a'); // Local time

// Bad
const eventStart = new Date('2024-03-15T14:00:00');
```

### Time Zones (Future)
- For MVP, assume single timezone (user's local)
- Future: Store events with IANA timezone (e.g., "America/New_York")
- Future: Use `date-fns-tz` for timezone conversions

---

## Local Data Persistence

### Recommended: Dexie.js (IndexedDB)
- Use Dexie.js for local event/calendar storage
- IndexedDB is more capable than localStorage (larger capacity, async)
- Dexie provides a clean Promise-based API

```typescript
// Example Dexie store
import Dexie, { Table } from 'dexie';

interface StoredEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string; // ISO 8601
  end: string;
  // ... other fields
}

class GoodCalDB extends Dexie {
  events!: Table<StoredEvent>;
  calendars!: Table<Calendar>;

  constructor() {
    super('GoodCalDB');
    this.version(1).stores({
      events: 'id, calendarId, start, end',
      calendars: 'id, name'
    });
  }
}

export const db = new GoodCalDB();
```

### Sync Strategy
1. Load events from IndexedDB on app start
2. Merge with CalDAV data after sync
3. Write to IndexedDB on every change (optimistic UI)
4. Queue CalDAV changes for sync

### Data Flow
```
CalDAV Server <--> Sync Engine <--> Zustand Store <--> UI
                              |
                         IndexedDB (Dexie)
```

---

## Error Handling in Data Layer

### IndexedDB Errors
- Handle quota exceeded errors gracefully
- Implement cleanup strategy for old events
- Show user-friendly message when storage is full

### Sync Errors
- Network failures: Queue changes for retry
- Conflict errors: Implement resolution strategy (server wins, local wins, merge)
- Auth errors: Prompt re-authentication

### Error Recovery
- Always keep local backup before overwriting
- Implement undo functionality operations
- Log errors for debugging ( for destructivenot to user)

```typescript
// Example: Handling sync errors
interface SyncError {
  code: 'NETWORK_ERROR' | 'AUTH_ERROR' | 'CONFLICT' | 'QUOTA_EXCEEDED';
  message: string;
  recoverable: boolean;
  retryAt?: Date;
}

async function handleSyncError(error: SyncError): Promise<void> {
  switch (error.code) {
    case 'NETWORK_ERROR':
      queueForRetry(error.retryAt);
      showToast('Changes saved locally. Will sync when online.');
      break;
    case 'AUTH_ERROR':
      promptReauth();
      break;
    case 'CONFLICT':
      await resolveConflict();
      break;
    case 'QUOTA_EXCEEDED':
      showToast('Storage full. Please delete old events.');
      break;
  }
}
```

## Working with Plans

See the `PLANS/` directory for detailed implementation plans on major features:

- `PLANS/01-setup.md` - Project initialization and tooling
- `PLANS/02-core-calendar.md` - Core calendar UI and event management
- `PLANS/03-nlp-parser.md` - Natural language event creation
- `PLANS/04-caldav-sync.md` - CalDAV integration and sync
- `PLANS/05-search.md` - Full-text search functionality
- `PLANS/06-local-storage.md` - Local IndexedDB persistence

Each plan contains:
- Feature requirements
- Technical approach
- Implementation steps
- Testing strategy
