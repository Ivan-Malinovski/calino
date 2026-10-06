# JSCalendar → iCalendar read converter

`src/features/jmap/convert/jscalendarToIcs.ts` exports:

```ts
jscalendarToIcs(event: JSCalendarObject, opts?: {
  prodId?: string
  calendarName?: string
}): string
```

This is the read boundary described in [JMAP.md](../JMAP.md). It produces a
VCALENDAR with one master component and detached components for modified
recurrences. It does not change Calino's iCalendar-shaped stores or adapter.
Types come from `src/features/jmap/types.ts`; unknown input properties are ignored.

## Mapping

| JSCalendar input | iCalendar output | Decisions |
| --- | --- | --- |
| `uid` | `UID` | Required; missing UID throws rather than inventing an unstable identity. |
| `title`, `description` | `SUMMARY`, `DESCRIPTION` | RFC 5545 TEXT escaping. HTML is retained literally as plain description text. |
| `start`, `timeZone` | `DTSTART` | Null/absent zone is floating; UTC and Etc/UTC use Z; other supported IANA zones use TZID. |
| `duration` | `DTEND` | Add nominal weeks/days first, then elapsed hours/minutes/seconds in the start zone. Default duration is zero; a zero-length timed event uses DURATION:PT0S because DTEND must be later than DTSTART. |
| `showWithoutTime` | `DTSTART;VALUE=DATE`, `DTEND;VALUE=DATE` | Ignore the time portion; exclusive end. Zero duration becomes one day; partial days round up. |
| `endTimeZone`, `locations[*].rel/relativeTo = end` with `timeZone` | DTEND TZID | Compute the end instant in the start zone, then express it in the end zone. Explicit endTimeZone wins. |
| `locations[*].name` | `LOCATION` | Join names in stable location-ID order with comma-space. |
| `locations[*].coordinates` | `GEO` | Read geo URI latitude/longitude; keep the first coordinates because GEO is singular. Altitude/uncertainty are not represented. |
| `virtualLocations[*].uri/href` | `URL`, `CONFERENCE;VALUE=URI` | One URL and one CONFERENCE per virtual location, with optional LABEL. |
| `keywords` | `CATEGORIES` | True-valued map keys, separately TEXT escaped. |
| `categories` | `CONCEPT` | True-valued URI map keys; never TEXT escape a URI's commas/semicolons (RFC 9253). |
| `priority` | `PRIORITY` | Numeric value. |
| `freeBusyStatus` | `TRANSP` | Free → TRANSPARENT; busy → OPAQUE. |
| `privacy` | `CLASS` | Public/private preserved; secret → CONFIDENTIAL. Also accept confidential. |
| `status` | `STATUS` | CONFIRMED, TENTATIVE, CANCELLED. |
| `sequence` | `SEQUENCE` | Numeric value. |
| `created` | `CREATED` | UTC. |
| `updated` | `LAST-MODIFIED`, `DTSTAMP` | Stalwart's updated mirrors DTSTAMP. Fallback DTSTAMP is created, then the Unix epoch for deterministic output. |
| `color` | `COLOR` | TEXT. |
| `recurrenceRule`, `recurrenceRules[]` | `RRULE` | Prefer the singular spelling if both exist. Array spelling can emit multiple RRULEs. |
| `frequency`, `interval`, `count`, `until` | FREQ, INTERVAL, COUNT, UNTIL | Local UNTIL is converted to UTC for zoned DTSTART, DATE for all-day DTSTART, local date-time for floating DTSTART. COUNT takes precedence if both bounds are supplied. |
| `byDay[*].day/nthOfPeriod` | BYDAY | Includes positive/negative ordinals such as 2TU and -1FR. |
| `byMonthDay`, `byMonth`, `bySetPosition` | BYMONTHDAY, BYMONTH, BYSETPOS | Gregorian months accept numeric or string values. |
| `byYearDay`, `byWeekNo`, `byHour`, `byMinute`, `bySecond`, `firstDayOfWeek` | BYYEARDAY, BYWEEKNO, BYHOUR, BYMINUTE, BYSECOND, WKST | Explicit weekday start preserved. |
| `excludedRecurrenceRules[]` | `EXDATE` or `EXRULE` | Enumerate finite rules up to 100,000 occurrences; retain deprecated EXRULE when enumeration is unbounded or exceeds that limit. |
| `recurrenceOverrides[id].excluded = true` | `EXDATE` | The ID uses the master's original date/zone form. |
| Other `recurrenceOverrides[id]` | `RDATE`, detached component with `RECURRENCE-ID` | RDATE if ID is outside the positive rule set; detach only if a non-exclusion patch changes the occurrence. Empty patches only add RDATEs. |
| `organizerCalendarAddress`, `replyTo.imip/other`, owner participant | `ORGANIZER` | Explicit address first, then RFC replyTo, then the first owner with an address. Match participant name for CN. |
| Participant `calendarAddress`, `sendTo.imip/other`, `email` | `ATTENDEE` | Prefer the newer address, then RFC scheduling URI, then mailto email. Owner-only participants are organizers; owners with attendee roles are also attendees. |
| Participant `name`, `roles`, `participationStatus`, `expectReply`, `kind` | CN, ROLE, PARTSTAT, RSVP, CUTYPE | Chair/optional/informational/required roles; location → ROOM. Both attendee and informational resolves to attendee. |
| Participant `delegatedTo`, `delegatedFrom`, `scheduleSequence` | DELEGATED-TO, DELEGATED-FROM, SCHEDULE-SEQUENCE | Resolve participant IDs to calendar addresses; ignore dangling references. |
| `alerts[*].trigger` OffsetTrigger | `VALARM`, `TRIGGER;RELATED=START/END` | Signed duration; default START. |
| `alerts[*].trigger` AbsoluteTrigger | `TRIGGER;VALUE=DATE-TIME` | UTC `when`. |
| Alert `action`, `title`, `description`, `acknowledged` | ACTION, SUMMARY, DESCRIPTION, ACKNOWLEDGED | DISPLAY/EMAIL; unsupported actions skipped. Explicit alert text wins, then event text. SUMMARY is emitted for EMAIL or an explicit alert title. |
| `links[*]`, `rel = enclosure` | `ATTACH` | URI plus FMTTYPE; data URIs become VALUE=BINARY, ENCODING=BASE64, FMTTYPE. Base64 and percent-encoded binary payloads supported. |
| Other link with absent rel or alternate/describedby/self | `URL` | First eligible URL only; virtual locations have priority. Other link relations ignored. |
| `relatedTo[uid].relation` | `RELATED-TO;RELTYPE` | One property per true relation; unspecified relation emits RELATED-TO without RELTYPE. |
| `@type = Task` | `VTODO` | Optional DTSTART; no Event DTEND. |
| Task `due`, `estimatedDuration`, `percentComplete`, `progress`, `progressUpdated` | DUE, ESTIMATED-DURATION, PERCENT-COMPLETE, STATUS, COMPLETED | Failed maps to CANCELLED; progressUpdated emits COMPLETED only for completed tasks. |
| Options `prodId`, `calendarName` | PRODID, X-WR-CALNAME | Defaults to Calino's stable product identifier. |

## Serialization and recurrence decisions

Properties have a fixed order; map entries and overrides are ordered by their
keys. The output ends with CRLF and folds physical lines at 75 UTF-8 octets,
including the continuation space, without splitting a Unicode code point.
Parameter values use RFC 6868 escaping and RFC 5545 quoting. URI values retain
their syntax; CR/LF are percent encoded to prevent content-line injection.

Each occurrence starts as a deep copy of the master, with its start set to the
override key, before its PatchObject is applied. Slash-separated paths decode
`~1` and `~0`; null deletes, objects/arrays replace rather than merge. Missing
parents, array traversal, invalid escapes and overlapping paths reject the
whole patch. Literal keys such as `__proto__` do not mutate object prototypes.
The input is never mutated. Detached instances inherit UID and the master's
RECURRENCE-ID representation; they do not inherit RRULE, RDATE or EXDATE.

Timezone arithmetic uses the existing timezone registry to validate IANA zones
and date-fns-tz/Intl for instant conversion. In a daylight-saving fold, a local
time identifies its first occurrence; in a gap it uses the offset before the
gap, as specified by [RFC 8984 §1.4.5–6](https://www.rfc-editor.org/rfc/rfc8984.html#section-1.4.5).
Fractional seconds are truncated because RFC 5545 date-times have second precision.

No VTIMEZONE blocks are emitted. Calino's `parseICALDataAsyncWithStatus` loads
referenced TZIDs from the existing @touch4it/ical-timezones registry. An offline
test removes a zone after conversion and verifies that the async parser reloads
it, preserves its wall time/TZID, and resolves the correct UTC instant. A caller
exporting to another application may need to add VTIMEZONE definitions through
the existing `ICAL.helpers.updateTimezones`/registry path.

## Verification and fixture provenance

`__tests__/fixtures/paired-events.json` and its 17 `.ics` companions are
**hand-authored paired fixtures**, not server captures. They cover weekly COUNT,
ordinal monthly and yearly recurrence, UTC/zoned/floating/DATE UNTIL, UTC,
floating, Europe/Copenhagen and America/New_York events, all-day end dates,
exclusions, additional dates, moved and renamed detached events with changed
alarms, start/end/absolute alarms, participant scheduling fields, locations/GEO,
categories/CONCEPT, URI/inline attachments, metadata and escaped Unicode text.
Each pair is checked semantically and parsed by Calino. Further tests exercise
75-octet folding, DST gaps/folds, end zones, PatchObject errors, Task fields and
the remaining RRULE selectors. Vitest runs the tests in both configured zones.

The live test is gated by `CALINO_TEST_JMAP_URL`, `CALINO_TEST_JMAP_USER`, and
`CALINO_TEST_JMAP_PASS`; it has no embedded credentials. With these in the
environment, run:

```sh
pnpm vitest --run --project west src/features/jmap/convert/__tests__/jscalendarToIcs.test.ts
```

It PUTs fixtures into the local Stalwart CalDAV home, verifies calendar-query
REPORT results, reads CalendarEvent/get over JMAP, converts that actual response,
and compares it with both the original fixture and CalDAV GET. Test resources
have distinct project/process UIDs and use If-None-Match to avoid replacing
existing objects; only successfully created resources are deleted. Captured
responses and server ICS are saved as `stalwart-<name>-<project>.json/.ics` under
the fixture directory and automatically replayed offline on subsequent runs.

Live comparison against Stalwart 0.16.25 passes for all 17 fixtures, in both
time zones (verified by the lead, outside the Codex sandbox). The captures it
saved are committed as `stalwart-*.json/.ics` and replayed offline. The live
test collects every failing fixture instead of stopping at the first. The
comparison deliberately ignores differences that JMAP itself cannot carry:

- VALARM `DESCRIPTION`, `SUMMARY` and `ATTENDEE`. Stalwart's JMAP alerts have no
  text or recipients, so the converter supplies what RFC 5545 requires (the
  event title, the attendee).
- Per-attendee `SCHEDULE-SEQUENCE`, which Stalwart drops.
- `DELEGATED-TO` / `DELEGATED-FROM` are carried (Stalwart sends the calendar
  address as a string; RFC 8984 keys a map by participant id; both are read).

Things the live run showed that the fixtures could not:

- Stalwart's session advertises `https://localhost/...` URLs when its hostname is
  `localhost`, even on a plain-HTTP dev server. Clients must not trust
  `apiUrl` blindly (see `docs/jmap/transport.md` once it lands).
- An inline base64 `ATTACH` becomes a link whose `href` is the *decoded* bytes
  (not a URI). Inline attachments therefore do not survive a JMAP round trip.
- CONCEPT is URI-valued (RFC 9253), so commas are not escaped; Stalwart's CalDAV
  output escapes them as if it were TEXT. Fixtures use comma-free concepts.

## Known gaps

- Custom JSCalendar `timeZones`, non-Gregorian recurrence scales and leap-month
  BYMONTH values are unsupported. Unknown/unpackaged TZIDs and unsupported
  recurrence scales throw instead of silently producing a wrong instant.
- Positive recurrence membership is bounded at 100,000 generated occurrences
  per rule. A distant override on a dense subdaily series throws when exceeding
  that bound. Exclusion rules above the same bound retain EXRULE; Calino's UI
  does not model EXRULE, and other clients may not honor it.
- Multiple physical locations collapse to one LOCATION and GEO. Descriptions,
  location IDs/types, localization, link display metadata, scheduling methods
  other than their calendar address, custom participant roles and alert snooze
  metadata are not representable in this mapping.
- HTML descriptions remain literal text, not rendered HTML. More than one URL
  collapses to the first. Unknown properties and vendor extensions are ignored.
- EMAIL alarm recipient identity is not supplied by RFC 8984 alerts. The mapper
  uses an optional recipients map, otherwise scheduling participants, otherwise
  organizerCalendarAddress. An event with none of these cannot supply the
  mandatory iCalendar EMAIL ATTENDEE; no account identity is invented.
- Task conversion is offline-tested only. Stalwart 0.16 does not advertise tasks;
  Task progress inference from participants and recurrence based solely on due
  rather than start are not implemented.
- Inline (base64) attachments are not representable over Stalwart's JMAP.
