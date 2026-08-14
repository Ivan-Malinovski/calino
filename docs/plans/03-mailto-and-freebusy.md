# Plan: Mailto Meeting Invitations & CalDAV Free/Busy Availability

## 1. Overview & Goal

Equip Calino with meeting invitation and scheduling capabilities without requiring a dedicated server or backend:
1. **`mailto:` Meeting Invitations**: One-click dispatch of meeting invites via the user's default email client (Thunderbird, Apple Mail, Outlook, webmail) with formatted event details and direct `.ics` attachment download.
2. **CalDAV Free/Busy Query**: Query attendee availability from the user's connected CalDAV server alongside local calendar schedule intersection.

> **These two halves are independently shippable and should be separate PRs.**
> Part A is a self-contained ~200-line utility plus two buttons. Part B depends
> on server behaviour Calino cannot control and may not work at all against a
> given server (see the reality check below). Do not let B block A.

### Reality check on free/busy

- The spec reference is wrong in the original draft: `<C:free-busy-query>` is
  **RFC 4791 §7.10** (CalDAV). RFC 4795 is LLMNR, unrelated. Scheduling-aware
  free/busy lookups for *other* people are **RFC 6638 §4.1** — a `POST` of a
  `VFREEBUSY` `METHOD:REQUEST` to the organizer's **scheduling Outbox**.
- `free-busy-query` is a `REPORT` against **a calendar collection you can
  already read** — i.e. it answers "when am *I* busy", not "when is
  `colleague@example.com` busy". Answering the latter requires the Outbox POST,
  and only on servers that advertise `calendar-auto-schedule` in the `DAV:`
  header and share a scheduling domain with the attendee.
- Therefore: **expect `unknown` to be the common result**, and design the UI so
  `unknown` is the unremarkable default rather than a visible failure.
- CORS: browser requests go through the existing proxy path in
  `CalDAVClient` (`proxyFetch` / `proxyUrl`). A direct `POST`/`REPORT` from the
  page to an arbitrary CalDAV host will be blocked. Any new request must go
  through the same plumbing.

---

## 2. User Experience & Flows

### A. `mailto:` Meeting Invitations
1. When editing or viewing an event with attendees in [`AttendeeSection.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/AttendeeSection.tsx) or [`EventPreviewPopup.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/EventPreviewPopup.tsx):
2. A button **"Email Attendees"** (`data-component="email-attendees-btn"`) is displayed.
3. Clicking it opens a `mailto:` link with:
   - `to`: comma-separated attendee emails (excluding user's own email).
   - `subject`: `Invitation: [Title] - [Formatted Date/Time]`.
   - `body`: Human-friendly meeting invite text detailing when, where, video link/location, description, organizer, and RSVP note.
4. An accompanying **"Copy .ics Invitation"** / **"Download .ics"** button allows the user to quickly attach the `.ics` file to their email draft.

### B. Free/Busy Availability Checks
1. In [`AttendeeSection.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/AttendeeSection.tsx), when adding or viewing attendees for a scheduled time slot:
2. An availability check is executed:
   - **Local Store**: checks if any attendee email matches known accounts/contacts with events in the same time slot across local calendars. This is the path that will actually fire most of the time.
   - **CalDAV Server (RFC 6638 scheduling Outbox, RFC 4791 `free-busy-query` for the user's own calendars)**: only for accounts whose `OPTIONS`/`DAV:` header advertises `calendar-auto-schedule`; otherwise skip silently and report `unknown`.
   - Checks are **debounced** and fire on time-range change, not per keystroke, and are cancelled when the modal closes.
3. Attendee rows display status badges:
   - 🟢 **Available** (no overlapping busy periods).
   - 🔴 **Busy** (has a conflicting event at this time).
   - ⚪ **Unknown / External** (availability could not be retrieved) — the default, and visually quiet.

   Colour alone must not carry the meaning: pair each badge with a text label and an `aria-label`, and don't rely on emoji glyphs rendering consistently across the desktop and Android WebView builds.
4. If conflicts exist, a clear banner is shown above the save button: *"1 attendee has a scheduling conflict at this time."* It is advisory — it never blocks saving.

---

## 3. Architecture & Key Files

### Existing Code to Reuse
- [`src/features/calendar/components/AttendeeSection.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/AttendeeSection.tsx): attendee list and form fields.
- [`src/features/caldav/client/CalDAVClient.ts`](file:///var/home/ivan/dev/calino/src/features/caldav/client/CalDAVClient.ts) — note the capitalized filename and that it is a **class**, not a module of free functions. It exposes no generic `request(...)` method; the reusable pieces are the private `proxyFetch`, `authHeader`, `assertResponseOk`, and `findCalendarHomeFromPrincipal`. A free/busy query therefore belongs as a **method on this class** (or requires deliberately widening its surface), not as a standalone module reaching into internals.
- [`src/features/caldav/adapter/iCalendarAdapter.ts`](file:///var/home/ivan/dev/calino/src/features/caldav/adapter/iCalendarAdapter.ts): `ical.js` parsing for `VFREEBUSY` blocks.
- [`src/store/calendarStore.ts`](file:///var/home/ivan/dev/calino/src/store/calendarStore.ts): access to all user events and calendars.

### New Components & Utilities
1. `src/lib/mailtoInvite.ts`:
   - `buildMailtoUri(event, attendees: CalendarAttendee[], organizer?)`: constructs an RFC 6068 URI with encoded subject and body. (`CalendarAttendee` exists in `src/types/index.ts`; confirm the organizer type name before writing the signature — the draft's `CalendarOrganizer` was not verified.)
   - `formatInviteBody(event: CalendarEvent)`: clean plain-text invitation template.
   - **Length guard**: `mailto:` URIs are truncated by many clients and by Windows' shell at ~2000 characters. Truncate the description with an ellipsis and keep the total under a documented cap; unit-test the cap.
2. `src/features/caldav/client/freeBusy.ts` (or a method on `CalDAVClient`):
   - `fetchFreeBusy(attendeeEmail, startIso, endIso)`: RFC 6638 Outbox `POST` for other attendees; RFC 4791 `REPORT <C:free-busy-query>` against the user's own calendar collection for self.
   - Guarded by a capability probe (`calendar-auto-schedule` in the `DAV:` header); returns `null` — meaning "unknown" — rather than throwing when unsupported.
   - Parses `VFREEBUSY` `FREEBUSY` properties into `Array<{ start: Date, end: Date, type: 'BUSY' | 'BUSY-UNAVAILABLE' | 'BUSY-TENTATIVE' }>`, treating a missing `FBTYPE` as `BUSY` per spec.
3. `src/lib/freeBusyCalculator.ts`:
   - `checkAttendeeAvailability(attendeeEmail: string, startIso: string, endIso: string, localEvents: CalendarEvent[], freeBusyPeriods?: FreeBusyPeriod[])`: returns `'available' | 'busy' | 'unknown'`.

### Modified Components
1. `src/features/calendar/components/AttendeeSection.tsx`:
   - Add "Email Attendees" button.
   - Add availability pill/icon next to each attendee.
   - Add conflict warning banner when `isBusy` is detected.
2. `src/features/calendar/components/EventPreviewPopup.tsx`:
   - Add "Email Attendees" quick action when event has attendees.

---

## 4. Implementation Steps

1. **Step 1: Mailto Invitation Generator (`src/lib/mailtoInvite.ts`)**
   - Implement `formatInviteBody` with clean date formatting, location, description, and link lines.
   - Implement `buildMailtoUri` properly encoding special characters via `encodeURIComponent`.

2. **Step 2: Add Email Affordance in UI**
   - In `AttendeeSection.tsx`, render `<button className={styles.emailButton} onClick={handleOpenMailto}>Email Attendees</button>` when `attendees.length > 0`.
   - In `EventPreviewPopup.tsx`, add an email icon action button when attendees exist.

3. **Step 3: Free/Busy Query Implementation** *(separate PR — see the reality check in §1)*
   - Probe support first: `OPTIONS` on the principal URL, look for `calendar-auto-schedule` in the `DAV:` header. No support → return `null` and stop.
   - Self / own-calendar case, `REPORT` against a calendar collection (RFC 4791 §7.10):
     ```xml
     <C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">
       <C:time-range start="20260817T080000Z" end="20260817T180000Z"/>
     </C:free-busy-query>
     ```
     Note the response body is `text/calendar` (a `VFREEBUSY`), **not** multistatus XML with `<C:calendar-data>`.
   - Other-attendee case, `POST` to the scheduling Outbox (RFC 6638 §4.1) with an
     `Originator`/`Recipient`-style `VFREEBUSY METHOD:REQUEST` body; parse the
     per-recipient `<C:response>` statuses, mapping `3.7` / `5.x` to `unknown`.
   - Route both through `CalDAVClient`'s proxy fetch and auth header; a raw `fetch` will fail CORS.
   - Parse `VFREEBUSY` periods with `ICAL.Component`, expanding `PERIOD` values in both `start/end` and `start/duration` forms.
   - Cache per (email, range) for the lifetime of the modal; never re-query on every render.

4. **Step 4: Local Store Conflict Check & UI Badges**
   - Compute overlapping events from local calendars for the same user/account.
   - Render green (Free) / red (Busy) status indicators next to attendees in `AttendeeSection.tsx`.

---

## 5. Verification & Testing

### Unit Tests
- `src/lib/__tests__/mailtoInvite.test.ts`: verify `mailto:` URL structure, parameter encoding, and formatting with various event configurations (all-day, recurring, with location/links).
- `src/lib/__tests__/freeBusyCalculator.test.ts`: test overlap calculation between event time ranges and `VFREEBUSY` intervals.

- `freeBusy.test.ts`: parsing a real `VFREEBUSY` response, `start/duration` periods, missing `FBTYPE`, and the unsupported-server path returning `null` rather than throwing.

### Playwright E2E Spec (`e2e/attendee-scheduling.spec.ts`)
- **Mailto Trigger**:
  - Create event $\to$ add attendee `colleague@example.com` $\to$ assert the "Email Attendees" control exposes a valid `mailto:` href. Never let the test actually navigate to it — that hands control to the OS mail client and hangs CI. Assert the attribute, don't click.
- **Availability & Conflict Detection**:
  - Add conflicting local event at 10:00 $\to$ create another event at 10:00 with attendee $\to$ verify attendee conflict indicator is displayed. Local-store path only; the CalDAV path is unit-tested against fixtures, not E2E.

---

## 6. Open Questions

- Attendee-to-identity matching: how do we decide that `colleague@example.com` corresponds to a local calendar whose events we can inspect? Without a mapping, the "local store" check only ever resolves the user themselves. Proposal: match against CalDAV account emails and contacts, and return `unknown` otherwise — state this explicitly before building the badges.
- Privacy: surfacing a colleague's busy times inside the event modal is a real disclosure, even though the server authorized it. Worth a line in the UI explaining where the data came from.
- Should "Email Attendees" also mark the event as having pending invitations, or is it purely a compose shortcut with no state? Proposal: no state — anything else implies a scheduling lifecycle Calino does not have.
