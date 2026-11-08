# Recurring Tasks: Wire Format and Client Interop

How Calino stores repeating tasks on your CalDAV server, and what to expect when
another client reads them.

Written for self-hosters who sync the same task list from more than one app. If
you only ever use Calino, none of this matters — it just works.

## The short version

Calino uses plain [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545)
with **no vendor-specific properties**. A repeating task is an `RRULE` on the
task itself, and each occurrence you complete is recorded as a separate
component sharing the same `UID`. This is the same representation Thunderbird
writes, so the two interoperate cleanly in both directions.

Two-way sync with the Android and iOS task apps needs a different shape — see
[Rolling completion mode](#rolling-completion-mode-opt-in) below. It is off by
default.

## What Calino writes

"Exercise, every Tuesday", with the 10 March occurrence completed:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calino//EN
CALSCALE:GREGORIAN
BEGIN:VTODO
UID:gym-1234
DTSTAMP:20260803T070436Z
SEQUENCE:0
SUMMARY:Exercise
DTSTART;VALUE=DATE:20260303
DUE;VALUE=DATE:20260303
RRULE:FREQ=WEEKLY;BYDAY=TU
STATUS:NEEDS-ACTION
END:VTODO
BEGIN:VTODO
UID:gym-1234
DTSTAMP:20260803T070436Z
SEQUENCE:0
SUMMARY:Exercise
DTSTART;VALUE=DATE:20260310
DUE;VALUE=DATE:20260310
RECURRENCE-ID;VALUE=DATE:20260310
PERCENT-COMPLETE:100
STATUS:COMPLETED
COMPLETED:20260310T180400Z
END:VTODO
END:VCALENDAR
```

Both components live in **one calendar object resource**, as RFC 4791 §4.1
requires of components sharing a `UID`.

Points worth noting:

- **The master is never modified when you tick an occurrence.** Its `RRULE`
  keeps generating the series; only a new completed instance is appended. This
  is what makes the series survive a round trip through another client.
- **`DTSTART` anchors the recurrence** (RFC 5545 §3.6.2 requires one when
  `RRULE` is present). Calino derives it from the due date, which is why a task
  with no due date cannot repeat — there would be nothing to count from.
- **`DUE` always matches `DTSTART`'s value type.** Both are `DATE` here; for a
  timed task both are date-times. A mismatch is invalid, so the two are written
  through the same code path and cannot drift.
- **A component carrying `RECURRENCE-ID` never also carries `RRULE` or
  `EXDATE`** — it describes one instance, not a series.
- **Skipping an occurrence** writes an `EXDATE` on the master. Deleting a single
  completed occurrence removes its component, which restores that date to
  whatever the master says.
- **No `DURATION`**, and no `X-` properties anywhere.

## How other clients handle this

Recurring `VTODO` is the least consistently implemented corner of CalDAV. The
survey below is why Calino chose the representation it did — it is the only one
more than one client agrees on.

| Client | Representation | Interop with Calino |
|---|---|---|
| **Thunderbird** | Master keeps its `RRULE`; completing an instance appends a second `VTODO` with the same `UID`, a `RECURRENCE-ID` and `STATUS:COMPLETED`. The master is never mutated. | **Full.** This is the same model, and the reference Calino was built against. |
| **Nextcloud Tasks** ([PR #3021](https://github.com/nextcloud/tasks/pull/3021), merged 2026-03-08) | Hybrid. Writes a proper `RECURRENCE-ID` exception — but *also* advances the master's `DUE`/`DTSTART` to the next occurrence and decrements `COUNT`, and PUTs the exception as a **separate** calendar object resource. | **Good, with caveats.** See below. |
| **Tasks.org / OpenTasks** (Android, via DAVx⁵) | No `RECURRENCE-ID` at all — just advances the master's `DUE`. | **Partial.** See below. |
| **KDE (libkcal)** | Proprietary `X-KDE-LIBKCAL-DTRECURRENCE` listing completed occurrence timestamps. | **Partial** — the custom property is ignored; the series itself reads fine. |
| **todoman** | Does not support recurring `VTODO` ([#304](https://github.com/pimutils/todoman/issues/304)). | n/a |

Each row reads Calino's default (override) shape. The mobile clients marked
partial, plus Apple Reminders, read the [rolling completion
mode](#rolling-completion-mode-opt-in) instead — the same series, written as
single-`VTODO` resources.

### Nextcloud Tasks

Two behaviours to be aware of, both handled by Calino but visible if you look at
the raw data:

- **It moves the master's anchor.** After completing an occurrence in the
  Nextcloud web UI, the master's `DTSTART` has moved forward and `COUNT` has
  been decremented, so `RECURRENCE-ID`s written earlier no longer name
  occurrences of the current recurrence set. Calino treats the anchor as
  whatever the master currently says and expands from there; orphaned
  completions still show under the **Completed** filter rather than vanishing.
- **It splits the `UID` across two resources**, which RFC 4791 §4.1 does not
  permit. Calino tolerates reading this, and updates such an override in place
  on its own resource rather than folding it into the master's — folding it
  would leave the original behind as a duplicate. Anything Calino creates
  itself is written as a single resource.

### Tasks.org / OpenTasks

These advance the master's `DUE` instead of recording per-occurrence
completions, which is not what RFC 5545 describes
([tasks#3360](https://github.com/tasks/tasks/issues/3360)). A series created in
Calino will still show and can still be completed there, but the two apps
disagree about what "completed" means for a single occurrence, so completion
history will not match. This is a limitation on their side; Calino deliberately
does not imitate it by default, because doing so would break Thunderbird and
Nextcloud compatibility and lose the history permanently.

## Rolling completion mode (opt-in)

> Status: the conversion logic is in place; the per-calendar setting and the
> prompt that offers it are a follow-up. Until then the mode is not reachable
> from the UI.

The default shape above is the only one Thunderbird and Nextcloud agree on, but
it is the one shape the mainstream mobile clients cannot round-trip:

- **DAVx⁵ → OpenTasks / Tasks.org** drops `RECURRENCE-ID` overrides on download
  and uploads only the master
  ([davx5-ose#2357](https://github.com/bitfireAT/davx5-ose/issues/2357)), so
  occurrences ticked off in Calino stay open on the phone — and the next edit
  there overwrites the resource and deletes those overrides from the server.
- **Tasks.org's built-in CalDAV** rejects a resource containing more than one
  `VTODO` and aborts fetching the rest of the calendar
  ([tasks#2270](https://github.com/tasks/tasks/issues/2270),
  [tasks#3360](https://github.com/tasks/tasks/issues/3360)).
- **Apple Reminders** expects a rolling master plus completed copies.

Rolling mode keeps every calendar object resource to a **single `VTODO`**:

1. **The earliest open occurrence.** The master's `DTSTART`/`DUE` advance to the
   next occurrence in the `RRULE` (with `COUNT` decremented for the occurrences
   consumed; `UNTIL` is left alone) and it stays `STATUS:NEEDS-ACTION`. The
   finished occurrence is written as its own resource, under a **new `UID`**, at
   the dates it was due.
2. **A later occurrence, out of order.** The anchor cannot move without losing
   an earlier open occurrence, so that date is appended to the master's
   `EXDATE` and only the completed copy is written.
3. **The last occurrence** (`COUNT` exhausted, or past `UNTIL`). There is
   nothing left to roll to, so the master itself is marked `STATUS:COMPLETED`.

Completing 3 March of "Exercise, every Tuesday" in rolling mode writes these two
resources — no `RECURRENCE-ID` anywhere:

```
BEGIN:VCALENDAR
…
BEGIN:VTODO
UID:gym-1234
DTSTAMP:20260803T070436Z
SEQUENCE:1
SUMMARY:Exercise
DTSTART;VALUE=DATE:20260310
DUE;VALUE=DATE:20260310
RRULE:FREQ=WEEKLY;BYDAY=TU
STATUS:NEEDS-ACTION
END:VTODO
END:VCALENDAR
```

```
BEGIN:VCALENDAR
…
BEGIN:VTODO
UID:7c9e0b3a-…
DTSTAMP:20260803T070436Z
SEQUENCE:0
SUMMARY:Exercise
DUE;VALUE=DATE:20260303
PERCENT-COMPLETE:100
STATUS:COMPLETED
COMPLETED:20260303T180400Z
END:VTODO
END:VCALENDAR
```

Points worth noting:

- **Completion history is kept.** The copy is a real task in Calino's
  **Completed** filter and on its day in the calendar views, so nothing is lost
  the way it is with Tasks.org's bare `DUE` advance. Every client that reads a
  plain finished task — including Thunderbird and Nextcloud — shows it too.
- **`COUNT` counts from `DTSTART`,** so moving the anchor forward without
  decrementing it would extend the series. `UNTIL` names an absolute instant and
  is never rewritten.
- **Slots skipped by the move are consumed.** If the series still carries
  completions from the default mode (overrides), those slots count too, and an
  override covering the occurrence being completed is folded into the copy and
  dropped from the master's resource — otherwise it would keep that resource
  multi-component, which is the whole thing this mode avoids.
- **Un-completing a finished repeat** reopens the copy as an ordinary one-off
  task on its date. The series itself is not rolled back, so nothing is
  resurrected twice.
- **Overrides that live in their own resource** (Nextcloud Tasks' split write)
  are left alone: folding one into the master's resource would duplicate it on
  the server. That single occurrence keeps the override shape.
- **Switching modes on a series that already has overrides.** See below.

### Switching modes on a series that already has overrides

A series completed in the default mode carries `RECURRENCE-ID` overrides in
its resource. Leaving even one there keeps that resource multi-component, which
Tasks.org rejects and DAVx⁵ discards. So the **first** rolling completion of
such a series also clears all of them out, in the same write:

| Override | Becomes |
|---|---|
| The occurrence being completed | Folded into the completed copy. Edits made to it survive. |
| Another one, already completed | A standalone completed task under a new `UID`, at its own dates. |
| Another one, edited but still open | A standalone open task under a new `UID`, with the edit kept. |
| Any of the above dated **after** the rolled anchor | Also added to the master's `EXDATE`, so the series doesn't show it twice. |
| One stored in its **own** resource (Nextcloud Tasks' split write) | Left as-is; it never made the master's resource multi-component. |

Overridden slots before the new anchor count toward the `COUNT` decrement
like any other consumed slot. After that first write the master's resource is
a single `VTODO` with no `RECURRENCE-ID`, and later completions just roll.
Nothing is converted until a series is completed in rolling mode; switching the
mode on rewrites nothing by itself.

## What Calino will not do

Some deliberate restrictions, all because the standard has no good way to
express the alternative:

- **A task with no due date cannot repeat.** No `DTSTART`, no anchor.
- **A subtask cannot repeat, and neither can a task that has subtasks.**
  `RELATED-TO` has no per-occurrence form, so a repeating parent would have to
  either share one set of subtasks across every occurrence or silently fan them
  out. Neither reads back correctly in another client.
- **Per-occurrence reminders** (`VALARM` on a single instance) are not
  supported yet.
- **`RANGE=THISANDFUTURE`** on a `RECURRENCE-ID` is not implemented; such an
  override is treated as applying to its single instance only.

## Implementation notes

The parsing and serialization live in
`src/features/caldav/adapter/icalTypeMapping.ts`, tagged `R2.7` with the
relevant RFC section. Tests mirroring those tags — including round-trip
fixtures for the Thunderbird and Nextcloud shapes described above — are in
`src/features/caldav/adapter/__tests__/iCalendarAdapter.test.ts` and
`src/store/__tests__/taskOccurrences.test.ts`.

Rolling mode is planned by the pure `planRollingTaskCompletion` in
`src/lib/rollingTaskCompletion.ts` (tagged `R2.8`). Tests are in
`src/lib/__tests__/rollingTaskCompletion.test.ts` and, against `.ics` files,
`src/lib/__tests__/rollingTaskCompletion.fixtures.test.ts`. The fixtures are in
`src/lib/__tests__/rolling-fixtures/`: hand-written edge cases, plus captures
from DAVx⁵/OpenTasks, Tasks.org and Apple Reminders.

One thing worth knowing if you are changing this code: an all-day date is
timezone-less (RFC 5545 §3.3.4), but `rrule` evaluates `BYDAY` against its
`dtstart`'s **UTC** fields. Anchoring an all-day series at local midnight makes
"every Tuesday" generate Wednesdays east of UTC. `rruleAnchor` and
`rruleWindow` in `src/lib/occurrenceExpansion.ts` exist to keep the whole
expansion path in one frame; use them rather than parsing dates ad hoc.
