# Calino - AI Agent Guidelines

**Version:** 0.2.0 (follows semver: 0.x.y = breaking changes allowed, bump minor for features, patch for fixes)

React 18 + TypeScript + Vite calendar app with CalDAV sync, NLP event creation, and PWA support.

## Commands

```bash
pnpm install          # Install deps
pnpm dev              # Dev server
pnpm build            # Production build
pnpm lint             # ESLint
pnpm lint:fix         # ESLint with auto-fix
pnpm typecheck        # TypeScript
pnpm test             # Run tests
pnpm test:run         # Run tests once
pnpm format           # Prettier format
```

## Code Style

- **Imports**: React → External → Internal → Types → Styles
- **TypeScript**: Explicit params/returns, no `any`, use interfaces
- **Components**: Functional only, destructure props, <200 lines
- **Testing**: Vitest + RTL, follow AAA pattern

## Project Structure

```
src/
├── components/     # Common UI (ThemeProvider, common/)
├── features/      # calendar, events, caldav, nlp, search, commandPalette, settings, onboarding
├── hooks/         # Custom hooks (useNotifications, useSwipeNavigation)
├── lib/           # db/ (Dexie), themes/, notifications.ts
├── store/         # Zustand stores (calendarStore, settingsStore)
├── themes/        # CSS themes (built-in.css)
├── types/         # TypeScript interfaces
└── test/          # Test setup
```

## Key Guidelines

- **State**: Use Zustand with persist middleware
- **Dates**: Store UTC, use `date-fns`, ISO 8601 strings
- **Sync**: Optimistic UI, queue CalDAV changes
- **Animations**: Framer Motion for complex, CSS for simple (200-300ms)
- **Errors**: Custom error classes, user-friendly messages, try/catch async
- **Mobile**: Touch gestures via `useSwipeNavigation`, native event listeners for pinch-to-zoom
- **PWA**: Notifications via `lib/notifications.ts`, service worker for offline

## Routes

| Path                                 | Component               |
| ------------------------------------ | ----------------------- |
| `/`                                  | Calendar (default view) |
| `/month`, `/week`, `/day`, `/agenda` | Calendar views          |
| `/settings`                          | SettingsPage            |
| `/privacy`                           | PrivacyPolicy           |

## Key Files

- **Store**: `src/store/calendarStore.ts`, `src/store/settingsStore.ts`
- **Database**: `src/lib/db/` (Dexie tables: events, calendars, accounts, syncQueue)
- **Notifications**: `src/lib/notifications.ts`, `src/hooks/useNotifications.ts`
- **Config**: `src/config.ts` (appName, colors, default themes)

## Features

### Power Bar (Command Palette)

- Activated with `Cmd+K` / `Ctrl+K`
- Smart detection: type "tomorrow meeting at 2pm" for quick event creation
- Prefix hints: `>` for commands, `@` for navigation
- Files: `features/commandPalette/`, `hooks/useCommandPalette.ts`, `features/commandPalette/commands/`

### VTODO (Tasks)

- Stored as events with `type: 'task'`
- Fields: `dueDate`, `dueDateTime`, `isAllDay`, `completed`, `priority` (0-9)
- Display: checkbox in month view, sticky footer in week/day view

### Zoom

- `Ctrl+scroll` to zoom in/out on WeekView and DayView
- Events scale with hour rows

### Notifications

- PWA push notifications with configurable reminders
- Request permission via `requestNotificationPermission()` in `lib/notifications.ts`

### Self-Hosting

- Set `VITE_SITE_URL=https://your-domain.com` in `.env`
- See `.env.example`
