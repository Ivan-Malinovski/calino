# JMAP calendar backend

`src/features/jmap/backend/JmapCalendarBackend.ts` implements `CalendarBackend`.
`createJmapCalendarBackend(serverUrl, credentials, proxyUrl = null)` returns a
connected backend; `new JmapCalendarBackend(...)` plus `connect()` is also
available. Credentials are `CalDAVCredentials`; session discovery, Basic auth,
custom headers, proxies and Stalwart loopback endpoint rebasing are delegated to
`JmapClient`. Every calendar method uses the actual session calendar account id.

The application continues to exchange iCalendar strings. Reads use
`jscalendarToIcs`; writes use `icsToJscalendar` with the newer draft vocabulary
(`recurrenceRule`, `calendarAddress`, `calendarIds`). CalendarEvent writes reject
VTODO rather than submitting Task objects to the event method.

## URLs and concurrency

Calendar URLs are `<origin>/.jmap/<encoded-account-id>/<encoded-calendar-id>/`.
Event URLs append the encoded event id, independently of the iCalendar UID or
requested filename. URL parsing validates account, origin and resource shape.
Returned calendar ids follow the existing DAV convention of using the URL;
Calino's account id remains the caller's responsibility.

Etags are quoted SHA-256 hashes of canonical server JSON: object keys are sorted
recursively, array order is retained, and every server property contributes.
Updates and deletes re-read the resource and throw a status-bearing
`JmapError` with `status: 412`, `code: conflict` on an etag mismatch. Empty etags
allow an unconditional operation. This is best-effort optimistic locking: a
concurrent edit between the read and write can still win or be overwritten.

Updates always submit PatchObjects. `eventData.ts` compares the editor's ICS
against the backend's own read projection before constructing the desired
server object and calling `diffJscalendar`. Unchanged fields retain server
representations, defaults and extensions. Changed participants are matched by
calendar address to preserve server ids and unrepresented participant fields.
Alarm, location and attachment ids are reconciled against individual server
entries so ordinary edits and alarm removals keep their server identity.
Represented fields removed from the ICS are deleted. Server-owned audit fields
are untouched. Editing intrinsically lossy representations (such as joined
multiple locations) cannot recover the original iCalendar data; converters'
limits still apply. Vendor/X-properties are never invented or submitted.

Passing a different target calendar URL to `updateEvent` moves the event with
calendarIds patches and returns its new synthetic href. Its server id and UID
remain stable. Other memberships are retained. Deleting a stale source href
following a move is harmless; deleting one of several memberships removes only
that membership. Calendar destruction requests `onDestroyRemoveEvents: true`.
The existing DAV move orchestration must use this update path for same-account
JMAP moves; create-then-delete orchestration is not an atomic JMAP move.

## Listing and sync

Calendar/get supplies name, color (shared DAV normalization), visibility,
subscription, default flag, sort order and item-write rights. Calendar state is
returned as ctag and syncToken as specified by the backend design. Components
are VEVENT-only unless a tasks capability is advertised; task CRUD itself is
not implemented here.

Event listing pages CalendarEvent/query with `inCalendar` (falling back to the older `inCalendars` list if the server answers `unsupportedFilter`), `after` and `before`,
then fetches full objects. Compact CalDAV UTC range strings and ISO dates are
accepted. `includeAllEvents` omits both time constraints. Query state changes
between pages cause a conflict rather than a partial authoritative listing.
The transport splits gets at server object limits. Returned resources are
accepted by Calino's iCalendar adapter; its existing settings UID filter hides
the settings event.

`syncCollection(url, null)` captures CalendarEvent state before a full listing,
so changes racing with the listing are safely replayed next time. Incremental
sync follows CalendarEvent/changes through every hasMoreChanges page, merges
changes, reads current objects, and filters membership. Missing/destroyed
objects and objects that left the requested calendar become `removed`
tombstones. Account-wide tombstones for unknown resources are harmless to the
existing caller. The returned token is the changes cursor, never a later get
state. Errors (including cannotCalculateChanges) return exactly
`{ changes: [], newSyncToken: null, tokenInvalidated: true }`, triggering the
existing full-resync path.

Calendar and CalendarEvent states are opaque and may differ. Callers should
establish an event cursor with `syncCollection(url, null)` before incremental
sync; using Calendar metadata state as an event cursor can trigger resync.
Calendar state is a metadata hint and is not universally an event-change hint;
UI integration must avoid skipping JMAP event sync solely on an unchanged ctag.

## Settings, scheduling and push

The dedicated calendar is named `Calino Settings`; its one event has UID
`calino-settings`, the same title, private visibility and free transparency.
DESCRIPTION is `Calino settings v1:` followed by the caller's base64 payload.
This survives Stalwart's removal of X-properties. Extraction parses and unfolds
the returned ICS with ical.js, then decodes UTF-8. Settings reads expose the
payload's syncedAt as dtstamp for existing conflict handling: Stalwart's event
updated/DTSTAMP is not a reliable modification timestamp. Without a valid
payload timestamp, dtstamp is empty and the settings consumer handles fallback.
Settings put supports caller-supplied href/etag or discovery; conflicts propagate.

Scheduling is detected from capability flags or ParticipantIdentity/get.
Availability requires `urn:ietf:params:jmap:principals:availability`; otherwise
both free/busy APIs return null (an empty attendee list returns an empty map).
Calendar ownerPrincipalId is preferred; Principal/query resolves email addresses
otherwise. Principal/getAvailability receives id, utcStart, utcEnd and
showDetails false, with principals and availability in `using`. UTC periods map
to existing busy/tentative/unavailable/free types; unavailable recipients or
errors return null. Availability wire behavior is tested against the fake only;
a server advertising this extension still needs live verification.

`watch(onChange)` wraps authenticated JmapClient SSE for Calendar and
CalendarEvent, filters notifications to this account and returns unsubscribe.
`CalendarBackend.watch` is an additive optional callback method; UI callers can
trigger the usual sync. The concrete class additionally passes through the
state-change payload. UI/headless wiring is outside this implementation.

## Verification

The reusable `backend/__tests__/fakeServer.ts` implements wire-level session,
Calendar/get/set, CalendarEvent/get/set/query/changes, identities and principal
availability in memory. Offline tests use the real transport, converters and
adapter in both Vitest timezone projects. They cover every backend method,
pagination, conditional conflicts, minimal patches, unknown data, moves,
multicalendar membership, full/delta sync, invalidation, a listing race, settings
UTF-8/folding, scheduling, availability, push and per-object error mapping.

Run `pnpm vitest --run src/features/jmap/backend`, `pnpm typecheck`, and
`pnpm exec eslint src/features/jmap/backend src/features/caldav/client/CalendarBackend.ts`.
The live lifecycle spec is skipped unless all three CALINO_TEST_JMAP_URL,
CALINO_TEST_JMAP_USER and CALINO_TEST_JMAP_PASS variables are set. It creates
uniquely named calendars, creates/reads/patches a recurring meeting with
attendee and alarm, checks stale-etag errors, syncs creates/updates/moves/deletes,
and attempts every cleanup even following a test failure. Variables are read
via globalThis.process.env for jsdom. No credentials are logged or persisted.
The sandbox has no network, so live execution belongs to the lead. UI behavior
and its required Playwright verification belong to integration work.

## Live verification

`__tests__/live.test.ts` (gated on `CALINO_TEST_JMAP_URL/USER/PASS`) runs a full
lifecycle against Stalwart 0.16.25: create/rename/delete a calendar, create,
patch, sync, move and delete a recurring event with attendees and an alarm. It
passes. The run found that Stalwart filters `CalendarEvent/query` by
`inCalendar: Id` and rejects the older `inCalendars: Id[]` with
`unsupportedFilter`; the backend now uses `inCalendar` and falls back.
