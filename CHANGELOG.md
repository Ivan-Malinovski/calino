# Changelog

All notable changes to Calino will be documented in this file.

## [Unreleased]

## [0.33.0] - 2026-08-30

### Added

- **Quicker event entry** — the event form now offers an editable time picker
  with quarter-hour choices, keyboard navigation, and free-form times. It also
  suggests locations you've used recently while letting you type any new
  location. The picker works when creating an event and when editing one,
  completing the time and location improvements requested in [#132](https://github.com/Ivan-Malinovski/calino/issues/132).

## [0.32.0] - 2026-08-29

### Added

- **Event filters in the command palette** — search all stored events, tasks,
  and journal entries by one or more title/description terms, location,
  exclusions, and inclusive date ranges. Results show their calendar, date,
  location, description, and highlighted matches; recurring series stay as one
  row. The date-range and location controls follow the direction discussed in
  the time/location picker request [#132](https://github.com/Ivan-Malinovski/calino/issues/132).

### Fixed

- **Desktop notification icons no longer 404** — browser reminders now use
  Calino's packaged app icon instead of the missing `/appicon.jpg` asset,
  resolving the notification failure reported in [#131](https://github.com/Ivan-Malinovski/calino/issues/131).

- **Partial CalDAV component fetches no longer make calendars disappear** —
  successful event-like records are retained, while deletion reconciliation
  and cursor advancement wait until all requested components succeed. This
  resolves [#134](https://github.com/Ivan-Malinovski/calino/issues/134). Thanks
  to [@josephsellers](https://github.com/josephsellers) for [#135](https://github.com/Ivan-Malinovski/calino/pull/135).

## [0.31.1] - 2026-08-24

### Changed

- Calendar sync and rendering do less work: day view prepares its layout once
  instead of on every pointer move, and event cards only re-render when their
  own calendar or category changes.

- The app reaches first paint sooner. Contacts sync, reminders, photo import,
  and housekeeping now start after the calendar is on screen rather than
  blocking it.

- Only the selected language's translations are downloaded, and timezone
  definitions are parsed the first time a zone is actually used.

- CalDAV sync skips requests for components a server says it does not support,
  so fewer pointless round trips are made against limited servers.

- Dependencies updated.

### Fixed

- Deeply nested imported task chains no longer overflow the call stack when
  collapse state is derived.

- A server-provided timezone definition is no longer overwritten by the bundled
  copy of that zone.

## [0.31.0] - 2026-08-24

### Added

- **Adjustable themes** let you tune light and dark palettes with live color,
  radius, density, shadow, and event-tint controls. Changes persist locally and
  through settings sync, with contrast warnings for combinations that fall
  below WCAG AA.

- **English, Danish, and German interface languages** can be selected in
  Settings. Natural-language parsing remains English-only.

- **Nested tasks** can be created inline, then expanded or collapsed from the
  task list, agenda, and calendar views. Your disclosure choices persist and
  can follow you through settings sync.

- **Sliding week navigation** lets you move through a seven-day window one day
  at a time while keeping the normal week controls available ([#127](https://github.com/Ivan-Malinovski/calino/issues/127)).

- **Journal entries have a split workspace** for browsing dates and editing the
  selected entry, with layouts adapted for smaller screens.

- **Drag across day cells in month view to create an all-day event** spanning
  the days you swept, instead of clicking one day and editing the end date by
  hand.

- **The command palette treats plain phrases as events.** Typing "lunch" or
  "team offsite friday" offers to create it, while matching existing events
  and calendars still appear below.

- **Fortnightly recurrence phrases** such as "every other day/week/month" or
  "every other monday" are understood by the command palette. This extends the
  recurring-task work tracked in [#96](https://github.com/Ivan-Malinovski/calino/issues/96).

### Changed

- Calendar dates, weekday names, and time displays now follow the selected
  interface language and locale conventions.

- **Multi-day all-day events span the week** as one continuous pill across
  covered days in week view, on desktop and mobile, with overlapping events
  staying aligned.

- Long all-day event titles flow across the days they cover instead of being
  repeated or cut off at each cell boundary. Month view uses the same treatment.

- Calendar, agenda, journal, task, contact, settings, and sync surfaces now
  share the translated interface and locale-aware controls.

- Month, agenda, journal, and mobile calendar layouts have been refined for
  more flexible resizing and navigation.

### Fixed

- Journal entries with a title but no body now sync correctly, and clearing an
  existing entry's body is sent to the server instead of being treated as a
  local-only draft.

- **Journal entries use the local calendar day at UTC boundaries** ([#116](https://github.com/Ivan-Malinovski/calino/issues/116)), so an evening entry west of UTC is no longer filed under tomorrow.

- Agenda, journal, and task dates and labels now follow the selected language,
  including the German and Danish calendar surfaces.

- Agenda task rows remain keyboard-accessible without nesting their completion
  and subtask controls inside another interactive control.

## [0.30.0] - 2026-08-21

### Added

- **The calendar grids are fully keyboard-navigable.** In week and day views, arrow keys move between days and hours, and Enter opens quick-create at the focused slot — matching what month view already did. One Tab lands you in the grid, not one stop per cell. Focused slots announce their date and time to screen readers.

- **A skip-to-content link** is the first thing Tab reaches on every page, jumping straight past the sidebar and header to the calendar.

### Changed

- **WCAG 2.1 AA is now Calino's working accessibility standard,** documented in PRODUCT.md and DESIGN.md. Automated axe-core scans over every main surface (views, settings, event modal, command palette) run in the E2E suite and fail on serious or critical violations.

### Fixed

- **Muted text meets contrast requirements in both themes** — dimmed dates in the mini-calendar and month grid, the current-time label, the settings active-nav item, and several secondary text colors were below the AA ratio and have been adjusted while keeping their visual character.

- **Recurring-event dialogs are announced correctly by screen readers** — they now expose their visible heading as an accessible name.

- **Form controls in the event modal are labelled** — the calendar picker and start/end date fields no longer read as anonymous inputs to assistive technology.

- **Month view day cells no longer nest interactive controls inside a button role**, which screen readers reported as broken structure.

## [0.29.1] - 2026-08-20

### Added

- **A bar at the top of the window says what Calino is waiting on.** Connecting an account, importing a file or saving over a slow link no longer looks like a hang. Quick saves don't flash it up, and timer-driven syncs stay silent.

- **The sidebar says when changes haven't reached the server,** how many are waiting, and offers to send them now. They also go out the moment you're back online.

### Changed

- **Saving an event closes the form straight away** instead of waiting for the server. Failures are still reported. Editing a single occurrence of a repeating event now updates immediately too.

- **Views open without a placeholder on Android** — they're prepared shortly after launch.

- Calino sets up its server connection once for the whole app rather than in around twenty places, most noticeably when turning a phone sideways.

### Fixed

- **Self-hosted servers work over plain HTTP on Android** ([#119](https://github.com/Ivan-Malinovski/calino/issues/119)), including with your own certificate authority. Since `http://` really does send your password unprotected, the account forms now say so.

- **The agenda heading no longer shrinks on the current month,** where the "Today" button drops out and took the bar's height with it.

- An event's title lines up with its edit button, and a long title fades at the edge rather than being cut mid-letter.

## [0.29.0] - 2026-08-19

### Added

- **Drop an .ics file onto Calino to import it.** Drag a calendar file from your file manager anywhere onto the window and Calino shows you what's in it before anything is saved: how many items, what they are, and which calendar they'd go into. Events, tasks and journal entries all come through — the old importer in Settings quietly dropped everything that wasn't a plain event. You can send them to an existing calendar or have a new one made for them on the spot.

  Anything already in the chosen calendar is left alone rather than duplicated, and the review step tells you how many it's going to skip, so re-importing a file you've imported before is safe. Imports into a synced calendar are now pushed to the server as well; previously they only ever existed on the device you imported them on. Settings → Data → Import opens the same review step, so both routes behave identically. Dropping anything that isn't a calendar file does nothing except say so.

- **Export a single event, a whole calendar, or everything.** A **⋯** button next to Cancel at the bottom of the event form offers "Download .ics" for the event you're looking at — a repeating event exports as the series it is, not as the one occurrence you happened to open. Right-click a calendar in the sidebar for "Export Calendar (.ics)" to get everything in it. Settings → Data still exports the lot in one file. Filenames are taken from the event's title, with the characters your file system won't accept swapped out.

- **Attendees on events.** Events now carry attendees and an organizer, and the event form has a section for them: type an email, press Enter. They're written to the server in the standard way, so other calendar apps see them and the people your colleagues invite you alongside show up here — until now Calino discarded that information entirely on both sides.

  Each attendee shows whether they're free at that time. This is worked out from your own calendar alone: an attendee reads **Busy** when another event you can see names that same person at an overlapping time, and **Unknown** — the usual answer — when there's simply nothing to go on. It is a hint, never a block: a clash is pointed out above the list and you can save regardless. Calino does not ask anyone's server about anyone's availability, so nothing about who you're meeting leaves your device.

  The same **⋯** menu will open a message to everyone on the list in your mail program, with the event's details already written out, or copy their addresses to the clipboard if you'd rather paste them somewhere yourself — useful if your system has no mail program set up to be opened.

- **A second time zone down the side of the week and day views.** Settings → Calendar → Secondary Timezone adds a second column of hours next to the usual one, so you can see at a glance what 15:00 here is over there. Pick any zone and give it a short label of your own — "SF", "HQ" — or leave it to name itself. It follows daylight saving in both zones independently, so the offset between the two columns changes on the right dates rather than being frozen at whatever it was when you set it up. Off by default, and synced along with the rest of your settings.

- **An event now says which zone it's anchored in.** An event created in another zone — by a colleague, or by you before you travelled — used to look like any other: a 09:00 Los Angeles meeting simply read 18:00 here, with nothing on screen saying those were different clocks. Cards in the calendar now carry a small zone badge, and opening the event shows its own local times under the date fields ("09:00–09:30 in Los Angeles"), including the day, when it falls on a different date over there.

  The fields themselves still work in your zone — a personal calendar answers "when do I turn up", and a form whose meaning depended on which event you opened would trade one confusion for a worse one. The badge only appears when the zones actually differ. One consequence worth knowing: events you make now carry your own zone, so travelling will make the badge appear on them. That is the badge doing its job — they are anchored where you made them.

### Changed

- **Syncing only fetches what actually changed.** Calino used to re-download every calendar in full on every sync. It now asks each server what has changed since the last time it looked, and fetches just those items; a calendar the server reports as untouched is skipped without a single request. On a large account this is the difference between seconds and a moment. Servers that don't support the standard for this — it's an optional one — fall back to the old full listing automatically, and Calino falls back on its own if a server ever rejects its bookmark, so there is nothing to configure and nothing that can get stuck. Which route each calendar took is written to the browser console, since a sync that correctly did nothing and a sync that silently failed otherwise look identical.

- **Editing an event no longer discards what Calino doesn't understand.** Calino used to rebuild a calendar entry from scratch every time you saved it, which meant anything it has no feature for was destroyed the moment you touched an event another app had written — location coordinates, privacy class, priority, categories another client set, relationships between items, extra attendee details, and every custom field. It now edits the original entry in place: the parts Calino owns are updated, everything else is left exactly as it was, including alarms it didn't change and the identifier of the app that created the entry. If that ever fails it falls back to the old behaviour rather than not saving at all.

### Fixed

- **A repeating event keeps the weekdays you picked** ([#126](https://github.com/Ivan-Malinovski/calino/issues/126), reported by [@donderbolt](https://github.com/donderbolt)). A late-evening series repeating Monday–Friday showed up Sunday–Thursday for anyone west of UTC: the repeat rule was being worked out against UTC days rather than yours, and 23:00 on Monday in New York is already Tuesday in UTC. Series are now expanded in your own zone, at the wall-clock time you chose, and stay there across daylight saving.

  New timed events are also written with your zone attached, the way every other calendar app writes them. Before, they were stored as a bare instant with no zone at all, so even once Calino displayed them correctly, every _other_ client reading the same calendar kept getting the old shifted weekdays. Existing zone-less events are still read the right way round, so nothing needs re-saving.

- **All-day tasks are readable in the week view on a phone** ([#120](https://github.com/Ivan-Malinovski/calino/issues/120), reported by [@YW5uaWth](https://github.com/YW5uaWth)). They appeared as bare checkboxes with no title, filed under the wrong day. The row they lived in was laid out across the width of the screen while the days themselves scroll sideways, so each one got about 45 pixels and sat wherever that offset happened to land. All-day tasks and events now sit in the day's own heading, as they already did in the day view; a busy day shows two and collapses the rest behind a tap. All-day _events_ were not drawn at all in the mobile week view before this — they are now.

- **A new event is never filed into a calendar you can't write to.** If a read-only calendar — a subscription, or one the server grants you no write access on — happened to sort first, the event form picked it by default and then refused to save: Create greyed out, the picker showing the calendar it had just chosen itself, and nothing on screen explaining why.

- **Edits made offline survive.** A queue of pending changes could lose entries in several ways: two edits to the same event overwrote one another, an edit made while offline could be dropped rather than held, and a change the server rejected because someone else had edited the same item first was discarded instead of being retried against the newer version. Failures are now told apart from one another — a full mailbox, a permission problem, a server asking you to slow down — and retried on terms that suit each, rather than all being treated as one kind of "didn't work".

- **Importing a .ics file copes with what real files look like.** Files saved by Windows tools, files with several calendars concatenated together, and files whose repeating events were split across separate blocks all now import correctly rather than partially or not at all.

- **Server accounts with non-ASCII passwords connect.** Credentials were encoded in a way that mangled anything outside plain ASCII, so a password with an accented character failed to authenticate with no useful explanation. Account discovery also follows redirects properly and reads per-calendar permissions correctly where a server reports them as a list, which is what several do.

## [0.28.1] - 2026-08-13

### Fixed

- **A journal entry is filed under the day you're actually on** ([#116](https://github.com/Ivan-Malinovski/calino/issues/116), reported by [@riblet](https://github.com/riblet)). West of UTC, an entry written in the evening was dated tomorrow: the new-entry form took "today" from UTC rather than from your own clock, so anything after about 7pm in New York — or 4pm on the US west coast — was stored a day ahead. A journal entry's date has no time zone attached to it, so that wrong day was written to the server as-is and read back the same way. The `T` shortcut and the palette's "New journal entry" took their date from the same place and are fixed with it. East of UTC this never happened, which is why it went unnoticed for so long.

  Entries already filed under the wrong day are not moved — Calino can't tell which ones were misdated and which ones you dated deliberately. Their date is editable in the entry itself.

- **A repeating event that ends on a date now ends on that date.** Two faults, both only visible west of UTC. The description under a repeating event read one day late — set a series to repeat until 31 December and it told you "until January 1, 2026", because the end date was being shown in UTC rather than in your zone. And an all-day series was _sent to the server_ a day late, as a moment in time rather than a plain date, which is both a day too long and not what the calendar standard permits for an all-day event. Other apps reading the same calendar saw the extra day too.

  Series saved before this fix are repaired as they're read, so the extra day stops being drawn straight away, and the correction is written back the next time that series is saved.

- **Editing a task's due date from its preview no longer wipes its time.** Clicking the date on a task's preview popup, changing it and saving turned the task into an all-day task: the time was only read from the time field, which stays empty unless you open it. The task's own time is now kept unless you actually change it — clearing the time field is still how a task becomes all-day. The same edit also left the task's end behind its new start, which was enough for it to be filed as broken and disappear from the calendar altogether.

### Removed

- **The time zone setting.** Settings → General offered a time zone picker that said "All events will be displayed in this timezone" and did nothing at all — Calino has always shown every date and time in the zone your device is set to, whatever this was set to. Rather than leave a control that made a promise it didn't keep, it's gone. Nothing about how your calendar is displayed changes. If another client syncs a time zone preference through Calino's settings sync, that value is still carried across untouched.

## [0.28.0] - 2026-08-12

### Added

- **A right-click menu on tasks** ([#107](https://github.com/Ivan-Malinovski/calino/issues/107), requested by [@skvsree](https://github.com/skvsree)). Right-click a task — in the tasks list, in the sidebar, or on a task pill in the calendar — and you get the things you'd otherwise have to open the whole form for: push it to tomorrow, pull it back to today, bump it a week, tick it off, or delete it. "Next week" counts from the task's own due date, so a scheduled task keeps its weekday; an overdue one counts from today instead, rather than being moved to a date that has also already passed. Whether you're offered "tomorrow" or "today" depends on where the task sits: anything already due today can only move forward. On a phone, long-press does the same thing. Deleting from here still gives you the usual few seconds to undo. Repeating tasks get the menu too, minus the reschedule shortcuts — moving one occurrence of a series is a different question, and it stays in the form for now.
- **Photo import can create tasks, not just events** ([#106](https://github.com/Ivan-Malinovski/calino/issues/106), requested by [@skvsree](https://github.com/skvsree)). Scanning a photo in the Android app now recognises to-do lists as well as flyers and invites: each item found in the picture appears in the review sheet with an Event/Task switch, and a photo of a hand-written list arrives with everything already switched to Task. The switch is yours either way — flip anything the model read as an event into a task before you confirm it, and vice versa. A photo can produce a mix of both; each opens its own form as you work through them.

### Fixed

- **Tasks with a description no longer overlap each other in the tasks list.** Every row was assumed to be the same height, so a task carrying a description — which needs a second line — lapped over the row beneath it. Rows are now measured individually, which also sorts out long titles that wrap onto another line. This only ever showed up once the list was long enough to scroll, which is why a short list always looked fine.
- **The circle on an agenda task row now ticks the task off.** It looked like a checkbox but was purely decorative: clicking it fell through to the row underneath and opened the task for editing instead. It is a real checkbox now — clicking it completes or un-completes the task, keyboard users can reach it and see where their focus is, and screen readers announce it properly. Ticking off one occurrence of a repeating task from here does the same thing it does everywhere else: that occurrence only, leaving the rest of the series alone. The spacing around it has been evened up to match an event row while we were in there.

## [0.27.4] - 2026-08-11

### Added

- **Tasks and events now carry a creation date** ([#112](https://github.com/Ivan-Malinovski/calino/issues/112), reported by [@riblet](https://github.com/riblet)). Everything Calino writes to a server now includes `CREATED` and `LAST-MODIFIED` alongside the `DTSTAMP` it already had. RFC 5545 doesn't require `CREATED`, but plenty of software assumes it is there — the reported case is MMM-CalDAV-Tasks, which appends `COMPLETED` _after_ `END:VTODO` when it can't find one, corrupting the task.

  `CREATED` is now also read back when Calino pulls a task or event in. That matters more than it sounds: Calino rebuilds each component from scratch on every save, so before this change a creation date written by any other client was silently dropped the first time you edited that task here. Records that predate this — and ones whose server copy never had a `CREATED` — get stamped with the current time on their next save, and hold that value from then on. `LAST-MODIFIED` tracks each write and matches the `DTSTAMP` on it exactly.

### Changed

- **The default reminder now seeds new events instead of silently applying to all of them.** Setting a 15-minute default used to mean every event without its own reminder notified you 15 minutes ahead — but the event's form showed no reminder at all, so there was nothing to look at and nothing to remove. Worse, deleting an event's last reminder did nothing: an empty reminder list was indistinguishable from one that had never been set, so the default came straight back and the event notified anyway.

  "Default Reminder" now does what its name suggests: a new event opens with that reminder already in place, as a chip you can change or delete like any other. What the form shows is exactly what will fire — on the web, in the Android app's own notifications, and in the calendar Calino mirrors to Android. Events created without opening the form get it too: quick-add from the command palette, and the birthday and anniversary events made from a contact. The setting has gained a **None** option for starting new events with no reminder at all.

  Worth knowing before you upgrade: events already saved without any reminder will stop notifying, because they genuinely have none. If you relied on the old blanket behaviour, open those events and add a reminder. Tasks are unaffected — they never took the default.

### Fixed

- **An "At time of event" reminder survives syncing.** A reminder set to fire at the moment the event starts was written to the server correctly but discarded when Calino read it back, so it worked until the next sync and then quietly disappeared. Zero minutes was being treated as "no reminder" rather than as a real choice. This is easier to run into now that the default reminder can be set to "At time of event".

- **Duplicated events are saved to the server.** Duplicating an event — from the context menu, ctrl+clicking it, or ctrl+dragging it to a new slot — only ever created the copy locally. It looked right until the next sync, which removed it again: the server had never been told about it. The copy is now pushed like any other new event, and a failed push is queued for retry rather than lost.

- **No stray horizontal scrollbar in the sidebar.** On the desktop layout the sidebar sometimes showed a scrollbar along its bottom edge even though nothing extended sideways.

- **Journal entries write their timestamps in UTC.** `CREATED` and `LAST-MODIFIED` on a journal entry were emitted as floating local times, which RFC 5545 §3.8.7 doesn't allow — a server or client in another zone read them hours off.

- **The Calino wordmark sits centred against its diamond.** The serif line box reserves room for descenders that "Calino" hasn't got, so the word rode high next to the diamond. The rotated diamond was also clipped along its left edge — the inset was measured off the unrotated square, ignoring its wider diagonal — and the mobile brand row sat closer to the top of the screen than the desktop header's does.

## [0.27.3] - 2026-08-07

### Added

- **Server diagnostics.** Settings → Sync now has a **Diagnose** button on each account, and a failed connection in the Add/Edit Calendar dialog offers to run it. Instead of one "this may be a CORS issue" catch-all, Calino probes the server check by check — is it reachable, does it allow cross-origin requests, are the credentials accepted, does it speak CalDAV, does it allow the methods and headers sync needs, can it list a collection, does it answer REPORT queries, is the ETag readable — and tells you exactly which header or method to add. There's a **Copy report** button for pasting into a bug report; it keeps your server's hostname and drops your username, password and proxy URL.

  Two things worth knowing. Browsers deliberately hide a server's `Access-Control-Allow-*` headers from JavaScript, so some verdicts are marked **inferred**: deduced from which requests survived rather than read off the wire. Adding `DAV, Allow` to your server's `Access-Control-Expose-Headers` lets Calino read those directly, and the Android app has no CORS layer at all, so everything there is observed. Separately, there's an opt-in **write test** that creates one temporary event and deletes it again — it's the only way to be certain the ETag comes back on writes, so it sits behind its own button.

  Diagnostics account for URLs that aren't a single calendar. Some servers redirect discovery past the CalDAV endpoint and on to their web interface — Radicale sends `/.well-known/caldav` to `/` and then to `/.web` — so if the discovered address turns out not to speak DAV, Calino falls back to the address you entered rather than reporting the web page's refusal as a rejected password. And pointing diagnostics at a principal or home set rather than one calendar skips the write test with an explanation, instead of failing on a request that URL could never have accepted.

### Changed

- **A plain-http server now says why it can't be reached.** Calino is served over https, and browsers refuse to let an https page talk to an http one — so a DAV server on plain http inside a LAN failed with the same "couldn't reach the server" as one that was switched off. Diagnostics now names it, and says that the Android app isn't affected.

- **Clearer errors when adding a server.** A failed connection used to show the underlying exception spliced into a sentence — "Connection failed: Failed to fetch. This may be a CORS issue" — which named CORS even when the real cause was a typo in the address or a server that wasn't running, and showed "Server returned status 401" rather than saying the password was refused. Both dialogs now explain the failure instead, and offer to run diagnostics. The first-run setup page had its own separate copy of the connection test, with no hints and no diagnostics; it now uses the same one as everything else.

- **The rest of the calendar actions explain their failures too.** Syncing from the sidebar, renaming a calendar, changing its colour, deleting it, creating one on the server and subscribing to a webcal feed all used to put the underlying exception straight into the toast — most often a bare "Failed to fetch". They now say what went wrong, in the same words as everything else.

- **Clearer sync error messages.** The inline error in Settings and the toast that accompanies it were written separately and had drifted apart, so the same failure could be described two different ways — and one branch could never fire at all. They now share one classifier. Timeouts, server-side 5xx errors, and "this changed on another device" conflicts previously fell through as raw technical text and now get their own explanation, and the CORS message points at the new diagnostics rather than only dumping a block of headers.

### Fixed

- **A recurring task edited to a specific time no longer appears twice** ([#96](https://github.com/Ivan-Malinovski/calino/issues/96), reported by [@MaliciousPoro](https://github.com/MaliciousPoro)). Taking one occurrence of an all-day recurring task, switching its due date from "date only" to "date and time" and saving it as "this task only" left two rows on that day — one with the new time, one without. They were the same task, so editing either changed the timed one and deleting either removed both. A single occurrence that's been detached from its series is filed under the slot it replaces, and that slot belongs to the series, not to the edited copy; the edited copy was being filed under its own new time instead, so the original slot was never hidden. Saving as "this and following" or "all tasks" was unaffected.

- **Opening Calino always starts on the current month.** The month you were last browsing was saved and restored, so a new tab could open on June because that's where the previous session left off. The view you were in still comes from your default-view setting; only the date is reset.

- **Contacts reached through a CORS proxy no longer lose track of where an entry lives.** The same double-prefixed address fixed for calendars in 0.27.2 was still present on the contacts side.

## [0.27.2] - 2026-08-05

### Fixed

- **Deleting a task, event or journal entry on a remote calendar works again** ([#110](https://github.com/Ivan-Malinovski/calino/issues/110)). It reported "Failed to sync deletion. It will be retried." and left the item on the server, which answered with a 412. Calino asks the server for the entry tag it needs to confirm a change, and Baikal and Nextcloud write the quotes in that tag escaped — Calino was reading them literally and quoting the escape codes back, so the server never recognised its own tag. Radicale writes them plainly, which is why it depended on which server you use. The same fault affected editing and deleting contacts.

  It only ever showed up in the browser, never in the Android app, and only when you deleted something before the next sync had run — which is why it looked like it came and went. Present since 0.20.0.

- **Calendars reached through a CORS proxy no longer lose track of where an entry lives.** The address Calino stored for a newly created entry had the proxy's address folded into it a second time, so the next request went nowhere. Deleting was the operation that showed it, since it's the one with no fallback to fall back on. Addresses already stored this way keep working and correct themselves at the next sync.

## [0.27.1] - 2026-08-04

### Added

- **The time fields now respond to scrolling and to the arrow keys**, the way the date fields already did. Point at a start or end time and scroll, or focus it and press ↑/↓, to step it in 15-minute jumps — the same step the date fields use.
- **Search results tell you what they are.** Tasks and journal entries have their own headings in the command palette rather than all being filed under "Events", and anything that repeats is marked with a ↻ and the pattern it follows ("Every week on Tuesday").

### Fixed

- **Editing a recurring task from the small preview popup no longer turns it into an event** ([#96](https://github.com/Ivan-Malinovski/calino/issues/96)). Editing through the full modal was fixed in 0.27.0, but the popup had the same fault untouched: choosing "this occurrence" or "this and following" rebuilt the task as an event and lost its due date, priority and completion state.
- **A whole-day task converted to an event now stays on one day.** It stretched across two in the month view, because a task's due date was being carried over as the event's end.
- **Editing or deleting a repeating task asks about "tasks".** Both dialogs offered "All events" / "This event only" whatever you had selected.
- **Opening a journal entry from the command palette opens the journal**, rather than an event modal that couldn't display it.
- **A repeating event or task found in the command palette is shown at its next occurrence**, not at the date the series began — which for a long-running weekly was years ago — and opening it lands on that occurrence, so an edit asks which occurrences you meant. An occurrence you've edited separately no longer appears as a second, near-identical result beside its own series.
- **Dates in the command palette follow your 12/24-hour setting**, and an all-day or journal result no longer shows a spurious time — or, in a timezone behind UTC, the wrong day.
- **Scrolling the month view no longer changes month while there's still calendar to see.** In a short window the grid doesn't fit, and every scroll towards the last week flipped the month instead of showing it. The month changes only once the grid has nothing left to scroll.

## [0.27.0] - 2026-08-03

### Added

- **Tasks can repeat.** "Exercise every Tuesday" is now a single task rather than a copy-paste job every week. Set a due date, tick **Recurring**, and pick a pattern with the same controls events use. The Tasks list shows the series as one row on its next due date; tick it and it advances to the next one, with the occurrences you've finished kept under the **Completed** filter. Hovering the repeat symbol tells you the pattern, when the next one is due, and how many you've done. Recurring tasks also appear on the right day in the month, week and day views, and can be ticked off from there. Raised in [#96](https://github.com/Ivan-Malinovski/calino/issues/96).

  It's built on plain RFC 5545 — an `RRULE` on the task plus one completed instance per occurrence, exactly as Thunderbird writes them, with no vendor-specific properties. A repeating task you create in Calino reads correctly in other CalDAV clients, and theirs read correctly here. (Tasks.org and OpenTasks represent repeats in a non-standard way and will only partly agree; that's a known limitation on their side.)

  Recurrence isn't offered on a task with no due date — there'd be nothing for the pattern to count from — nor on subtasks or tasks that have subtasks, since a parent/child link has no per-occurrence meaning. The option explains itself rather than quietly disappearing.

- **Android: your events can now live in the device calendar too.** A new **Sync to Android Calendar** switch in Notification settings copies your CalDAV events into Android's own calendar, which means the system delivers your reminders — they arrive on time whether or not Calino has been opened recently, instead of only for events the app already knew about last time it ran. It also puts your calendar in front of everything else on the phone that reads it: home-screen calendar widgets, Wear OS, Android Auto and Assistant. The copy is one-way and read-only: Calino stays the only thing that writes to your CalDAV server, and turning the switch off removes the mirrored calendars again. Off by default, and it asks for calendar permission when you turn it on.
- **Android: the device calendar now stays up to date on its own.** With **Sync to Android Calendar** on, Calino checks your CalDAV server for new events roughly once an hour in the background, so an event someone adds on your laptop — or an invitation that lands while your phone is in your pocket — reaches the device calendar and reminds you at the right time, without you having opened Calino since. Previously the mirror only ever held what Calino had already seen, so the reminder you most needed was the one it couldn't give you.

### Fixed

- **Auto rollup in the month view now measures what a day actually holds.** It costed every row at the height of a full event card, so a day of short rows — task pills, past-week events, multi-day bands, rolled-up recurrences — said "+N more" with half the cell still empty. Each row is now costed at the height it really renders at, measured off the page rather than assumed, so it also follows a change of theme, font size or browser zoom. Cells in a window too short to fit the month were being underestimated as well, and rolled up while the row they sit in had room to spare.
- **A day that overflowed both its events and its tasks showed "+1 more" twice.** There is now one rollup line per day, counting both, and the popup it opens lists the day's tasks alongside its events.
- **A repeating all-day event landed on the wrong day of the week east of UTC.** "Every Tuesday" generated Wednesdays for anyone ahead of UTC, including all of Europe. This affected events as well as the new recurring tasks.
- **Tasks due on an all-day date could show up a day early** for anyone behind UTC.
- **Recurring tasks written by other clients no longer lose their pattern.** Calino previously read such a task as a single one-off and dropped its repeat rule the next time it saved, along with the task's location and URL.

## [0.26.0] - 2026-08-02

### Added

- **Arrange the view switcher however you like.** Long-press a tile in the mobile view grid and drag it where you want it; on desktop, drag a tab along the strip. Your arrangement is remembered, and everything follows it — the tabs, the mobile grid, and the order that swiping and the `<`/`>` shortcuts step through. Reordering is also available from the keyboard with Alt+←/→ on a focused tab.
- **Pinch the week view on a phone to fit more days on screen.** It compresses the day columns rather than zooming, down to about five days at once. Vertical zoom stays a desktop gesture. Pinch had previously never worked on touch at all — the gesture library's touch handlers were never actually bound.
- **The month view can now decide for itself how many events a day shows.** "Events Before Rollup" in Calendar settings has a new **Auto** option — now the default — which fits as many cards as the day cell physically has room for and rolls the rest into "+N more". Resize the window and the count follows: shrink it and cards move into the rollup, grow it and they come back. Compressed past weeks get proportionally fewer, and tasks keep a row of their own. A fixed 2–5 is still there if you prefer a count that never moves.
- **Event colour strength is now yours to set.** Under Appearance, when you're on the default theme, **Subtle / Balanced / Vivid** controls how much of a calendar's colour shows on its events. Subtle is the default and looks exactly as Calino always has; the stronger settings make it easier to tell calendars apart at a glance without changing anything else about the design. Raised in [#31](https://github.com/Ivan-Malinovski/calino/issues/31).
- **The divider in the tab strip is now yours to place.** It's an element you drag like any tab, rather than a fixed boundary between "calendar" and "everything else", so you can group the tabs however makes sense to you.

### Changed

- **The default theme is now legible throughout.** Text that was too faint to read comfortably has been darkened across the app — secondary labels, weekday headers, week numbers, the time and location on an event, out-of-month dates, and the muted greys generally. Every one of them now meets the WCAG AA contrast standard on every surface, in both light and dark mode.
- **Today's date, and every primary button, can actually be read.** White text on the warm brown accent was well below the readable threshold — worse still in dark mode. The accent keeps its exact colour wherever you see it as a rail, dot or tint; where it has to carry text it now uses a deeper shade of the same brown, and dark mode switches to dark text on the accent instead of white.
- **Status colours are readable rather than decorative.** Green, red and amber were the stock palette, tuned for a white page and washed out on Calino's cream one — the sync-failure icon in particular was near-invisible and faded further as it pulsed.
- **Primary buttons in the Catppuccin theme use its own contrast colour** instead of always being white, which was close to unreadable on its light blue accent. Other custom themes are unchanged.
- **The "+N more" popup now has the same glass, border and shadow as the event preview**, so it reads as a card floating over the month rather than part of the grid.
- **Picking which calendar a journal entry goes into is now a row of chips** with each calendar's colour, instead of a full-width dropdown — the choices are visible without opening anything, and it matches the category picker. The entry form's `+ Add` is now `+ More`.

### Fixed

- **Clicking an event in the "+N more" popup opens that event.** It opened an empty modal instead, as if you were creating a new event: the popup is drawn outside the day cell but its clicks still travelled through it, so the cell's own "new event on this day" fired on top of the one you asked for.
- **The "+N more" popup stays on screen.** Opened from a day late in the week it ran off the right edge, and from the last row of the month off the bottom — it now settles inside the window, and a long list scrolls rather than hanging past the edge.
- **The icons in the event preview are no longer shaved off at the top** (#93). They were drawn hard against the edge of their own canvas — the calendar's tick marks and the clock face lost their rounded tops, and the location pin was drawn past the edge outright and clipped flat.
- **The view switcher, the mobile grid and view cycling now agree on one order.** They were each built from a separate hardcoded list that had drifted apart, so the tabs read Month, Year, Week… while the mobile grid read Month, Week, Agenda… and swiping stepped through a third order again.
- **Cycling views no longer stops on Journal or Contacts when they're switched off.** The `<`/`>` shortcuts and the two-finger swipe visited them regardless.
- **Dragging a tile more than one place now moves the tile you're actually holding.** Each cell crossed during a drag was worked out from the arrangement as it stood when the drag began, so every step overwrote the one before it and only the last one survived — dragging across the row left your tile where it started and shuffled two others instead.
- **The view grid no longer closes underneath you mid-drag.** Dragging a tile downwards was also read as a swipe-to-dismiss on the sheet, which shut the whole panel on release.
- **Long-pressing a tile no longer selects its label** or raises the text-selection popup over it.
- **A quick horizontal flick in the week view no longer jumps a whole week.** The day columns scroll under the same gesture, so any flick meant to bring the next day into view also paged. Swiping now scrolls the days first and only changes week once the strip is already at that end.
- **The week grid's day headers stay opaque as you scroll sideways on mobile.** The header strip was only ever as wide as the screen while the day columns ran on past it, so the days you scrolled into view had nothing painted behind them. The same fault also unpinned the hour column, which slid off the left edge partway through the week instead of staying put.
- **A dragged tab lands where you drop it.** The move was being applied twice, so releasing a tab one place along undid itself and a longer drag settled one place to the left of where you let go. Where it lands is also worked out from where the tab would actually come to rest now, rather than from the widths of the tabs it passes — those disagree once labels differ in width.

## [0.25.5] - 2026-08-01

### Added

- **Swipe the sidebar closed on mobile.** The panel follows your finger and either completes its exit or springs back when you let go, instead of waiting for a threshold and then jumping.
- **Controls that only appeared on hover are now reachable on touch** — on a phone there is no hover, so they were simply invisible.

### Fixed

- **Contact relations pointing at a server-generated ID now resolve to a name.** Relations only resolved when the underlying ID happened to be a canonical UUID; servers that mint readable IDs (Radicale among them) left you looking at a raw `urn:uuid:…` string. Group member lists get the same fix. A relation whose contact isn't loaded now reads _Unknown Contact_, with the ID kept on hover.
- **Contacts no longer fill up the browser's storage.** Photos moved into a proper database and the raw card data is no longer kept twice, so a large address book stops throwing _QuotaExceededError_ — which had also been breaking task and event saves, since every part of Calino shares that storage. Fixes [#91](https://github.com/Ivan-Malinovski/calino/issues/91).
- **The on-screen keyboard no longer covers what you're typing on Android.** The app now resizes to sit above it.
- **Tapping a day in month view does one thing.** Compact mobile layouts had overlapping tap targets, so a tap could select a day and open the day sheet at once. Fixes [#79](https://github.com/Ivan-Malinovski/calino/issues/79).
- **Dragging the month/agenda divider no longer changes the date** under your finger, and no longer stutters.
- **The screen stopped flashing** when swiping the sidebar closed, and the dimmer now fades out continuously rather than snapping back to full strength for a frame.
- **The view switcher stays put when you open Tasks.** The Tasks view adds a project filter to the header, and the switcher used to shift sideways to make room for it.
- **Form fields no longer zoom the page on iOS** when focused.
- **Muted text in dark mode meets WCAG AA contrast.**

### Changed

- **Calino starts faster.** Settings, the privacy page and the command palette now load on demand instead of riding along in the initial download.
- **Typography and colour cleanup**: the display typeface is now the intended one, light-mode neutrals are warmer, shadows are cast in black (and dropped entirely in dark mode), and colours that had drifted off the palette were brought back onto it.
- **Header alignment**: the month title and view-switcher labels sit on their true vertical centre.

## [0.25.4] - 2026-07-31

### Added

- **Events move between calendars — for real this time.** Changing an event's calendar used to look like it worked until the next sync quietly put it back; the move now happens on the server, so events stay where you put them — including recurring series with their individual exceptions, and even across accounts. Fixes [#86](https://github.com/Ivan-Malinovski/calino/issues/86).
- **Contact birthdays & anniversaries actually land on your calendar.** "Add to calendar" used to write only locally, so the event vanished at the next sync; it is now saved to the server, survives reloads, and — with more than one writable calendar — you get to choose where it goes. Undo removes it everywhere, and deleting the contact cleans up its birthday events too. Fixes [#84](https://github.com/Ivan-Malinovski/calino/issues/84).
- **Journal entries can be filed into the calendar of your choice** — and moved between calendars (or back to the Offline calendar) any time you edit one. Fixes [#89](https://github.com/Ivan-Malinovski/calino/issues/89).
- **Journal entries show their month and year**, so a June 5th entry can't be confused with an April 5th one. Fixes [#85](https://github.com/Ivan-Malinovski/calino/issues/85).
- **Hiding a calendar in the sidebar now hides its journal entries everywhere** — the list, the day sheet and the month-grid dots — exactly like events and tasks. Fixes [#88](https://github.com/Ivan-Malinovski/calino/issues/88).
- **Contact relations resolve to the person they point at.** A relation entered as a UUID used to display as a raw `urn:uuid:…` string forever; it now shows the contact's name, is clickable, and works across address books. Relations and group members are picked from a searchable list instead of typed by hand. Fixes [#87](https://github.com/Ivan-Malinovski/calino/issues/87).

### Fixed

- **Birthdays and anniversaries could show the wrong day** (age off by one) in timezones west of UTC — a birthday on July 1st was sometimes counted as June 30th.
- **Editing an event twice in a row could fail to save** on some calendar servers; consecutive edits now save reliably.
- **A contact whose only extra detail was a relation, a language or group membership showed an empty page** — the whole details section was hidden unless there was also an email, phone, address, website or messaging handle.

### Changed

- **Typing in the journal and opening contact details are noticeably snappier** with long lists.

## [0.25.3] - 2026-07-27

### Fixed

- **Deleting a contact really does delete it this time.** The fix in 0.25.2 addressed the wrong layer: the DELETE was still being aimed at nothing, so the contact came back on the next sync — most visibly after adding a contact and then deleting a different, older one. Three separate faults had to line up, and all three are now fixed. The address Calino stored for a contact on the server was being read out of the contact's _website_ field, so anyone without a website had no address at all (the delete was quietly dropped and marked done) and anyone with one had their homepage stored instead. Server revision tags were double-quoted when sent back, which every conditional delete and edit rejected with a 412. And creating a contact by filling in a name but leaving the title blank produced a card with no display name, which strict servers reject outright with a 400. Re-fixes [#75](https://github.com/Ivan-Malinovski/calino/issues/75).
- **A write the server refuses is now reported instead of retried forever.** Rejected changes were replayed on every sync indefinitely, and the affected contact was frozen — it would neither update from the server nor disappear. Calino now gives up after three attempts and tells you what the server said, by name: _Couldn't delete "Bob" on the server: 400 Bad Request_.
- **Two syncs of the same account no longer race.** The slower one used to write back a contact list it had read before the other finished, restoring contacts you had just deleted. Syncs now run one at a time, and a change made while a sync is in flight still gets its own pass rather than being skipped.
- **Double-clicking Save when creating a contact no longer creates two of them.**
- **Contacts sync with servers that don't expose revision tags to the browser** (a CORS default that affects many reverse-proxy setups). Previously the delete or edit was silently skipped.
- **The agenda scrolls where you'd expect.** It jumps to today when you press Today or navigate into the current month, and to the top of the list for any other month — before, it could land mid-month or be clamped to the wrong position mid-transition. Long months also scroll without stuttering.
- **Month view leaves room for the navigation pill again** when the agenda split is off, and gets out of the way while you're typing so the pill doesn't float over the keyboard.
- **Dragging the split-view divider downwards no longer triggers a pull-to-refresh**, and a pull can't start a second refresh while one is already running.
- **Calino opens in the default view you chose in Settings**, instead of whichever view you happened to be in last time.
- **Haptics on Android are immediate and much gentler.** Feedback was queued through a bridge that delayed it by 5–10 seconds, which made it feel broken rather than responsive. **Haptics are now off by default** — turn them on in Settings → General. Fixes [#76](https://github.com/Ivan-Malinovski/calino/issues/76).

### Added

- **Past days in the agenda can be faded out** — Settings → Calendar, with three choices: Never, Current month, or All.

## [0.25.2] - 2026-07-26

### Fixed

- **The calendar no longer gets slower as you store more events.** Every view switch, month navigation and edit rebuilt the entire event index from scratch — four full passes over every event you have — so the cost of moving around scaled with your whole calendar rather than with what's on screen. It's now built once per change and range queries binary-search their window. On twelve month queries with 20,000 events: 1088ms → 2.8ms. Partially addresses [#73](https://github.com/Ivan-Malinovski/calino/issues/73).
- **The agenda view is virtualized**, so a long month renders only the rows in view instead of every card at once.
- **Month and week views stopped re-rendering everything on every interaction** — several props were being rebuilt each render, defeating the memoization meant to prevent exactly that.
- **View switches and the view-switcher pill are smooth again.** Switching into month or agenda played the date-change slide on top of the view's own first render, and the pill's sliding selector was measured on the main thread every frame — so both stuttered exactly when the app was busiest. The slide no longer fires on mount, and the selector now animates on the compositor.
- **Deleting a contact now actually deletes it on the server.** The DELETE was never issued, so the contact reappeared on the next sync. Undo still works, before or after the change reaches the server. Fixes [#75](https://github.com/Ivan-Malinovski/calino/issues/75).
- **Contacts work with more than one address book again** — "+ New" appeared to do nothing (the address-book picker was rendering off-screen), the picked book was discarded so contacts landed in the wrong one, and edits to a book outside the first one never reached the server. Fixes [#74](https://github.com/Ivan-Malinovski/calino/issues/74).
- **Events with an end before their start are no longer dropped** from range queries.
- **Pull-to-refresh ignores horizontal swipes**, so paging between months no longer triggers a refresh.
- **Mobile date/time pickers use the native Android picker** in the preview sheet, and no longer leave a dimmed backdrop behind when the app goes to the background.
- Month-change layout shift, split-pane resizing, the grid height transition after first mount, agenda scroll stutter on app start, and mobile week-number alignment.

### Added

- **The event preview is a bottom sheet on mobile.** It used to be a fixed 300px card anchored to the tap point, which landed half off-screen on a phone; it now pins to the bottom edge full width, scrolls its content, and swipes down to dismiss. The desktop popup is unchanged. Fixes [#70](https://github.com/Ivan-Malinovski/calino/issues/70).
- **A haptic feedback toggle** in Settings → General on Android. It's a per-device setting and isn't synced, since the phone that feels sluggish isn't necessarily every phone on your account.

### Changed

- **The AI base URL is now used exactly as you enter it.** Calino used to append `/v1` to whatever you typed, which meant an endpoint that lives somewhere else — a gateway on a subpath, or a different version prefix — couldn't be expressed at all. Enter the full API root, including `/v1`. Existing settings are migrated automatically.
- **Desktop month transitions skip the animation when you navigate rapidly**, so holding the chevron or spinning the wheel doesn't strobe.

## [0.25.1] - 2026-07-25

### Fixed

- **CalDAV/CardDAV sync was broken on Android in 0.25.0** — enabling Capacitor's native HTTP bridge for AI photo import also replaced the WebView's `fetch`, routing cross-origin requests through Android's `HttpURLConnection`, which rejects every WebDAV method (`PROPFIND`, `REPORT`, `PROPPATCH`, `MKCALENDAR`, `MKCOL`, `COPY`, `MOVE`). Sync failed at the first discovery request. Android builds from 0.24.0 and earlier, and all web builds, were unaffected.
- **Sidebar content is now scrollable** when it's taller than the window (a long task list, many calendars). Sections past the bottom were clipped and unreachable.
- **The month+agenda split no longer hides days.** The grid's share of the height is a floor rather than a fixed size, measured from real layout, so a 6-week month can't be squeezed into a scrollbar. Height changes between months are animated.
- **Week numbers respect the setting on mobile.** The ≤500px layout hid the column outright, ignoring the preference.
- **Agenda task checkboxes sit on the right edge of the card on mobile**, in one column down the list.
- **The journal modal was rendering twice** — a second copy sat exactly on top of the first, invisible until the swipe gesture separated them.

### Added

- **Android no longer needs CORS headers on your CalDAV server.** DAV requests now go through a native OkHttp path instead of the WebView, so servers with no CORS configuration at all — including plain `http://` servers on your LAN — work on the phone without a proxy. The CORS requirements in the README still apply to the web app. Self-signed certificates are still rejected (system trust store).
- **Swipe down to dismiss the New Event and journal entry sheets on mobile** — from anywhere on the sheet, not just the top edge, including over the fields once the list is scrolled to the top. Both sheets now slide up as one piece instead of popping in, and the journal sheet sits on the bottom edge so the compose field stays next to the keyboard.
- **The month title and calendar now animate in the direction you navigate** — horizontally on mobile to match the swipe, vertically on desktop to match the scroll. The agenda moves with them, so both panes of the month+agenda split travel together.

## [0.25.0] - 2026-07-24

### Added

- **AI photo-to-event import on Android** — snap or share a photo (flyer, poster, invite) and a vision-capable LLM extracts event details to prefill New Event. BYOK across Anthropic, OpenAI, or any custom OpenAI-/Anthropic-compatible endpoint (auto-detected from an `/anthropic` path segment in the base URL). Three entry points: a camera button next to New Event, Android's native share sheet for images, and a home-screen shortcut that only appears once a key is configured. A full-screen staged overlay and distinct empty-result/error messaging show progress at each step.
- **Onboarding now mentions the Android app** with a link to the [GitHub Releases page](https://github.com/Ivan-Malinovski/calino/releases) — web-only, so people know a native app exists without the link showing up inside the app itself.

### Fixed

- **Agenda-below-month auto-split is now portrait-only**, divider drag position persists across reloads instead of resetting, and the split can be disabled entirely via a new Calendar setting or the command palette. Wide desktop monitors no longer trigger the split just because they're tall. Fixes [#68](https://github.com/Ivan-Malinovski/calino/issues/68).

## [0.24.0] - 2026-07-23

### Added

- **Calino for Android** — a native wrapper (Capacitor) is now available as a signed APK on the [GitHub Releases page](https://github.com/Ivan-Malinovski/calino/releases). Not on Play Store yet, so you'll need to allow "install unknown apps" the first time. Includes home-screen app shortcuts (new event, new task, today), haptics, and a proper native status bar/splash screen.
  - Notification permission is now requested proactively during onboarding (native only), with rationale copy shown first, instead of only reactively via Settings.
  - **If reminders don't fire reliably**, your phone maker is probably killing Calino in the background to save battery — check [dontkillmyapp.com](https://dontkillmyapp.com/) (Xiaomi/MIUI is the worst offender, but Oppo/Realme/Honor/OnePlus and others do this too) and set Calino to "No restrictions" battery mode.
  - Pull-to-refresh on mobile, and tapping a reminder notification now deep-links straight to that event instead of just opening the app.

### Fixed

- **Only the default theme had correct top safe-area insets on Android** — every custom theme's `:root` block hardcoded `--safe-area-top/bottom/right: 0px`, silently overriding the real inset values injected by Capacitor. Removed from all theme files; safe-area insets now apply regardless of theme.
- **Mobile nav pill swipe direction was backwards** — swiping right on the collapsed pill now advances forward through views (month → week → agenda → ...), swiping left goes back, matching the intuitive direction.
- White flash between splash screen and first paint on Android.
- First-run onboarding modal not respecting safe-area insets on mobile; cookie banner no longer shows on Android (no cookies to consent to there).
- CalDAV account defaulting to "Offline" instead of the calendar you just added.
- Several mobile touch/drag fixes: agenda's horizontal swipe being hijacked by vertical scroll, event drag-to-reschedule on touch, post-drag context menu re-triggering or not closing on new drags/resizes, floating pill jumping with the on-screen keyboard.
- Various mobile layout polish: `/year` month grid centering, tasks/journal column spacing and button wrapping, project filter placement in the header, command palette padding.

## [0.23.1] - 2026-07-23

### Added

- **"Go to today" button in the calendar header** — a small calendar icon at the top right jumps back to today, and only appears once you've navigated away from it. Mirrors the "today" cell highlight already used in the month grid, and fades/scales in and out with the date. Complements the existing (but easy to miss) shortcut of tapping the month title.
- **Mobile Settings back-arrow pill and accordion categories** — on `/settings`, the floating pill's leading button now shows a back arrow instead of the hamburger and steps out one level at a time (section → category list → calendar). The mobile category list expands each section inline as an accordion instead of navigating to a separate page.
- **Swipe to switch views on the mobile nav pill** — a horizontal swipe on the collapsed pill cycles through views in the same order as the expanded grid, from any route.

### Fixed

- **Mobile month view swiped two months at a time** instead of one — a duplicate touch handler was double-firing alongside the existing pointer gesture.
- **Floating mobile nav pill was hard to see against the panel background**, especially in light mode — it now has a subtle ink-tinted border in both themes.
- **`/month`'s calendar grid lost its rounded corners and border on mobile**, going edge-to-edge below 500px unlike every other view. It now keeps the same rounded, bordered, inset treatment as `/week` down to the smallest screens.
- **Mobile sidebar overlay washed out instead of darkening** in dark mode — it used a color token that flips to a light value there; now uses one that stays dark in both themes, with a blur added for a proper drawer feel. The drawer itself now scales with viewport width instead of a fixed 250px.

### Changed

- Journal view's "+ New entry" button is now "+ New" on mobile; the tasks view's project filter dropdown moved into the header, right-aligned.

## [0.23.0] - 2026-07-22

### Added

- **Redesigned mobile navigation: a single floating bottom pill** — replaces the old mobile top-switcher and FAB. Consolidates the hamburger menu, view switcher, search/settings, and create actions into one floating pill with three states (collapsed base row, expanded view grid, create drawer). Swipe up on the collapsed pill or down on the grid/drawer to open and close it; a single-finger swipe over the calendar content pages the date, alongside the existing two-finger view-cycle gesture. Content across Month/Agenda/Day/Year/Tasks reserves clearance so the pill never obscures it. Desktop navigation is unchanged.
- **Mobile Settings now lands on a category list** and mounts the same floating nav pill, so its Month/Week/Agenda switcher doubles as a way back to the calendar. Fixes a bug where a later media query silently re-hid the mobile back button once the category-list state existed.

### Fixed

- **Mobile floating nav pill no longer hides Month/Week/Agenda off the base views** — those three buttons used to disappear on any other route (e.g. `/settings`, `/year`, `/day`), leaving only the "..." button and a duplicate Month/Week/Agenda selector buried inside its expanded menu. The buttons now stay visible everywhere, the "..." button is highlighted instead of them when you're off a base view, and the redundant duplicate selector in the expanded menu is gone.
- **Expanded "..." menu could highlight the wrong view** — the highlighted tile was derived from state that doesn't reset on non-calendar routes, so e.g. `/settings` could still show "Agenda" highlighted from whatever view you'd last visited. It's now derived from the actual route.
- **Settings mobile header alignment** — section title size now matches the calendar nav title, the dead (unused) section dropdown is removed, and the back button/title/content spacing lines up with the calendar nav pill.

### Changed

- **`scripts/release.sh` now works with Podman, not just Docker** — the script's `docker` calls only worked in an interactive shell where a `docker=podman` alias could expand; its own non-interactive shell never saw it, so every Docker step failed on Podman-only machines even with Podman running. It now detects whichever engine is actually available. The Dockerfile's base images are also fully-qualified (`docker.io/library/...`) to avoid Podman's short-name resolution prompt.
- Removed the `design_handoff_navigation/` prototype directory — the nav redesign it documented has already shipped.

## [0.22.7] - 2026-07-18

### Added

- **Native time picker on mobile** — the event/task form now shows the OS wheel picker (`<input type="time">`) on mobile instead of the typeable `TimeInput`, making time selection faster on touch devices. This now covers the task form's "Due time" field as well, which was still using the typeable input. Closes [#56](https://github.com/Ivan-Malinovski/calino/issues/56).

### Fixed

- **Changing an event's start time now preserves its duration** — shifting a start time forward or backward now shifts the end time by the same amount rather than blindly adding 1 hour. The previous logic caused events to unexpectedly grow or shrink when their start was edited. Closes [#60](https://github.com/Ivan-Malinovski/calino/issues/60).
- **Task-form "Completed" row no longer wraps awkwardly on mobile** — the checkbox and due-mode segmented control are now stacked vertically on small screens so the long-segment tabs ("Due date and time" / "Date only" / "No due date") don't squeeze the checkbox off-screen. Closes [#59](https://github.com/Ivan-Malinovski/calino/issues/59).
- **Start and End no longer share a line on mobile** — the two date/time groups stack vertically below 768px, so neither pair is squeezed too narrow to read.
- **Event modal control sizing** — every input and dropdown in the modal now shares one height (32px desktop / 44px mobile) so rows like "Due date / Due time / Priority" line up. The calendar picker previously used a near-duplicate style that left it visibly shorter than its neighbours.
- **Dropdown chevrons sat flush against the field edge** — the modal's selects now draw the same custom chevron as the Settings selects, inset from the border instead of using the browser's built-in arrow, whose position can't be controlled portably.
- **"Add subtask" sat above the Parent task field instead of beside it** — it's now on the same line, aligned to the select's height.
- **"Due time" field width** — narrower than "Due date" on desktop, and sized to its own content on mobile, where the native time input's clock indicator needs the extra room.
- **"Add subtask" label sat below centre** — the button's inherited vertical padding fought its fixed height; the label is now centred at any height.
- **Settings toggles dropped onto their own line on mobile** — the mobile layout stacked every settings row, which suits a full-width dropdown but wasted a line on a 44px switch and separated it from its label. Toggle rows now stay horizontal; rows with wide controls still stack.
- **Category color picker hid most of the palette** — the add-category form offered 6 of the 13 colors and the edit form 8, with no way to reach the rest since the strip didn't scroll or wrap. The full palette now wraps onto its own line within the row, with larger swatches on mobile. Closes [#58](https://github.com/Ivan-Malinovski/calino/issues/58).
- **Cramped task list top bar on mobile** — the task counts now read as "N active" over "N done" on two lines, which frees enough width to keep them, the filter tabs, and the "Add" button on a single row without the button pressing against the screen edge. "completed" is shortened to "done" in the count only; the filter tab still reads "Completed".

## [0.22.6] - 2026-07-18

### Added

- **Delete "This and following events" on a recurring series** — the delete dialog for a recurring event now offers a third option alongside "This event" and "All events", removing the selected occurrence and every one after it while leaving earlier occurrences intact. Works across timed, all-day, and sub-daily recurrences. ([#54](https://github.com/Ivan-Malinovski/calino/pull/54), thanks [@gbPagano](https://github.com/gbPagano)!)
- **Type compact times in event forms** — the time field now accepts a bare digit string like `930` or `1400` and expands it to `9:30` / `14:00`, so you don't have to type the colon. ([#55](https://github.com/Ivan-Malinovski/calino/pull/55), thanks [@gbPagano](https://github.com/gbPagano)!)

### Fixed

- **Recurring events shared across CalDAV resources no longer corrupt each other on sync** — editing one occurrence could bleed into sibling series stored in the same resource; masters and overrides are now serialized atomically, detached/cancelled instances are preserved, timed `EXDATE` values are matched exactly, and categories survive an occurrence edit. ([#54](https://github.com/Ivan-Malinovski/calino/pull/54), thanks [@gbPagano](https://github.com/gbPagano)!)
- **Settings → Appearance layout cleanup** — the Light/Dark/System mode picker now uses the same "label, then a row of cards" layout as the theme palette pickers below it, instead of being crammed into the right side of a row with a large empty gap. The palette grids are aligned with the rest of the panel (they previously bled slightly to the left), and section dividers now sit between groups so each heading reads as belonging to the cards beneath it.
- **Cramped "Back" button on mobile settings** — the chevron sat flush against the button's left edge; it now has even internal spacing.
- **Default Duration dropdown was too wide** — it stretched far past its short options ("15 min", "Custom…"); it's now sized to its content, which also leaves room for the inline minutes field when "Custom…" is selected.

## [0.22.5] - 2026-07-16

### Fixed

- **CalDAV settings sync now works on servers that don't use a `d:` XML namespace prefix (e.g. Fastmail)** — `discoverSettingsCalendar`/`fetchSettingsEvent` parsed WebDAV multistatus responses with regexes hardcoded to a literal lowercase `d:` prefix; since WebDAV namespace prefixes are arbitrary per spec, servers that emit a different prefix (or none) made calendar/event discovery silently fail even after the settings calendar had already been created. Parsing now goes through `DOMParser` with namespace-aware lookups instead. Closes [#52](https://github.com/Ivan-Malinovski/calino/issues/52).
- **Settings sync failures are no longer silent** — a failed push or auto-discovery only set internal error state, visible solely in the settings panel's inline text. Both now also surface an error toast, so a sync problem is never invisible.

## [0.22.4] - 2026-07-15

### Added

- **Configurable map provider for event locations** — event locations opened Google Maps unconditionally; Settings → Calendar now has a "Map Provider" option covering Google Maps, Apple Maps, OpenStreetMap, mapy.com, or a generic `geo:` link for device-default apps like OsmAnd or CoMaps. Closes [#48](https://github.com/Ivan-Malinovski/calino/issues/48).
- **Swipe left/right to change month** — month view already supported swiping up/down; it now also supports the horizontal swipe most calendar apps use, on both touch gestures and trackpad/touch input. Closes [#47](https://github.com/Ivan-Malinovski/calino/issues/47).
- **Optional week numbers in the sidebar mini calendar** — Settings → Calendar has a new "Show Week Numbers in Sidebar" toggle (off by default) that adds ISO week numbers next to each row of the mini calendar, also reachable from the command palette. Closes [#49](https://github.com/Ivan-Malinovski/calino/issues/49).
- **Custom color picker for categories** — pick any color for a category, not just the preset swatches. ([#51](https://github.com/Ivan-Malinovski/calino/pull/51), thanks [@gbPagano](https://github.com/gbPagano)!)
- **Catppuccin theme with configurable accents** — a new Catppuccin (Mocha) theme option alongside a configurable accent color. ([#50](https://github.com/Ivan-Malinovski/calino/pull/50), thanks [@gbPagano](https://github.com/gbPagano)!)

### Fixed

- **Mobile split-view day panel now stays in sync with the sidebar** — the bottom day panel in month view's mobile split layout tracked its own local state instead of the shared current date, so picking a day in the sidebar while another day was already open had no effect. Closes [#46](https://github.com/Ivan-Malinovski/calino/issues/46).

## [0.22.2] - 2026-07-12

### Added

- **Ctrl/Cmd+drag to duplicate an event** — hold Ctrl (or Cmd on Mac) while dragging an event and it copies instead of moves: the original stays put, the card you're dragging shows a duplicate badge, and dropping it creates the copy at the new time/day. Works in Week, Day, and Month view, including all-day and multi-day events.
- **Ctrl/Cmd+click to duplicate an event** — a one-click shortcut for the existing right-click → Duplicate action.

### Fixed

- **Settings sync now actually applies on a fresh device** — settings were being written under a per-instance UID (`calino-settings-<uuid>`), so a second device signing into the same CalDAV account could never find them. The auto-discovery branch silently fired a misleading "Settings sync enabled" toast while no settings were applied. The UID is now the literal `calino-settings` (safe because the event lives in its own dedicated calendar collection), and the success toast is gated on whether we actually pulled and applied a remote payload vs. just discovered an empty collection.
- **Privacy Policy page is scrollable on mobile** — the page had no internal scroll container, so on narrow/short viewports the lower sections were clipped with no way to reach them.
- **Privacy policy accuracy corrections** — the CalDAV credential storage bullet now describes it accurately as obfuscation (a key shipped in the app) rather than encryption, and the CORS proxy section now discloses that the full request URL is visible to the proxy — not just the server hostname — since some CalDAV servers embed your username in the path.

## [0.22.1] - 2026-07-12

### Added

- **Delete individual duplicate-UID events from Data Issues** — when a duplicate-UID collision is detected (bulk-copied CalDAV resources that illegally share a UID), each conflicting resource now has its own Delete button, so you can remove a specific one instead of only dismissing the whole report.

### Fixed

- **A recurring event mirrored into more than one CalDAV collection no longer shows up twice** — the same UID appearing in a second collection on the server (e.g. a scheduling/aggregate calendar alongside the real one) was being added as a duplicate entry instead of being recognized as the same event.

## [0.22.0] - 2026-07-12

Subscribe to any `.ics`/`webcal://` feed as a read-only calendar, plus task-hierarchy and CalDAV compatibility improvements from our first outside contributor, a smoother agenda sidebar, and a round of journal, command palette, and sidebar fixes.

### Added

- **Webcal / .ics calendar subscriptions** — add a read-only calendar from any `webcal://` or `https://…ics` URL (holiday calendars, sports schedules, a shared Google/Outlook feed's public link). Calino fetches and parses it on a schedule you choose (15 min to 24 hr) and keeps it in sync; events from a subscription can't be edited, moved, or deleted in Calino since they belong to the source feed. Subscribe from the sidebar's **+** menu or from Settings → Sync, where existing subscriptions can be renamed, resynced on demand, or removed. Closes an item that's been on the roadmap since 0.20.0.
- **Self-hosted webcal subscriptions in `calino.config.json`** — self-hosters can now preconfigure `.ics` subscriptions the same way as CalDAV accounts: encrypt the URL with a master password (via the `/setup` wizard or `scripts/encrypt-password.mjs --webcal-url`) and it auto-subscribes for every user who unlocks with that password. See `docs/SELF_HOSTED_CONFIG.md`.
- **Tasks without a due date can be created from the UI** — Calino already rendered undated tasks in their own "No due date" section, but the task composer always required a date, so there was no way to create one. ([#32](https://github.com/Ivan-Malinovski/calino/pull/32), thanks [@gbPagano](https://github.com/gbPagano)!)
- **Drag a task onto another to nest it as a subtask** — dropping a task anywhere that isn't over another task row promotes it back to the top level, with a subtle inset-ring hint while dragging. Parent rows with hidden children show a subtask-count badge, and completing a parent completes its descendants too.

### Changed

- **CalDAV calendars only show where they're usable** — the calendar picker in the event modal now only lists calendars that support events when creating an event, and only ones that support tasks when creating a task; the Tasks view hides tasks from calendars that don't have tasks enabled. Calino also rediscovers calendars (and their capabilities) on every sync and after a reload, so a calendar added on the server shows up without reconnecting the account. ([#30](https://github.com/Ivan-Malinovski/calino/pull/30), thanks [@gbPagano](https://github.com/gbPagano)!)
- **Journal entries are easier to edit** — a pencil icon now appears on hover/focus to enter edit mode (previously required a double-click or keyboard shortcut), and clicking anywhere on the entry row works too.
- **Command palette** — added a "Toggle Contacts" command and direct navigation to the Tasks view; search now uses plain substring matching on label/keywords/description instead of `cmdk`'s fuzzy filter, which was matching unrelated commands.
- **Sidebar task count includes all future tasks**, not just the next 7 days.

### Fixed

- **Time format preference applies in event and task forms**, undated tasks no longer show up in date-based schedule views, and a `PRIORITY:0` from a CalDAV server is now correctly treated as "no priority" rather than "highest priority". ([#33](https://github.com/Ivan-Malinovski/calino/pull/33), thanks [@gbPagano](https://github.com/gbPagano)!)
- **Journal's click-outside-to-close** no longer fights with React's render timing (removed in favor of Escape/Close, matching the event modal's behavior).
- **Compact all-day event pills with a location** no longer show a stray "·" separator where the (hidden) time and location used to be.
- Native selects, dropdowns, dates, and times now follow the dark theme consistently, and the category filter no longer requires a hover to open (it's click-to-expand, keyboard- and touch-friendly).

### Contributors

Thanks to [@gbPagano](https://github.com/gbPagano) (Guilherme Pagano) for their first contributions to Calino — three PRs covering CalDAV calendar/task capability handling, subtask support, due-date-optional task creation, and several sync-compatibility fixes. 🎉

## [0.21.0] - 2026-07-09

Tasks now appear on the Week and Day timelines, dragging events is precise to the quarter hour, and a round of fixes for issues you reported.

### Added

- **Test connection and edit your CalDAV accounts** — each account in Settings → Sync now has a **Test** button that checks the connection and reports what went wrong (a wrong password, a wrong URL, or a server that won't allow the request), and an **Edit** button to change the account name, server URL, proxy, username, or password without disconnecting and starting over. Leave the password blank to keep the current one. If you change the server URL or username, Calino re-fetches the calendars for the new account, keeping the colors and visibility of any that carry over. ([#24](https://github.com/Ivan-Malinovski/calino/issues/24))
- **Timed tasks show up on the timeline** — a task with a due time now renders as a pill at that time in Week and Day view, instead of only living in the all-day row. Tasks due at the same time sit side-by-side rather than stacking on top of each other, and the due time is no longer repeated on the card itself now that its position says it.
- **15-minute drag precision** — dropping an event now snaps to the nearest quarter hour, so an event can finally land on 9:45–10:45. Previously a drop resolved only to the hour of the cell you released it over. While you drag, a preview band marks exactly where the event will land, sized to its real duration. Moving an event that started off-grid cleans up its start time.

### Changed

- **Adding a calendar is faster and can't double-add** — the Add Calendar dialog used to test the connection first and then connect, doing the same round-trip twice before anything was saved. It now just connects, reporting the same errors and hints if it can't. While it works, the button shows a spinner and "Saving…", so a double-tap can no longer add the same calendar twice.

### Fixed

- **Calendars with duplicate UIDs no longer scramble** — if your server stores several independent events that share one unique ID (invalid, but produced by some clients and accepted by servers like Baikal), Calino used to collapse them into one: only one of them rendered, events jumped onto another event's date, and the calendar looked different on every refresh. Calino now detects the collision, keeps one event deterministically so rendering is stable, and lists the affected events under Settings → Data Issues with an explanation of how to fix them on your server. Recurring events with exceptions are unaffected. ([#22](https://github.com/Ivan-Malinovski/calino/issues/22))
- **Categories flyout stays open long enough to use** — the category picker opened on hover and vanished before you could click anything, especially when your pointer crossed the gap between the trigger and the menu. It now has a short close delay and the gap no longer counts as leaving. ([#23](https://github.com/Ivan-Malinovski/calino/issues/23))
- **Theme toggle is back on mobile** — the Auto → Light → Dark toggle added for desktop was missing on small screens. Quick settings now live behind a sub-button next to Settings on the mobile action button. ([#26](https://github.com/Ivan-Malinovski/calino/issues/26))
- **Task checkboxes are tappable** — the checkbox on a task pill was a 15px target sitting under the card's drag layer, so taps usually hit the event body and opened it instead of ticking the task. The tap area is now roughly 27px and sits above the drag layer, while staying small enough not to catch a stacked neighbour's checkbox. ([#25](https://github.com/Ivan-Malinovski/calino/issues/25))
- **Multi-day events stay on one line across their span** — a multi-day event's pill could step up or down a row partway through its span, because each day cell sorted its events independently. Spanning events are now assigned a lane once and hold that row in every cell they cover. The `+N more` count is unaffected.
- **Tasks in Week view render as cards** — timed task cards were being positioned in the time grid as though they were events; they now render like they do in Month view.
- **Recurring all-day events are clickable in month view** — clicking a recurring all-day card in /month used to do nothing: the card _looked_ clickable (pointer cursor, no drag handle) and the click reached the card's handler, but the preview popup never appeared. All-day instance ids are encoded as `master-2024-03-15`, while `extractOriginalEventId` only matched the full-timestamp form used for timed events, so the preview lookup silently resolved to undefined. The lookup now also matches the date-only suffix, and the click opens the preview → modal as expected.

### Technical

- **Build works again** — `CalDAVConnectionError` was using TypeScript's parameter-property syntax (`public readonly hint?: string` in the constructor) which the tsconfig's `erasableSyntaxOnly` flag rejects, so `pnpm build` (and the release script) failed with TS1294 on this file. The field is now declared explicitly and assigned in the constructor. Runtime shape is unchanged; existing tests still pass.

## [0.20.1] - 2026-07-08

A small patch of theming and dark-mode fixes.

### Fixed

- **Mobile day selection now respects your theme** — the selected day in the sidebar mini-calendar used the default (brown) accent instead of your active theme's color on non-default themes. It now derives its highlight from the current theme, so custom themes look right too. ([#20](https://github.com/Ivan-Malinovski/calino/issues/20))
- **No more tap-highlight flash on mobile** — tapping buttons and links no longer shows the browser's default gray/blue overlay. The highlight color is now a themeable token if you want it back. ([#21](https://github.com/Ivan-Malinovski/calino/issues/21))
- **Dark-mode color leaks** — fixed several spots that fell back to light-mode colors in dark mode: the Add Calendar connection-hint box, Year-view hover states, and the contacts tag-filter chip.

## [0.20.0] - 2026-07-08

A large audit-driven release: security hardening, iCalendar compliance for strict CalDAV servers, a full accessibility pass, major performance work, a new 3-day view, and a round of animation and connection-reliability polish.

---

### 👤 User-facing

Things you'll actually notice using Calino.

**New**

- **3-day view** — a new zoom level between Day and Week, with a resizable agenda sidebar that now persists across every view.
- **3-state theme picker** — the quick-settings theme toggle cycles Auto → Light → Dark, so you can return to "follow system" without opening the settings page. It now sits at the top of the quick-settings dropdown with clearer mode icons.
- **Keyboard shortcuts help modal** — press `?` anywhere to see every shortcut; Escape closes it.
- **Deep-link support** — links like `?date=2026-07-08&event=<id>` open the right day and event.
- **Empty states** — Agenda, Tasks, and the sidebar calendar list show a helpful message and action button instead of blank space.

**Improved**

- **More reliable connections** — Fastmail and other providers that used to 404 during setup now connect: Calino auto-expands provider URLs, tries the `caldav.` subdomain, and follows cross-domain redirects.
- **Missed reminders catch up** — if your tab was asleep and missed a reminder, the next active visit fires anything from the last 12 hours that was never shown.
- **Smoother, faster calendar** — event layout uses an O(n log n) sweep-line (was O(n³)), window resizing is frame-rate throttled, search index rebuilds run during idle time, and Agenda grouping is O(N). Busy calendars render noticeably faster.
- **Polished animations** — refined enter/exit transitions for events and the view-switcher menus, faster fade-outs, and full reduced-motion support. The event you're actively dragging no longer animates out from under you.
- **Saving feedback** — the event modal shows a spinner and "Saving…" label while a save is in flight, and rapid clicks can no longer create duplicate events.
- **Recurring events are safer to touch** — drag-and-drop and resize are disabled for recurring events, preventing accidental one-off edits to a series.
- **Better sync with strict servers** — RRULE, EXDATE, RECURRENCE-ID, and VALARM now use correct value forms (VALUE=DATE for all-day, matching TZID for timezone-aware events), so Radicale, iCloud, and Google Calendar accept edits cleanly. Task status/percent-complete round-trip faithfully, and day/week-duration reminders are preserved.
- **Lossless ICS export** — exporting `.ics` keeps recurrence rules, exceptions, reminders, and all-day date forms.
- **Accessibility pass** — icon-only buttons get `aria-label`s, the onboarding modal traps focus and honors Escape, the error dialog is themed, and iOS PWA gets safe-area insets.
- **Smaller papercuts** — end-before-start validation in the event modal, a toast when notification permission is denied, "Go to Today" that stays correct across midnight, todo-composer text carried into the modal, and rounder `/tasks` & `/journal` selectors.

**Security fixes you benefit from**

- Patched high-severity CVEs in `react-router-dom` and `vite`.
- The bundled CORS proxy no longer forwards Authorization headers to arbitrary hosts, no longer echoes a wildcard origin when allowed origins are set, and no longer leaks fetch errors.
- The service worker validates event IDs before using them in navigation URLs.
- Settings are no longer wiped during an app data migration.

---

### 🤓 Technical

For the curious — the interesting bits under the hood.

- **Rendering** — `eventPositioning` rewritten as a sweep-line with a tight `totalColumns` scan; range/version counters drive the memoization deps so recomputes only happen on real changes.
- **Animations** — `AnimatePresence` uses `initial={false}`; a shared `eventAnimations` helper centralizes the reduced-motion pattern and skips exit animation for the actively-dragged element. Conditional wrappers removed to keep keys stable across renders.
- **CalDAV discovery** — `discovery.ts` gained provider-URL expansion, `caldav.` subdomain fallback, and cross-domain redirect handling, with ~200 lines of new tests.
- **iCalendar adapter** — correct VALUE=DATE / TZID emission, VTODO STATUS + percent-complete + COMPLETED preservation, VALARM day/week durations, multibyte-safe line folding, and settings-event serialization with proper folding/escaping. Round-trip tests cover TZID, RRULE WKST/BYSETPOS, and VTODO.
- **ETag handling** — create/update now capture the server URL and ETag (including etag-on-create recovery) so the next sync doesn't drop edits.
- **State** — Zustand migrations merge persisted state over defaults rather than discarding unknown keys; `partialize()` keys and calendar positions survive version bumps. `safeLocalStorage.clear()` sweeps both `calino-` and `calino_` prefixes.
- **Proxy** — `https://`-only scheme validation, restricted header allowlist, an SSRF denylist, generic error responses.
- **Types/routing** — `'3day'` added to `VIEW_ROUTES` and the settings store; per-BYDAY field renamed `bySetPos → byDayOrdinals`.
- **Infra** — service worker cache bumped to `calino-v7`; Docker Caddy request-body limit raised 1 KB → 1 MB; dev server defaults to `localhost`; e2e (Playwright) infra + specs for drag-disabled recurring events, animation, and month delete; `pnpm lint` at 0 errors; `tsc -b` project-reference type errors fixed.

### Known Limitations

- **All-day reminders fire N minutes before midnight the day before** — this matches the iCalendar spec (reminders are relative to DTSTART). The 12-hour catch-up pass (see above) covers the common case where the tab was inactive, but reminders older than 12 hours won't fire.
- **App-level encryption is obfuscation, not security** — credentials in localStorage are encrypted with a key bundled in the app. Anyone with the JavaScript bundle can derive the same key and decrypt stored CalDAV credentials. For stronger protection, use the master-password setup wizard (`/setup`), which derives the encryption key from a user-supplied password that never leaves the device.

### Deferred (roadmap)

- Recurrence preview before saving changes
- Periodic remote pull / background sync
- Install-prompt UX (beforeinstallprompt)
- Conflict-resolution UI for "ask" sync mode
- Saved searches
- Hourly, minutely, and secondly recurrence frequencies
- Subtasks
- Email reminders
- Internationalization (i18n)
- Invitations and RSVP
- share_target PWA
- Periodic background sync

## [0.18.0] - 2026-07-05

### New Features

- **Undo and redo** — made a change you didn't mean to? Undo and redo now work across event edits, moves, deletes, and calendar changes, so you can step back and forward through your recent actions.
- **Live "now" line** — day and week views now show a red line marking the current time, with a time label that updates as the day goes on.
- **Type dates right into the title** — when creating an event, natural phrases like "lunch tomorrow at 1" or "dentist next friday" are recognized inline and fill in the date and time for you.
- **Smarter defaults** — Calino learns from your habits: recurring event names now pre-select the calendar and duration you usually give them.
- **Jump to a week from the year view** — ISO week numbers in the year view are now clickable and take you straight to that week.
- **Two-finger swipe between views** — swipe horizontally with two fingers on a touchscreen to move between calendar views.
- **More control over reminders** — task reminders now have real on/off toggles, and events can carry multiple reminders.

### Improvements

- **App keeps running if one part hiccups** — each major area now has its own safety net, so a problem in one view no longer takes down the whole app; you'll see a gentle notice if a background sync fails.
- **Better keyboard and screen-reader navigation** — arrow keys move across the month grid, a single Tab enters it, modals keep focus inside them, and Esc dismisses event previews.
- **Faster rendering** — month, week, and day views redraw more efficiently, especially on busy months.
- **Simpler sync settings** — removed the auto-sync toggle from settings in favor of consistent background syncing.

## [0.17.1] - 2026-07-04

### New Features

- **More events get automatic icons** — added icon matching for bouldering (mountain), meditation and mindfulness (gym), and cleaning/chores (laundry).
- **Self-hostable CORS proxy** — if your CalDAV server can't send CORS headers, you can now run Calino's own lightweight proxy instead of relying on Cloudflare or editing your reverse proxy. If you already run Calino with Docker, enable it alongside the app with a single command (`docker compose --profile proxy up -d`) and point the Proxy URL in settings at it. It can also run standalone or as a Cloudflare Worker.

### Bug Fixes

- **Settings sync behind a CORS proxy** — the documented proxy configuration was missing the WebDAV methods (`MKCOL`, `COPY`, `MOVE`) that settings sync needs, and didn't follow `.well-known` redirects, so discovery and settings sync could fail. The bundled/hosted proxy and the docs now include everything required.

## [0.17.0] - 2026-07-01

### New Features

- **Automatic event icons** — events now show a small icon matched to their title: a coffee cup for "Coffee with Sam", a mountain for "Morning hike", a dumbbell for "Gym", and so on across dozens of everyday categories (meetings, calls, travel, meals, appointments, shopping, and more). Icons appear on full-size event cards and in the event preview. Turn them on or off under Settings → Appearance → "Event icons".
- **Anniversary reminders for contacts** — anniversaries stored on your contacts now appear as recurring reminders on your calendar, so you won't miss them.
- **Tap the header to jump back to month view** — clicking the date title in the header now takes you back to month view from anywhere else in the app. When you're already in month view, it still jumps to today.

### Bug Fixes

- **No more false sync errors when offline** — Calino no longer shows sync-failure notifications while you're offline; it waits until you're back online.
- **Multi-day event dragging lands correctly** — dragging a multi-day event in month view now drops it on the right dates instead of being offset.
- **Cleaner agenda locations** — event locations in the agenda no longer show up as a blue underlined web link; they now read as normal themed text (and are still tappable to open in Google Maps).
- **View switcher no longer starts misaligned** — the highlighted pill in the Month/Year/Week view switcher occasionally appeared shifted to the left on load; it now lines up correctly and re-aligns after fonts load or the window resizes.
- **Custom theme switching** — switching between custom themes now updates correctly.

### Improvements

- **Smoother calendar views** — more consistent open/close animations, multi-day events highlight across all their days on hover, and indented event fragments line up correctly in month and week views.

## [0.16.3] - 2026-06-30

### New Features

- **Event locations open in Google Maps** — an event's location is now a tappable link that opens the address directly in Google Maps.

### Bug Fixes

- **Calendar renaming now sticks** — renaming a synced (CalDAV) calendar could silently snap back to the old name if the server rejected the change. Your rename is now kept locally and the server is updated in the background; if the server refuses, you get a notice instead of losing the new name.
- **Deleted events no longer reappear** — an event you deleted could linger locally after the deletion was retried and succeeded on the server. It's now properly removed.
- **Month view shows all visible events** — events landing on the trailing/leading days of adjacent months (the greyed-out days that fill out the month grid) were missing and now show up again.
- **Search stays current after sync** — search results no longer show stale matches after a background sync; the index refreshes so results reflect your latest events.

### Improvements

- **Faster calendar views** — month, week, and day views render noticeably faster, especially on months with many recurring events.
- **Faster sync** — syncing accounts with large numbers of events is quicker.
- **Smoother event previews** — hovering to preview an event no longer re-renders the entire event list.
- **Cleaner location links** — location links no longer carry a permanent underline.

## [0.15.2] - 2026-06-20

### Bug Fixes

- **CalDAV URL discovery** — server URL input is now respected. Uses RFC 6764 `.well-known/caldav` discovery instead of hardcoded `/dav.php`. (#11)
- **Broken events** — events with start > end are now stored instead of silently dropped. New "Data Issues" tab in Settings shows and lets you fix/delete them.
- **Spanning day pills** — multi-day events in month view connect properly into one visual pill again.
- **Bauhaus theme** — fixed component overrides not matching (missing descendant combinator in selectors), event card left border, view switcher indicator height/position.
- **Brutalist theme** — fixed Today/AddTask border-radius, modal Save button styling, dark mode white borders toned down.

### Improvements

- **Theme system** — extracted `--view-switcher-indicator-height`, `--modal-card-border`, `--modal-save-shadow` variables to reduce theme override duplication.
- **View switcher indicator** — shared `data-component` between CalendarHeader and TodoView so one theme rule covers both.
- **Removed flaky `barrelExports` test** — redundant with TypeScript compilation.

## [0.15.0] - 2026-06-19

### New Features

- **Theme system** — choose independent light and dark themes in Settings → Theme. Switch between Light, Dark, and System modes. System mode automatically follows your OS preference.
- **9 new themes** — Slate (dark), Mist (light/dark), Mist Green (light/dark), Xiaohongshu (light/dark), Bauhaus (light/dark), Brutalist (light/dark)
- **Theme preview cards** — visual color swatches in settings show each theme's palette at a glance
- **Custom theme template** — create your own theme by dropping a `.css` file into `public/themes/`. A comprehensive template with all CSS variables and data-component selectors is included. See [docs/THEMING.md](./docs/THEMING.md) for the full guide.

### Improvements

- **Event preview popup** — frosted glass backdrop, accent-colored hover states, cleaner shadow
- **Event modal** — refined double-bezel shadow, removed accent color band for a calmer look
- **Multi-day events** — improved fragment rendering in week and day views with consistent styling
- **Settings UI** — new theme selector grid with live preview cards, cleaner toggle switches

### Internal

- Comprehensive CSS variable token system (97 variables) for full theme control
- `data-component` attributes on all major UI elements for theme targeting
- `data-theme-id` attribute on `<html>` for scoped component overrides
- Theme template with documented CSS variables, data attributes, and examples
