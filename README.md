# Calino

**A lightweight CalDAV calendar for the web.**

---

<div align="center">

[![Latest release](https://img.shields.io/github/v/release/Ivan-Malinovski/calino?style=flat-square&logo=android&logoColor=white&label=android)](https://github.com/Ivan-Malinovski/calino/releases/latest)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fcalino-2496ED?style=flat-square&logo=docker&logoColor=white)](https://ghcr.io/ivan-malinovski/calino)
[![License](https://img.shields.io/github/license/Ivan-Malinovski/calino?style=flat-square)](https://github.com/Ivan-Malinovski/calino/blob/main/LICENSE)
[![CalDAV](https://img.shields.io/badge/RFC%204791%20%2F%205459-CalDAV-blue?style=flat-square&logo=icalendar&logoColor=white)](https://datatracker.ietf.org/doc/html/rfc4791)
[![Made with Capacitor](https://img.shields.io/badge/android-Capacitor-119EFF?style=flat-square&logo=capacitor&logoColor=white)](https://capacitorjs.com/)

</div>

**Calino is a local-first, browser-based calendar client that connects to your calendar services.** No Calino account is required: the app is a static page, stores its working data locally, and syncs with the CalDAV/CardDAV servers you configure. Optional webcal feeds, CORS proxies, AI photo extraction, map links, and hosted fonts are separate network integrations.

If you've been looking for a beautiful, modern browser-based CalDAV calendar that doesn't come as part of a bloated suite, Calino has you covered.

**Try it now at [calino.io](https://calino.io)** — the hosted version, nothing to install. Prefer to run your own? Self-hosting instructions are below.

> **Active project:** Calino is under active development. New features and improvements ship regularly — please report bugs, they're more than welcome!

<img width="1613" height="942" alt="image" src="https://github.com/user-attachments/assets/832356b1-0b20-4161-8083-06ff71934a16" />
(more screenshots at the bottom)

### CalDAV Proxy

Due to the browser-based nature of Calino, a web CalDAV/CardDAV server must allow requests from your Calino origin with CORS headers. If that's not an option, you can use a proxy URL during setup; Calino provides `https://proxy.calino.io` as a convenience.

With a proxy, requests pass through the proxy operator, so use your own proxy or configure CORS directly when that matters. The hosted proxy sees connection metadata and request URLs, but is designed not to log credentials or calendar bodies. See [`docs/CORS_PROXY.md`](./docs/CORS_PROXY.md) for the hosted proxy's limits and self-hosting options.

## Android app

Like Calino in your browser? A native Android app is available with OS-level reminders, background calendar mirroring, and optional BYOK AI photo extraction. The AI provider receives the image and prompt when you choose to use that feature. Find the latest APK in the [GitHub Releases page](https://github.com/Ivan-Malinovski/calino/releases).

---

## Features

I have made it as close as possible, as to what I envision the perfect CalDAV non-enterprise calendar to be, according to my own tastes. I'm simply sharing it with the world. The design philosophy is to have sensible and automatic default settings, that adjust according to your browser and calendar, so that you can use it from any client, without needing further customization.

### Views
- **Month, Week, 3-day, Day, Agenda, Year**
- Click week numbers to jump straight to that week
- Click any date to see it in day view
- Drag events to move them, drag edges to resize
- Vertical split view for tall windows; month shares vertical space with day view and agenda

### Smart Input
- Type naturally: *"coffee with friends on wednesday, at 12-18"* → creates a 4-hour event on that Wednesday
- Press `Cmd/Ctrl+K` for the command palette — navigate, create events, sync, search, settings from the same textbox
- Smart detection: start typing and NLP parses dates, times, and durations

### Tasks (VTODO) + Journals (VJOURNAL)
- Full VTODO support with due dates, priorities, and completion status
- **Recurring tasks** — standards-only (`RRULE` + per-occurrence completion, no vendor properties), so they interoperate with Thunderbird and other CalDAV clients. See [`docs/RECURRING_TASKS.md`](./docs/RECURRING_TASKS.md) for the wire format and a per-client interop table
- Shows as checkboxes in month view, inline in week/day view
- **VJOURNAL support**, a rarity among CalDAV clients. Use it for daily logs, or deeper notes related to your events.

### Contacts (CardDAV)
- Detects address books on your server and surfaces your contacts
- Auto-enabled when contacts are found — no extra setup

### Time & Calendar
- Auto-detected local timezone with an optional secondary timezone display
- 12h/24h toggle
- Multiple calendars with custom colors
- Compact recurring events (no giant blocks cluttering your week)
- Event transparency (TRANSP) — see busy/free status
- Apple Travel Time support

### Search
- Full-text search across all event fields
- Filter by calendar, date range, event type
- Fuzzy matching with Fuse.js

### Categories
- Organize events with color-coded categories
- Auto-apply categories based on keywords in event titles
- Filter events by category in sidebar
- Categories sync via iCalendar CATEGORIES property (RFC 5545)

### Desktop Integration
- **PWA** — install as a native app. Offline caching is opt-in and requires a deployment that serves the service worker with `Service-Worker-Allowed: /`.
- **Desktop notifications** with customizable reminders
- Sync retry: failed CalDAV operations are automatically retried; manual retry button in sidebar

### Customization
- **Themes** — light, dark, or follow system. Custom themes can be added by dropping a `.css` file into `public/themes/` and rebuilding the app (themes are loaded at build time, not at runtime).
- Configurable first day of week, date format, default duration
- Show/hide week numbers, completed tasks
- Adjust calendar and category colors
- **Settings sync** (disabled by default) — sync your preferences (theme, first day of week, time format, etc.) across devices via CalDAV. Opt-in: only activates when you enable it in Settings → Sync. Uses a dedicated hidden calendar on your server. See [`docs/CALINOSETTINGSSYNC.md`](./docs/CALINOSETTINGSSYNC.md) for details.

### Mobile
- Swipe left/right to navigate between months/weeks/days
- Tasks and agenda work well on mobile
- Optimized mobile view

### Android app
An Android APK is published on the [GitHub Releases page](https://github.com/Ivan-Malinovski/calino/releases) — it is not distributed via Google Play. Because it is sideloaded, Android may ask you to allow installs from your browser or file manager.

For notification reminders to actually fire reliably, some phone makers (Xiaomi/MIUI especially, also Oppo, Realme, Honor, OnePlus, and others) aggressively kill background apps to save battery, which silently breaks scheduled reminders. Check [dontkillmyapp.com](https://dontkillmyapp.com/) for your device and set Calino's battery/power mode to "No restrictions" or equivalent.

### Security and privacy
- **Local-first storage.** Calendar data, settings, contacts, and credentials are stored in the browser/device storage. Large attachments, photos, and raw ICS data use IndexedDB.
- **Credential warning.** The default local credential protection uses a key bundled with the app; it is obfuscation against casual inspection, not protection from someone who can read the app bundle and storage. For stronger protection, use the master-password setup wizard (`/setup`), which derives the key from a password that stays on the device.
- **No tracking analytics.** Calino does not include telemetry or analytics. Network requests can still go to the CalDAV/CardDAV servers, webcal feeds, configured proxy, optional map/font services, and an AI provider when those features are used.
- **Serverless by design.** The hosted app has no Calino account database or application backend; your configured integrations still have their own operators and privacy policies.
- **Docker hardening.** The bundled production image uses Caddy with security headers and container hardening; see [`docs/DOCKER.md`](./docs/DOCKER.md).
- **Self-hosted account preloading.** Ship Calino with preconfigured CalDAV accounts protected by a master password. Generate the config via the browser-based `/setup` wizard — no Node.js required. See [`docs/SELF_HOSTED_CONFIG.md`](./docs/SELF_HOSTED_CONFIG.md)

### Limitations
- No enterprise features
- No server-side calendar sharing or invitation scheduling
- Attendee details can be stored in iCalendar data and emailed via a local `mailto:` invite, but Calino is not an invitation service

---

## Self-hosting quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The Vite dev server is intended for development; use the production build or Docker for a deployment.

## Docker

The fastest way to self-host. Pre-built multi-arch images (amd64 + arm64) are on GHCR:

```bash
docker run -d -p 8080:8080 ghcr.io/ivan-malinovski/calino:latest
```

> **Tip:** `:latest` and `:main` point to the latest stable release published from a version tag. Pin a version tag without the leading `v` (for example `:0.30.0`) when you need a fixed image.

Or clone and customize:

```bash
git clone https://github.com/Ivan-Malinovski/calino.git
cd calino
docker compose up -d
```

Calino runs at http://localhost:8080 by default.
To customize settings (site URL, offline support), create a `.env` file — see [`docs/DOCKER.md`](./docs/DOCKER.md) for full details.

**Preconfigure CalDAV accounts:** Visit `/setup` in any running Calino instance to generate a config file with encrypted credentials. Place it in the project root and rebuild — users will be prompted for a master password instead of entering server details manually. See [`docs/SELF_HOSTED_CONFIG.md`](./docs/SELF_HOSTED_CONFIG.md) for details.

## No-Docker

Calino is a static React app — host it anywhere that serves HTML/JS.

1. Build: `pnpm build`
2. Serve the `dist/` folder (make sure SPA fallback is configured — see below)

Most user data, including CalDAV account metadata and credentials, lives in the browser's `localStorage`; large raw ICS documents, attachments, and contact photos use IndexedDB. There is no backend or central Calino application server.

**Config (in-app):** Click the gear icon or use `Cmd/Ctrl+K` → "Settings" → add your CalDAV server URL, username, and password.

**Site URL (for SEO / Open Graph cards):**

```bash
cp .env.example .env.local
# Edit .env.local and set VITE_SITE_URL=https://your-domain.com
pnpm build
```

`VITE_SITE_URL` is baked into `index.html` at build time and used for the canonical link, Open Graph / Twitter cards, and the JSON-LD structured-data block.

### Online Deployment

Calino is a Vite SPA. Any static host works as long as it rewrites all unknown paths to `/index.html` (so client-side routes like `/week` and `/day` resolve on refresh).

**GitHub Pages** — the repository workflow deploys the project site for the
upstream repository. For a fork, update the workflow's `VITE_SITE_URL` and
the Vite `base` path if you are deploying under a project subpath, enable
Settings → Pages → Source: **GitHub Actions**, then push to `main`. A custom
domain or a host that serves the app at `/` does not need a subpath base.

**Caddy** (example):
```caddy
yourcaldav.server.com {
    @cors method OPTIONS

    handle @cors {
        header {
            Access-Control-Allow-Origin "*" # or your selfhosted Calino instance URL
            Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE"
            Access-Control-Allow-Headers "Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match"
            Access-Control-Expose-Headers "ETag"
        }
        respond "" 204
    }

    header {
        Access-Control-Allow-Origin "*"
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE"
        Access-Control-Allow-Headers "Authorization, Content-Type, Depth, Prefer, If-None-Match, If-Match"
        Access-Control-Expose-Headers "ETag"
        -Server
    }

    reverse_proxy 192.168.1.1:89 # your caldav server IP and port
}
```

> **Tip:** Replace `*` with your Calino origin in production (e.g. `https://calendar.example.com`) to avoid letting arbitrary sites read your calendar.

**Service Worker / Offline Mode:** The service worker is disabled by default. To enable offline support, build with `CALINO_ENABLE_SW=true` and make sure the final host serves `/sw.js` with `Service-Worker-Allowed: /`. The service worker caches the app shell; CalDAV synchronization still needs network access. See [`docs/DOCKER.md`](./docs/DOCKER.md) for Docker setup.

### Supported CalDAV Servers
- Baikal
- Nextcloud Calendar
- Radicale
- Any RFC 4791 compliant server

### CORS Headers

If adding headers to your CalDAV server:

```
Access-Control-Allow-Origin: <your-calino-origin>
Access-Control-Allow-Headers: Authorization, Content-Type, Depth, If-Match, If-None-Match
Access-Control-Allow-Methods: GET, PUT, POST, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE
Access-Control-Expose-Headers: ETag, DAV, Allow
```

> **Tip:** If something isn't working, don't guess at which header is missing — open **Settings → Sync**, pick your account and press **Diagnose**. Calino probes the server check by check and tells you what to change. Note that browsers hide a server's `Access-Control-Allow-*` headers from JavaScript, so some verdicts are marked "inferred": they're deduced from how the server behaved rather than read off the wire. Exposing `DAV` and `Allow` (above) lets Calino read those two directly.

> **Note:** `MKCOL`, `COPY`, and `MOVE` are required for settings sync (creating/moving the Calino settings collection). Omitting them still lets calendars load, but settings sync will fail.

> **Note:** `Access-Control-Expose-Headers: ETag` is optional but worth setting. Without it the browser hides the `ETag` your server returns on every write, and Calino has to spend an extra PROPFIND per write to recover it.

### Self-Hosting a CORS Proxy

If you can't add CORS headers to your CalDAV server, run a tiny proxy yourself. The easiest option is the bundled Docker proxy — enable it alongside Calino with a compose profile:

```bash
docker compose --profile proxy up -d
```

Then set the **Proxy URL** in Calino settings to `http://<your-host>:8081`. It's a separate, zero-dependency container ([`proxy/`](./proxy)) that you can also run standalone or as a Cloudflare Worker. See [`docs/CORS_PROXY.md`](./docs/CORS_PROXY.md) for all options.

For an internet-facing proxy, do not leave the defaults open: set both
`CALINO_PROXY_ALLOWED_ORIGINS` and `CALINO_PROXY_ALLOWED_TARGETS` to your
Calino origin and CalDAV host(s). Put the proxy behind HTTPS as well. These
restrictions reduce open-relay and SSRF risk; see [`docs/CORS_PROXY.md`](./docs/CORS_PROXY.md).

# Screenshots

## Mobile month and task view

<img width="357" height="774" alt="image" src="https://github.com/user-attachments/assets/609e3443-ac80-4116-94d5-fe13b97a0673" />
<img width="357" height="774" alt="image" src="https://github.com/user-attachments/assets/3e1d565a-a066-4452-a389-3cb847953b3e" />

## Desktop tasks and journal (the journal has markdown support!)

<img width="1224" height="925" alt="image" src="https://github.com/user-attachments/assets/cdd8cb01-8a5e-4a7b-b83f-dfdec8158512" />
<img width="1221" height="925" alt="image" src="https://github.com/user-attachments/assets/4037bd13-755c-4e2a-a4a3-57544afb60c9" />

## Quickly create events through Natural Language Processing in the Command Palette (no AI)

<img width="640" height="244" alt="image" src="https://github.com/user-attachments/assets/7e6623f7-5f12-4b44-a74b-8cce3fb1bf94" />


## Tech Stack

React 19 + TypeScript + Vite, Zustand v5, tsdav (CalDAV), CardDAV, date-fns,
chrono-node, @dnd-kit, framer-motion, Fuse.js, ical.js, Vitest, and Playwright.

---

Calino is actively developed and tested against real calendar workflows. Issues
may still arise; bug reports are very welcome.

## License

MIT
