# iCalendar → JSCalendar write boundary

`icsToJscalendar(ics, options)` parses a VCALENDAR with ical.js 2 and returns
`{ uid, event }`. The resource must contain one master VEVENT or VTODO; detached
components must have its UID and component type. The rest of Calino continues
to use iCalendar. `diffJscalendar` and `applyJmapPatch` are exported from the
same module; their implementation is in `jscalendarDiff.ts`.

The default vocabulary targets the draft shape recorded in [../JMAP.md](../JMAP.md).
The alternate `rfc8984` vocabulary selects the older scheduling and recurrence
property names. This is a focused compatibility switch, not a general
JSCalendar 2.0 implementation. References:
[RFC 8984](https://www.rfc-editor.org/rfc/rfc8984.html),
[JSCalendar bis](https://datatracker.ietf.org/doc/html/draft-ietf-calext-jscalendarbis).

## Mapping implemented

| iCalendar input                                          | JSON output / implementation decision                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| VEVENT / VTODO, UID                                      | `@type: Event` / `Task`, `uid`; no invented identifier                                                                                     |
| SUMMARY, DESCRIPTION                                     | `title`, `description`, plain text content type; ical.js unfolds and unescapes text                                                        |
| LOCATION, GEO                                            | Ordered `locations` entries with `@type: Location`, `name`, `coordinates: geo:lat,lon`; GEO without LOCATION gets an unnamed entry         |
| URL                                                      | `links.url`, typed Link with `rel: describedby`; a URL does not by itself identify a conference, so no virtual location is invented        |
| CATEGORIES, CONCEPT                                      | `keywords`, `categories` Boolean maps, respectively                                                                                        |
| DTSTART                                                  | Local date-time `start`, `timeZone`; UTC uses `UTC`, floating uses explicit null                                                           |
| DATE DTSTART                                             | Midnight `start`, `showWithoutTime: true`; timezone null                                                                                   |
| DTEND                                                    | Exclusive end → duration; date spans use `PnD`; timed spans use exact elapsed hours/minutes/seconds                                        |
| DURATION                                                 | Preserved for timed events; date durations normalize weeks to days                                                                         |
| Missing end/duration                                     | One day for DATE; zero seconds for DATE-TIME                                                                                               |
| RRULE                                                    | Typed RecurrenceRule with frequency, interval, count, week start, ordinal NDay values and every standard BY part; month values are strings |
| UNTIL                                                    | Local date-time in the master's clock; DATE becomes midnight; UTC UNTIL converts through the master's zone at the UNTIL instant            |
| EXDATE                                                   | `recurrenceOverrides[local-id] = { excluded: true }`                                                                                       |
| RDATE                                                    | Empty override adds an occurrence; PERIOD adds a duration override                                                                         |
| Detached component                                       | A PatchObject relative to the master occurrence at the recurrence id, rather than relative to the series' initial start                    |
| Cancelled detached component                             | Exclusion; EXDATE has precedence over RDATE and detached changes                                                                           |
| TRANSP, CLASS, STATUS                                    | `freeBusyStatus`, `privacy` (CONFIDENTIAL → secret), event `status`                                                                        |
| PRIORITY, SEQUENCE, COLOR                                | `priority`, `sequence`, `color`                                                                                                            |
| CREATED, DTSTAMP/LAST-MODIFIED                           | UTC audit stamps; DTSTAMP wins for `updated`                                                                                               |
| ORGANIZER                                                | Draft `organizerCalendarAddress`; RFC `replyTo.imip`; participant owner role                                                               |
| ATTENDEE                                                 | Typed Participant with CN, ROLE, PARTSTAT, RSVP, CUTYPE and delegation; organizer/attendee for one address merge                           |
| Draft scheduling                                         | `calendarAddress`; required/optional/chair/informational roles; delegation maps keyed by calendar addresses                                |
| RFC scheduling                                           | `sendTo.imip`, mailto `email`, attendee roles; delegation maps keyed by participant ids                                                    |
| VALARM DISPLAY/EMAIL                                     | Typed Alert and OffsetTrigger/AbsoluteTrigger; RELATED chooses start/end; ACKNOWLEDGED parsed even when ical.js treats it as unknown text  |
| Alarm UID                                                | Alerts map id (not an unsupported `uid` member); directly retained if a valid JSCalendar id, otherwise deterministic hash                  |
| ATTACH                                                   | Typed enclosure Link; URI retained, inline binary becomes a MIME-typed base64 data URI                                                     |
| RELATED-TO                                               | Typed Relation maps by UID, with lowercased relation type; repeated relations combine                                                      |
| VTODO DUE, PERCENT-COMPLETE, STATUS, DURATION, COMPLETED | `due`, `percentComplete`, `progress`, `estimatedDuration`, `progressUpdated`; tasks are not sent to Stalwart CalendarEvent                 |
| Unknown / X- properties, EXRULE                          | Dropped                                                                                                                                    |

All nested typed objects explicitly include `@type`. Generated participants
use address hashes; locations/attachments and UID-less alarms use ordered
indices. Alarm UID keys survive edits to alarm timing. Hash collisions within
participant/alarm maps get deterministic suffixes. String-keyed category and
relation maps handle special JavaScript property names safely.

## Timezone decisions

Recognized IANA names are retained, including aliases recognized by Intl.
VTIMEZONE `X-LIC-LOCATION` takes precedence when it identifies an IANA zone.
Common Windows names map to representative IANA zones (for example Eastern
Standard Time → America/New_York, Romance Standard Time → Europe/Paris).
Prefixed IANA identifiers are recognized by their geographic suffix.

An unknown name with embedded VTIMEZONE offset data is converted to UTC using
ical.js's zone transitions. No unsupported custom timezone object is emitted.
This preserves explicit occurrence instants but can alter recurring wall-clock
behavior across DST; full custom timezone recurrence fidelity remains a gap.
An unknown TZID with no usable offset data throws instead of inventing a zone.
Duration calculations never depend on the host timezone. Intl supplies offsets
for IANA zones even when the input omits VTIMEZONE.

Timed DTEND is encoded as elapsed duration, including across DST. Differing
DTEND zones preserve the end instant but not the original end timezone label.
An explicit DURATION retains its nominal day/week semantics.

## Patch behavior

Maps recurse by key; arrays and singular recurrenceRule replace wholesale.
Paths escape `~` as `~0` and `/` as `~1`. Removing a property emits null. New map
entries are whole objects, so their patch paths do not need a missing parent.
Server metadata (`id`, `isOrigin`, `isDraft`, `created`, `updated`) is ignored
at the event root. `calendarIds` changes are writable; creation includes it
only when supplied through options.

JMAP null means deletion, not an assignable JSON null. For nested changes to a
literal null the diff replaces the enclosing object. A root-level literal null
cannot be represented by any JMAP PatchObject: changing UTC to floating emits
`timeZone: null`, which deletes that member, semantically selecting floating
time. Consequently the literal deep-equality round-trip assertion applies to
representable patches with unchanged server metadata; root null transitions
have semantic, rather than literal, equality. This limitation follows from
[JMAP Core PatchObject semantics](https://www.rfc-editor.org/rfc/rfc8620.html#section-5.3).
The apply helper validates parent objects, escape sequences and overlapping
paths, and never mutates its input.

## Verification and remaining gaps

Offline coverage includes 13 ICS fixtures, both host timezones, and real inputs
from `eventToICAL` and `eventsToICAL`. The opt-in live test uses the three
`CALINO_TEST_JMAP_URL`, `CALINO_TEST_JMAP_USER`, `CALINO_TEST_JMAP_PASS` environment
variables. It uploads every fixture via CalDAV, compares CalendarEvent/get,
creates the converter JSON via CalendarEvent/set, reads it via CalDAV REPORT,
and compares semantic projections and independent ical.js occurrence expansion.
It also probes vendor-property rejection. Resources it creates are removed.
It assumes account/calendar id `b`; `CALINO_TEST_JMAP_DAV_HOME` can override the
reference server's default collection.

Set `CALINO_TEST_JMAP_CAPTURE=1` when running live to save actual server replies
beside their ICS inputs as `*.stalwart.json`. Once present these captures become
offline assertions. No credentials enter the captures.

**Live verification (Stalwart 0.16.25, run by the lead outside the Codex sandbox)
passes for all 17 fixtures.** For each fixture the test PUTs the iCalendar over
CalDAV, reads Stalwart's own JSCalendar over JMAP and compares it to our
conversion, then creates our JSCalendar through `CalendarEvent/set`, reads it back
over CalDAV and checks the round trip and recurrence expansion with ical.js.

What the live run taught us (all handled in the converter or normalised in the
test):

- Send no `descriptionContentType` unless there is a description, and never
  `text/plain` explicitly: Stalwart then stores the description as
  `STYLED-DESCRIPTION`, which plain CalDAV clients do not show.
- A detached override whose patch has `duration` but no `start` (an RDATE
  PERIOD) makes Stalwart write a VEVENT with no DTSTART. The converter repeats
  the key as `start` in such patches.
- Stalwart keeps only one delegate per participant, upper-cases relation
  names, drops the `required` role and mangles `data:` link hrefs. These are
  server losses, not converter bugs; the live comparison ignores them.
- ical.js cannot expand `BYYEARDAY` together with `BYMONTH`; the live test skips
  the occurrence check when it cannot expand the original.

Other limits: EXRULE, unsupported alarm actions, repeated alarms (REPEAT/DURATION),
alarm body/email recipient details, extensions, complete custom timezones, and
RANGE=THISANDFUTURE. The latter throws and requires the caller to split the
series. Draft output rejects multiple RRULEs; RFC output preserves the array.
Detached components are treated as complete replacements for the permitted
per-occurrence fields; absent location/description/alarms remove inherited
values. A sparse exception without DTSTART is unsupported except cancellation.
Tasks have basic field mapping only; Stalwart 0.16 has no JMAP task capability.
RFC-only extensions such as timeZones are not generated.
