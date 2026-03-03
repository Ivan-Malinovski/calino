# Calino - AI Agent Guidelines

React 18 + TypeScript + Vite calendar app with CalDAV sync and NLP event creation.

## Commands

```bash
pnpm install          # Install deps
pnpm dev              # Dev server
pnpm build            # Production build
pnpm lint             # ESLint
pnpm typecheck        # TypeScript
pnpm test             # Run tests
```

## Code Style

- **Imports**: React → External → Internal → Types → Styles
- **TypeScript**: Explicit params/returns, no `any`, use interfaces
- **Components**: Functional only, destructure props, <200 lines
- **Testing**: Vitest + RTL, follow AAA pattern

## Project Structure

```
src/
├── components/     # CalendarGrid, EventCard, EventModal
├── features/       # calendar, events, caldav, nlp, search
├── hooks/          # Custom hooks
├── lib/db/         # Dexie.js IndexedDB
├── store/          # Zustand stores
└── types/          # TypeScript interfaces
```

## Key Guidelines

- **State**: Use Zustand with persist middleware
- **Dates**: Store UTC, use `date-fns`, ISO 8601 strings
- **Sync**: Optimistic UI, queue CalDAV changes
- **Animations**: Framer Motion for complex, CSS for simple (200-300ms)
- **Errors**: Custom error classes, user-friendly messages, try/catch async

## Files

- Store: `src/store/` (calendarStore, settingsStore)
- Database: `src/lib/db/` (Dexie tables: events, calendars, accounts, syncQueue)
- Settings: `/settings` route, `src/store/settingsStore.ts`
- Plans: See `PLANS/` directory for feature roadmaps

## Power Bar (Command Palette)

A VS Code-style command palette activated with `Cmd+K` (or `Ctrl+K`). Located at `src/features/commandPalette/`.

**Features:**

- **Commands**: Navigation (today, next week, switch views), Actions (new event, sync), Settings
- **Smart detection**: Type naturally like "tomorrow meeting at 2pm" for quick event creation
- **Prefix hints**: `>` for commands, `@` for quick navigation
- **Toast feedback**: Shows confirmation when actions execute

**Key files:**

- `components/CommandPalette.tsx` - Main modal component
- `hooks/useCommandPalette.ts` - Logic for parsing input and executing commands
- `commands/index.ts` - Command registry

## VTODO (Tasks)

Tasks are stored as calendar events with `type: 'task'`. Key task fields:

- `dueDate`: ISO date string (required for display)
- `dueDateTime`: Optional time component in DUE property
- `isAllDay`: True if no specific time (shown in footer)
- `completed`: Boolean completion status
- `priority`: TaskPriority enum (1=high, 5=low, 9=none)

**Display logic:**

- Month view: Tasks appear with checkbox, strike-through when completed
- Week/Day view timed: Tasks with due time show in events overlay at their time
- Week/Day view all-day: Tasks without due time shown in sticky footer aligned to day columns

**Key files:**

- `types/index.ts` - EventType, TaskPriority, CalendarEvent task fields
- `features/caldav/adapter/iCalendarAdapter.ts` - VTODO parsing/generation (parseICALTask, taskToICAL)
- `features/calendar/components/EventModal.tsx` - Task form with completed, due date/time, priority
- `features/calendar/components/WeekView.tsx` - Task footer with sticky positioning
- `features/calendar/components/DayView.tsx` - Task footer with sticky positioning
