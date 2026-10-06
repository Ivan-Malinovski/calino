# JMAP support

Calino can sync calendars (and, in phase 2, contacts) over
[JMAP](https://jmap.io/) as well as CalDAV/CardDAV. This document is the design
record: what is implemented, why it is shaped this way, how to test it, and the
known limits. Keep it current as the work lands.

Status of the specs (as of 2026-10): JMAP Core (RFC 8620), JMAP Contacts
(RFC 9610), JSContact (RFC 9553), JMAP Sharing (RFC 9670) and JSCalendar
(RFC 8984) are published. **JMAP Calendars is still an Internet-Draft**, and
JSCalendar is being revised. Servers already ship the draft, so details can
move; code that touches the wire format should tolerate both vocabularies (see
"Wire format notes").

## Goals

- A user types a server URL and credentials. Calino works out whether the
  server speaks JMAP or CalDAV. There is no protocol picker in the normal flow.
- Everything the UI does with a CalDAV account works with a JMAP account:
  calendars (create/rename/recolor/delete), events, recurrence and overrides,
  reminders, attendees/scheduling, free/busy, incremental sync, offline queue,
  settings sync, the headless Android sync entry.
- Existing CalDAV accounts are unaffected (an account without a `protocol`
  field is CalDAV).

## Architecture: translate at the boundary

Calino's whole data path (`iCalendarAdapter`, the raw-ICS store, `icalPatch`,
`SyncEngine`, pending-change queue, tasks, journals) is iCalendar-shaped. Rather
than teach all of it JSCalendar, the JMAP backend **speaks iCalendar upward and
JSCalendar downward**:

```
 useCalDAV / SyncEngine / useSettingsSync / headless
              │   CalendarBackend (iCalendar strings, opaque url + etag)
      ┌───────┴────────┐
 CalDAVClient     JmapCalendarBackend
 (tsdav, WebDAV)    │  JMAP request batching, session, blobs
                    └─ convert/ : JSCalendar <-> iCalendar
```

- `src/features/caldav/client/CalendarBackend.ts` is the interface, extracted
  from the methods the rest of the app actually calls (about ten, plus settings
  sync and free/busy). `CalDAVClient` implements it unchanged.
- `createCalendarBackend(account, credential)` returns the right
  implementation from `account.protocol`.
- JMAP "urls": calendar url = `<origin>/.jmap/<accountId>/<calendarId>/`, event
  url = `<calendar url><eventId>`. They are synthetic but absolute and nested, so
  `resourceIsInCollection` and the existing href bookkeeping keep working.
- etag: JMAP has no etag. It is a hash of the canonical JSON of the event as
  the server returned it. Writes check it by re-reading first (best effort; the
  account-wide `ifInState` is too coarse to use as If-Match).
- Sync: `syncCollection` maps to `CalendarEvent/changes` (state string as the
  sync token). Events that left a calendar are reported as removed from it.
- Updates are sent as JMAP patches (diff of old and new JSCalendar), never a
  full replace, so server-side properties Calino does not model survive.

## Protocol detection

On connect, in order:

1. `GET <origin>/.well-known/jmap` (or the URL as typed, if it already points at
   a session resource) with the user's credentials. A JSON session document
   advertising `urn:ietf:params:jmap:calendars` means JMAP.
2. Otherwise the existing CalDAV discovery runs.

When a server offers both (Stalwart, Cyrus) JMAP wins. Assumption: it is the
richer protocol (push, `/changes`, no WebDAV quirks). An account's protocol is
stored and shown read-only; "Advanced" offers a force-CalDAV override.

## Wire format notes (observed against Stalwart 0.16)

- Session: `/.well-known/jmap` 307-redirects to `/jmap/session`. CORS is
  `Access-Control-Allow-Origin: *`, so direct browser use works.
- Event ids are short server ids, not UIDs; the iCalendar `UID` is `uid`.
- Vocabulary is the newer JSCalendar: `recurrenceRule` (singular object),
  `calendarAddress` (not `sendTo`/`email`), `organizerCalendarAddress`,
  `calendarIds` (map). RFC 8984 style (`recurrenceRules[]`, `sendTo`) must also
  be accepted.
- **Vendor properties are rejected on write** (`invalidProperties`) and X-
  properties from iCalendar are not exposed over JMAP. Unknown iCalendar data
  therefore cannot round-trip through JMAP. This is a protocol/server limit; the
  patch-based update strategy keeps server-side data intact.
- `recurrenceOverrides` keyed by local date-time carry both modified
  occurrences (patch objects) and exclusions (`{"excluded": true}`); the server
  turns them into detached VEVENTs and EXDATEs.
- `updated` mirrors DTSTAMP, not a modification time, so it is not an etag.

## Component docs

- [JSCalendar → iCalendar converter](jmap/jscalendar-to-ical.md)
- Transport and detection: `jmap/transport.md` (when it lands)

## Testing

A local Stalwart is the reference server. `scripts/jmap-dev-server.sh up`
starts it; see [JMAP_TESTING.md](JMAP_TESTING.md).

## Phases

1. `CalendarBackend` extraction (no behaviour change) and call-site migration.
2. JSCalendar <-> iCalendar converters, unit tested and checked against
   Stalwart's own conversion (create over CalDAV, read over JMAP, compare).
3. JMAP transport, session, detection, calendars/events/sync backend.
4. UI: auto-detection in the add-account flow, protocol badge, errors, i18n.
5. Settings sync, free/busy, scheduling identities, push (EventSource) to
   trigger syncs.
6. Contacts over JMAP (RFC 9610 + JSContact) behind a `ContactsBackend`.
7. E2E (Playwright) against the Stalwart container; release notes.

## Known limits

- Tasks and journals: only available if the server advertises a JMAP tasks
  capability. Stalwart 0.16 does not, so JMAP calendars are VEVENT-only there.
- Unknown iCalendar/X- properties do not round-trip (see above).
- No offline-safe conditional writes; a concurrent edit between the etag check
  and the write window can overwrite.
