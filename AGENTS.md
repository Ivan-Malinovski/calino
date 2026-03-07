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

### CalDAV Proxy (Cloudflare Worker)

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Restrict to Calino production only
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || ''
    const allowedOrigins = ['https://calino.io', 'https://www.calino.io']
    const isAllowed = !origin || allowedOrigins.some((allowed) => origin.startsWith(allowed))
    if (!isAllowed) {
      return new Response('Forbidden: This proxy is only for Calino users', { status: 403 })
    }

    const pathParts = url.pathname.split('/').filter(Boolean)

    if (pathParts.length === 0) {
      return new Response('Missing target server in path', { status: 400 })
    }

    const targetBase = decodeURIComponent(pathParts[0])
    let targetPath = '/' + pathParts.slice(1).join('/')

    if (targetPath === '/.well-known/caldav') {
      targetPath = '/dav.php'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods':
            'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS',
          'Access-Control-Allow-Headers':
            'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match',
        },
      })
    }

    const targetUrl = targetBase.replace(/\/$/, '') + targetPath
    const headers = new Headers(request.headers)
    headers.delete('host')

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.body,
      })
      const corsHeaders = new Headers(response.headers)
      corsHeaders.set('Access-Control-Allow-Origin', '*')
      corsHeaders.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS'
      )
      corsHeaders.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match'
      )
      return new Response(response.body, { status: response.status, headers: corsHeaders })
    } catch (e) {
      return new Response('Proxy error: ' + e.message, { status: 502 })
    }
  },
}
```

**Usage:** In Calino, set CalDAV URL to:

```
https://caldavproxy.cf-e13.workers.dev/https%3A%2F%2Fcal.malinov.ski
```

### CalDAV Proxy (Cloudflare Worker)

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url)
    const targetBase = url.searchParams.get('server')

    if (!targetBase) {
      return new Response('Missing server param', { status: 400 })
    }

    let targetPath = url.pathname

    if (targetPath === '/' || targetPath === '') {
      targetPath = '/dav.php'
    }

    if (targetPath === '/.well-known/caldav') {
      return Response.redirect(`${targetBase}/dav.php`, 301)
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods':
            'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS',
          'Access-Control-Allow-Headers':
            'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match',
        },
      })
    }

    const targetUrl = targetBase.replace(/\/$/, '') + targetPath

    const headers = new Headers(request.headers)
    headers.delete('host')

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.body,
      })

      const corsHeaders = new Headers(response.headers)
      corsHeaders.set('Access-Control-Allow-Origin', '*')
      corsHeaders.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS'
      )
      corsHeaders.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match'
      )

      return new Response(response.body, {
        status: response.status,
        headers: corsHeaders,
      })
    } catch (e) {
      return new Response('Proxy error: ' + e.message, { status: 502 })
    }
  },
}
```

**Usage:** Set CalDAV URL to:

```
https://caldavproxy.cf-e13.workers.dev?server=https://cal.malinov.ski
```
