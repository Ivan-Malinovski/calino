# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two equally central audiences, neither privileged over the other:

- **Self-hosting privacy enthusiasts** — technical users who already run their own CalDAV server (Radicale, Baïkal, Nextcloud, or any RFC 4791-compliant server) and want a fast, modern, non-bloated client. Many also self-host Calino itself (Docker, static hosting) to keep everything off third-party infrastructure.
- **Hosted-instance users** — people who just want a better CalDAV client and use calino.io directly against an existing CalDAV account (iCloud, Fastmail, Nextcloud, etc.) without self-hosting Calino.

Both are calendar power users dissatisfied with bloated enterprise suites (Google Calendar, Outlook, full groupware) who want a calendar that respects their existing CalDAV data and their taste for a clean, fast interface.

## Product Purpose

Calino is a lightweight, browser-based CalDAV calendar client. It connects directly to the user's own CalDAV (and CardDAV) server — no Calino account, no intermediary backend, no data lock-in. All user data, including credentials, lives in the browser's `localStorage`; there is no central Calino server for user data. Success means a calendar client people choose over the bloated suite they were using before, that "just works" with sensible automatic defaults and stays fast.

## Positioning

A CalDAV client built to the maintainer's own taste for what a non-enterprise calendar should be, then shared with the world — not a committee-designed enterprise product. Its differentiator is the combination competitors rarely offer together: modern, beautiful UI; a static, backend-less architecture (data never touches a Calino-run server); full VTODO + rare VJOURNAL support; CardDAV contacts; and natural-language event creation (chrono-node NLP by default, optional BYOK LLM on Android for image-to-event). Sensible, automatic defaults that adapt to the user's browser and calendar, rather than requiring manual customization, are a deliberate design philosophy, not an accident.

## Operating Context

- **Deployment shapes**: hosted at calino.io (try-it-now, zero install), self-hosted via Docker (`ghcr.io/ivan-malinovski/calino`) or any static host serving the Vite SPA build, and installable as a PWA.
- **Android app**: a Capacitor-wrapped build of the same web app (see [Platform](#platform)) distributed as an APK via GitHub Releases. Adds native notifications, haptics, and an optional camera-to-event flow (photograph a poster/screenshot/slide, extract an event via BYOK LLM).
- **CORS dependency**: because Calino runs entirely in-browser, it needs its CalDAV server to support CORS, or a CORS proxy (self-hosted proxy strongly preferred; a convenience-only hosted proxy exists at proxy.calino.io).
- **Supported CalDAV servers**: Baikal, Nextcloud Calendar, Radicale, and any RFC 4791-compliant server. CardDAV contacts auto-detected when address books are present.
- **No backend/account system**: settings and credentials persist client-side; an opt-in "settings sync" feature syncs preferences across devices via a dedicated hidden calendar on the user's own CalDAV server — still no Calino-run backend.

## Capabilities and Constraints

- Views: Month, Week, 3-day, Day, Agenda, Year; drag-to-move and drag-to-resize events; vertical split view for tall windows.
- Smart Input: natural-language event creation via chrono-node (no AI required); command palette (Cmd/Ctrl+K) for navigation, creation, sync, search, settings.
- VTODO (tasks) and VJOURNAL (journal entries, with Markdown support) alongside VEVENT.
- CardDAV contacts, auto-enabled when address books are detected.
- Categories synced via iCalendar CATEGORIES (RFC 5545), with keyword-based auto-categorization.
- Full-text fuzzy search (Fuse.js) across event fields.
- Desktop notifications with customizable reminders; sync retry for failed CalDAV operations.
- Theming: light/dark/system, plus custom themes added at build time by dropping a CSS file into `public/themes/` (not runtime-configurable).
- Optimized, gesture-driven mobile view (swipe between months/weeks/days).
- Constraint: offline/service-worker support requires self-hosting with the right headers — GitHub Pages strips `Service-Worker-Allowed`, so the hosted calino.io experience is online-only by default.
- Constraint: LLM-based image-to-event is opt-in, BYOK (bring your own key), and Android-only — not a dependency for the core product experience.
- No accessibility standard formally established yet ([see below](#accessibility--inclusion)).

## Brand Commitments

- Name: **Calino**. Tagline: "A lightweight CalDAV calendar for the web."
- Existing identity assets: `public/calino-icon.svg`, `public/icon-192.svg`, `public/apple-touch-icon.png`, `public/favicon-96x96.png`, `public/og-image.png`, `public/web-app-manifest-{192,512}x192.png`.
- MIT licensed, single maintainer (Ivan Malinovski). Positioned explicitly against "bloated" enterprise calendar suites — this contrast is a stated part of the product's voice, not just a technical fact.

## Evidence on Hand

- README screenshots: mobile month/task view, desktop tasks + journal (Markdown), command-palette NLP event creation — real product screenshots, not mockups, at the paths linked in `README.md`.
- Live product at calino.io and hosted proxy at proxy.calino.io.
- No testimonials, press, case studies, or usage metrics exist yet — do not fabricate any.

## Product Principles

1. **Direct-to-server, no lock-in.** User data goes only between the browser and the user's own CalDAV server; never invent flows that imply a Calino-run backend or account system.
2. **Sensible automatic defaults over manual configuration.** The product should adapt to the user's browser/calendar rather than asking them to tune it — design decisions should default to "just works," with customization available but not required.
3. **Respect the self-hoster and the drive-by user equally.** Neither the technical self-hoster nor the calino.io visitor is a secondary audience; flows should work for someone who just typed the URL and for someone who read the CORS docs.
4. **Rare CalDAV features matter here.** VJOURNAL, full-text search, CardDAV, and category sync are differentiators, not afterthoughts — give them real design attention rather than bolting them onto an events-first UI.
5. **Opinionated, not enterprise-neutral.** The product has a maintainer's point of view on what a calendar should be; it is allowed to have a stance rather than design for every possible workflow.

## Accessibility & Inclusion

No accessibility standard has been formally established. Do not invent a compliance target (e.g. WCAG level) on the product's behalf; treat this as an open decision rather than a confirmed requirement.
