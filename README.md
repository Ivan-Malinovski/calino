# GoodCal

A modern calendar app with CalDAV sync and natural language event creation.

## Features

- **Multiple Views**: Month, week, day, and agenda views
- **NLP Events**: Create events like "meeting tomorrow at 2pm"
- **CalDAV Sync**: Sync with any CalDAV server (Baikal, Nextcloud, etc.)
- **Offline-first**: IndexedDB persistence
- **Search**: Cmd/Ctrl+K quick search
- **Drag & Drop**: Reschedule events in week/day views
- **Multiple Calendars**: Color-coded calendars
- **Settings**: Timezone, date/time formats, sync options

## Quick Start

```bash
pnpm install
pnpm dev
```

## Commands

| Command          | Description        |
| ---------------- | ------------------ |
| `pnpm dev`       | Development server |
| `pnpm build`     | Production build   |
| `pnpm test`      | Run tests          |
| `pnpm lint`      | ESLint             |
| `pnpm typecheck` | TypeScript         |

## Tech Stack

React 18 + TypeScript + Vite, Zustand, Dexie.js, date-fns, chrono-node, @dnd-kit, framer-motion, Fuse.js, tsdav, Vitest

## Project Structure

```
src/
├── components/     # Shared UI
├── features/       # calendar, caldav, nlp, search, settings
├── hooks/          # Custom hooks
├── lib/db/         # IndexedDB
├── store/          # Zustand
└── types/          # TypeScript
```

## License

MIT
