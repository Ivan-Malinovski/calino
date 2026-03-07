# Calino

A browser-based CalDAV client — sync with your own server, no cloud required.

**Philosophy:** Your calendar data should belong to you, not Google or Apple. Calino connects to any CalDAV server (Nextcloud, Baikal, Radicale, etc.). Your events stay in your own server, not in ours. The only thing that lives locally is your preferences. No accounts, no signups, no data mining.

## Features

**Views:**

- Month, week, day, agenda
- Click week numbers to jump straight to that week
- Click any date to see it in day view
- Drag events to move them, drag edges to resize

**Time stuff:**

- Auto timezone detection
- 12h/24h toggle
- Compact recurring events (no giant blocks cluttering your week)
- Apple Travel Time support

**Tasks:**

- Full VTODO support with due dates, priorities, and completion status
- Shows up as checkboxes in month view, inline in week/day view

**Smart input:**

- Type naturally: _"coffee with friends on wednesday, at 12-18"_ → creates a 4-hour event on March 4, 2026
- Press `Cmd+K` (or `Ctrl+K`) for the command palette — navigate, create events, sync, everything from one bar

**Coming:**

- Theme support (dark mode + custom)

**No login screen.** Open the app, you're in.

## Quick Start

```bash
pnpm install
pnpm dev
```

## Selfhosting

Calino is just a static React app — host it anywhere that serves HTML/JS.

1. Build: `pnpm build`
2. Serve the `dist/` folder

**Config:**

- Click the gear icon or use `Cmd+K` → "Settings"
- Add your CalDAV server URL, username, password
- App stores credentials in localStorage (encrypted)

**Site URL (for SEO/social cards):**

```bash
cp .env.example .env.local
# Edit .env.local and set VITE_SITE_URL=https://your-domain.com
pnpm build
```

**Supported CalDAV servers:**

- Baikal
- Nextcloud Calendar
- Radicale
- Any RFC 4791 compliant server

**CORS note:** Most CalDAV servers don't send CORS headers by default. If you get CORS errors, add these headers to your reverse proxy:

```
Access-Control-Allow-Origin: <your-calino-origin>
Access-Control-Allow-Headers: Authorization, Content-Type, Depth, If-Match, If-None-Match
Access-Control-Allow-Methods: GET, PUT, POST, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS
```

### Caddy example

```caddy
yourcaldav.server.com {
    @cors method OPTIONS

    handle @cors {
        header {
            Access-Control-Allow-Origin "*"
            Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PROPFIND, REPORT, OPTIONS"
            Access-Control-Allow-Headers "Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match"
        }
        respond "" 204
    }

    header {
        Access-Control-Allow-Origin "*"
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PROPFIND, REPORT, OPTIONS"
        Access-Control-Allow-Headers "Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match"
        -Server
    }

    reverse_proxy 192.168.1.1:89 # replace with your own address
}
```

## Tech Stack

React 18 + TypeScript + Vite, Zustand, Dexie.js, date-fns, chrono-node, @dnd-kit, framer-motion, Fuse.js, tsdav, Vitest

## License

MIT
