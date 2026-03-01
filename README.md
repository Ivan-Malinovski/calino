# GoodCal

A modern calendar application with CalDAV synchronization and natural language event creation.

## Features

- **Multiple Views**: Month, week, day, and agenda views
- **Natural Language Events**: Create events using natural language like "meeting tomorrow at 2pm"
- **CalDAV Sync**: Sync with any CalDAV server (Baikal, Nextcloud, etc.)
- **Local Storage**: Offline-first with IndexedDB persistence
- **Full-text Search**: Search events with Cmd/Ctrl+K
- **Drag and Drop**: Reschedule events by dragging in week/day views
- **Multiple Calendars**: Create and manage multiple calendars with colors
- **Settings**: Customizable timezone, date/time formats, and sync options

## Tech Stack

- React 18 + TypeScript + Vite
- pnpm (package manager)
- Zustand (state management)
- Dexie.js (IndexedDB)
- date-fns + chrono-node (date handling)
- @dnd-kit (drag and drop)
- framer-motion (animations)
- Fuse.js (search)
- tsdav (CalDAV client)
- rrule (recurring events)
- Vitest + React Testing Library (testing)

## Getting Started

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Run tests once (no watch mode)
pnpm test -- --run

# Lint
pnpm lint

# Type check
pnpm typecheck

# Format code
pnpm format
```

## Project Structure

```
src/
├── components/          # Shared UI components
│   └── common/          # Button, Input, Modal, etc.
├── features/
│   ├── calendar/        # Calendar views (Month, Week, Day, Agenda)
│   ├── caldav/         # CalDAV sync client and adapters
│   ├── nlp/            # Natural language parser
│   ├── search/         # Full-text search
│   └── settings/       # Settings pages
├── hooks/              # Custom React hooks
├── lib/
│   └── db/              # IndexedDB via Dexie.js
├── store/               # Zustand stores
└── types/               # TypeScript interfaces
```

## Commands

| Command          | Description              |
| ---------------- | ------------------------ |
| `pnpm dev`       | Start development server |
| `pnpm build`     | Production build         |
| `pnpm test`      | Run tests in watch mode  |
| `pnpm lint`      | Run ESLint               |
| `pnpm typecheck` | TypeScript checking      |
| `pnpm format`    | Format with Prettier     |

## License

MIT
