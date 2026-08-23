# CalDAV Settings Sync

Calino syncs user settings (theme, first day of week, time format, etc.) across devices using a **non-standard CalDAV approach**. This document explains exactly how it works, why it was designed this way, and what to expect.

## Why Not a Standard Approach?

CalDAV is designed for calendar data (VEVENT, VTODO, VJOURNAL). There is no standard way to sync arbitrary JSON settings via CalDAV. Options considered:

| Approach                            | Problem                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Store JSON file via WebDAV PUT      | CalDAV calendar collections reject non-iCalendar files (405 Method Not Allowed on Baikal/SabreDAV) |
| Store in a VEVENT DESCRIPTION field | iCalendar 75-octet line folding breaks long base64 payloads                                        |
| Store in a VTODO                    | Pollutes task lists, confusing users                                                               |
| Create a separate WebDAV collection | Not supported by all CalDAV servers; requires non-standard PROPFIND                                |

**Chosen approach**: A dedicated calendar collection containing a single VEVENT with the settings payload encoded as base64 in the `ATTACH` property.

## How It Works

### Calendar Structure

```
calDAV Server
└── calino-settings/              ← Dedicated calendar collection
    └── calino-settings.ics       ← Single VEVENT file
```

- **Display name**: `Calino Settings`
- **Internal name**: `calino-settings`
- **Components**: VEVENT only (no VTODO)
- **Hidden from UI**: Filtered out of Calino's sidebar unless CalDAV debug mode is enabled

### The Settings VEVENT

A single VEVENT with the literal UID `calino-settings` lives inside the collection:

```ical
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calino//Settings Sync//EN
BEGIN:VEVENT
UID:calino-settings
DTSTAMP:20260609T185530Z
DTSTART:19700101T000000Z
DTEND:19700101T000001Z
SUMMARY:Calino Settings
TRANSP:TRANSPARENT
CLASS:PRIVATE
X-CALINO-VERSION:1
ATTACH;ENCODING=BASE64;FMTTYPE=app/json:<base64-encoded JSON>
END:VEVENT
END:VCALENDAR
```

| Field                                     | Purpose                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `UID`                                     | Fixed literal shared across all Calino instances — ensures exactly one settings event exists |
| `DTSTART`                                 | Unix epoch (1970-01-01) — keeps the event out of every real calendar view                    |
| `TRANSP:TRANSPARENT`                      | Never blocks time in any calendar view                                                       |
| `CLASS:PRIVATE`                           | Hidden in shared calendar contexts                                                           |
| `X-CALINO-VERSION`                        | Schema version for future migration support                                                  |
| `ATTACH;ENCODING=BASE64;FMTTYPE=app/json` | The actual settings payload                                                                  |

### Settings Payload Format

The `ATTACH` field contains base64-encoded JSON:

```json
{
  "version": 1,
  "syncedAt": "2026-06-09T18:55:30.755Z",
  "settings": {
    "timezone": "Europe/Copenhagen",
    "secondaryTimezoneEnabled": false,
    "secondaryTimezone": null,
    "secondaryTimezoneLabel": null,
    "dateFormat": "dd/MM/yyyy",
    "timeFormat": "12h",
    "firstDayOfWeek": 1,
    "defaultDuration": 60,
    "defaultView": "month",
    "showWeekNumbers": true,
    "showWeekNumbersInSidebar": true,
    "eventDensity": "comfortable",
    "defaultReminderMinutes": 15,
    "defaultEventColor": "#4285F4",
    "enableDesktopNotifications": true,
    "enableSoundAlerts": false,
    "compactRecurringEvents": true,
    "compressPastWeeks": true,
    "monthViewEventLimit": 3,
    "themeMode": "auto",
    "lightTheme": "built-in",
    "darkTheme": "built-in-dark",
    "adjustableTheme": {
      "light": {
        "canvas": "#f7f4ee",
        "panel": "#fffdfa",
        "accent": "#b07d4f",
        "accentContrast": "#ffffff",
        "text": "#2c2823",
        "mutedText": "#70695f",
        "border": "#e4ded4",
        "cornerRadius": 10,
        "density": 100,
        "shadowStrength": 70,
        "eventTint": 10
      },
      "dark": {
        "canvas": "#17181b",
        "panel": "#22252a",
        "accent": "#87a7ff",
        "accentContrast": "#16181d",
        "text": "#eef1f5",
        "mutedText": "#a7afba",
        "border": "#3b414b",
        "cornerRadius": 10,
        "density": 100,
        "shadowStrength": 60,
        "eventTint": 18
      }
    },
    "hideCompletedTasksInMonthView": true,
    "useCategoryColors": true,
    "journalEnabled": false,
    "taskCollapseOverrides": {}
  }
}
```

### What's Synced vs. What's Not

**Synced** (UI preferences):

- Timezone, date/time format, first day of week
- Default view, event density, week numbers
- Theme mode, light/dark theme names, and both Adjustable theme profiles
- Notification preferences
- Category colors, completed task visibility

**NOT synced** (local-only):

- CalDAV account credentials
- Sync configuration (enabled, interval, conflict resolution)
- Onboarding state
- Sidebar width/collapsed state
- Debug mode

## Conflict Resolution

Uses `DTSTAMP` from the remote VEVENT vs. `lastSyncedAt` from localStorage.

```
Remote DTSTAMP > lastSyncedAt  →  Remote wins (server was updated since our last pull)
Remote DTSTAMP ≤ lastSyncedAt  →  Local wins (we're up to date or ahead)
```

| Scenario                         | Result                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Change setting on Device A, push | Device A writes the new VEVENT and updates its local-modified timestamp                 |
| Device B syncs                   | Remote DTSTAMP > B's `lastSyncedAt` → B gets A's changes                                |
| Device B changes setting locally | B's local-modified timestamp changes; `lastSyncedAt` still records the last remote pull |
| Device B syncs again             | If no remote change, local wins; if remote changed, remote wins                         |

**Key**: `lastSyncedAt` is updated after a successful **pull**. A successful push updates
`lastModified` instead. The comparison is against the last remote `DTSTAMP`, so a
remote write that happened after the last pull can still win.

## Sync Flow

### Pull (Automatic)

Happens as part of the normal CalDAV calendar sync cycle:

1. Calendar sync completes
2. Check if `primaryAccountId` matches this account
3. Discover settings calendar via PROPFIND
4. Fetch settings VEVENT via REPORT (UID filter)
5. Extract base64 from ATTACH, decode, parse JSON
6. Compare `DTSTAMP` vs `lastSyncedAt`
7. If remote wins → merge settings into Zustand store
8. Update `lastSyncedAt`

### Push (Manual)

User clicks "Push" button in Settings → Sync:

1. Serialize current settings to JSON
2. Base64 encode
3. Fetch existing VEVENT to get current ETag
4. PUT updated VEVENT with `If-Match: <server-etag>`
5. Store new ETag

### Auto-Discovery (On Account Add)

When a CalDAV account is added:

1. After calendars are fetched, check for `Calino Settings` calendar
2. If found and no `primaryAccountId` set → auto-enable sync
3. Pull settings from the discovered calendar
4. Show toast: _"Calino Settings found — sync enabled automatically."_

## ETag Handling

- CalDAV uses ETags for optimistic locking
- Each PUT includes `If-Match: <etag>` to prevent lost updates
- If ETag mismatches (412), the client fetches the latest and retries
- Server's ETag always takes priority over locally stored ETag

## iCalendar Compliance

### Line Folding

iCalendar lines are folded at 75 octets. Continuation lines start with a space or tab:

```ical
ATTACH;ENCODING=BASE64;FMTTYPE=app/json:ewogICJ2ZXJzaW9uIjogMSwK
 ICAic3luY2VkQXQiOiAiMjAyNi0wNi0wOVQxODo1NTozMC43NTVaIiwK
```

Calino unfolds these before extracting the base64 payload.

### URL Resolution

CalDAV servers may return relative hrefs in PROPFIND/REPORT responses (e.g., `/dav.php/calendars/user/calino-settings/`). These are resolved against the real server origin (from `account.serverUrl`), not the page origin.

## Known Limitations

1. **Single settings payload** — No per-category or per-calendar settings sync
2. **No real-time sync** — Settings are only pulled during calendar sync cycles
3. **Manual push** — Users must click "Push" to send changes (no auto-push)
4. **One event per calendar** — The fixed UID ensures exactly one settings event
5. **Server compatibility** — Requires CalDAV servers that support REPORT queries with UID filters (Baikal, Nextcloud, Radicale, etc.)

## localStorage Keys

| Key                                    | Purpose                                                           |
| -------------------------------------- | ----------------------------------------------------------------- |
| `calino.settingsSync.primaryAccountId` | Account ID used for sync (presence = sync active)                 |
| `calino.settingsSync.etag`             | ETag of the last-synced settings VEVENT                           |
| `calino.settingsSync.lastModified`     | Millisecond timestamp of the last successful local settings write |
| `calino.settingsSync.lastSyncedAt`     | ISO timestamp of the last successful pull                         |

## Files

| File                                                   | Purpose                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/lib/settingsSync.ts`                              | Serialization, deserialization, merge, conflict resolution, localStorage helpers |
| `src/hooks/useSettingsSync.ts`                         | React hook: enable/disable/push/pull/discover                                    |
| `src/features/caldav/client/CalDAVClient.ts`           | CalDAV operations: discover, fetch, put, delete settings calendar/VEVENT         |
| `src/features/caldav/hooks/useCalDAV.ts`               | Auto-discovery on account add, settings pull after calendar sync                 |
| `src/features/settings/components/GeneralSettings.tsx` | UI: sync section, account picker, error messages                                 |
