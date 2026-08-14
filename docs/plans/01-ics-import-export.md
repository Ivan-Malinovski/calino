# Plan: ICS Drag-and-Drop Import & Event/Calendar Export

## 1. Overview & Goal

> **Prior art — read first.** ICS import and export already exist in
> [`src/features/settings/components/DataSettings.tsx`](file:///var/home/ivan/dev/calino/src/features/settings/components/DataSettings.tsx):
> `handleExportICS` writes every event to one `VCALENDAR` (correctly handling
> `task`/`journal` types via `calendarEventToIcalVtodo` / `calendarEventToIcalVjournal`),
> and `handleFileChange` + the `ics-import-picker` modal already do file-picker
> import with a target-calendar selector, including a "create new calendar"
> option. This plan is therefore **not** new import/export — it is new
> *affordances* (drag-and-drop, per-event, per-calendar) over that logic, plus
> the extraction of the shared serialization/download code that is currently
> inline in `DataSettings.tsx`.

Widen ICS coverage to the places users actually work, without a server backend:
1. **Drag-and-Drop Import**: Drag any `.ics` file onto the calendar to trigger an import preview modal, select the target calendar, and import the events — the same flow as Settings → Data, reachable without opening Settings.
2. **Single Event Export**: Download any event as a standalone `.ics` file from the event preview or edit modal.
3. **Full Calendar Export**: Download one calendar as a multi-event `.ics` file from the calendar sidebar context menu (today's export is all-calendars-or-nothing).

---

## 2. User Experience & Flows

### A. Drag-and-Drop Import
1. User drags a `.ics` file from their OS file explorer onto Calino.
2. A semi-transparent overlay appears: *"Drop .ics file to import events"*.
3. Upon drop, Calino reads the file with `file.text()` and parses it with `parseICALData` (which covers `VEVENT`, `VTODO` **and** `VJOURNAL` — `parseICALEvent` alone silently drops tasks and journal entries, which is what the current Settings import does).
4. An **Import ICS Dialog** opens displaying:
   - File name and total number of items found.
   - List/preview of event titles, dates, and times.
   - Target calendar selector dropdown (defaults to current active/writable calendar).
   - "Import X Events" button and "Cancel" button.
5. On confirm:
   - Events are added to `calendarStore`.
   - If the target calendar is synced with CalDAV, sync queue records additions for remote sync.
   - Toast notification: *"Successfully imported X events into [Calendar Name]"*.

### B. Single Event Export
1. In `EventPreviewPopup` or `EventModal`, click the **"Export (.ics)"** action button.
2. The browser automatically downloads `[event-title].ics` containing the single VEVENT (with recurrence rules, alarms, and attendees if present).

### C. Full Calendar Export
1. In `Sidebar` (or `CalendarSettings`), click the calendar menu (`...`) $\to$ **"Export Calendar (.ics)"**.
2. Serializes all non-deleted events belonging to `calendarId` into a single `VCALENDAR` file.
3. The browser downloads `[calendar-name].ics`.

---

## 3. Architecture & Key Files

### Existing Code to Reuse
- [`src/features/settings/components/DataSettings.tsx`](file:///var/home/ivan/dev/calino/src/features/settings/components/DataSettings.tsx): `handleExportICS`, `handleFileChange`, and the `ics-import-picker` modal — the behaviour to extract and share, not to reimplement.
- [`src/features/caldav/adapter/iCalendarAdapter.ts`](file:///var/home/ivan/dev/calino/src/features/caldav/adapter/iCalendarAdapter.ts): `parseICALData` (all component types), `parseICALEvent`, `parseICALTask`, `parseICALJournal`.
- [`src/features/caldav/adapter/icalTypeMapping.ts`](file:///var/home/ivan/dev/calino/src/features/caldav/adapter/icalTypeMapping.ts): `calendarEventToIcalComponent`, `calendarEventToIcalVtodo`, `calendarEventToIcalVjournal`.
- [`src/features/carddav/lib/vCardFileUtils.ts`](file:///var/home/ivan/dev/calino/src/features/carddav/lib/vCardFileUtils.ts): `downloadFile`, `readFileAsText` — an existing blob-download helper; reuse it rather than hand-rolling `createObjectURL` a third time.
- [`src/store/calendarStore.ts`](file:///var/home/ivan/dev/calino/src/store/calendarStore.ts): `addEvent` (note: **no** `addEvents` bulk action exists — loop, as `DataSettings` does, or add one deliberately), `calendars`, `events`.
- [`src/lib/toast.ts`](file:///var/home/ivan/dev/calino/src/lib/toast.ts): user feedback notifications.

### New Components & Utilities
1. `src/lib/icsExport.ts`: extract the `VCALENDAR` assembly currently inline in `DataSettings.handleExportICS` into `buildVCalendar(events: CalendarEvent[]): string`, then layer `exportSingleEventIcs(event)` and `exportCalendarIcs(calendar, events)` on top, downloading via `downloadFile`. **`DataSettings` must be refactored onto this helper in the same change** — two copies of ICS serialization is exactly the drift this plan should avoid. Keep the existing comment explaining why `eventToICAL`/`taskToICAL` can't be concatenated (each wraps its own `VCALENDAR`).
2. `src/features/calendar/components/IcsDropZone.tsx`: full-window drag-drop interceptor.
3. `src/features/calendar/components/IcsImportModal.tsx`: review and target-calendar selection modal, generalized from the `ics-import-picker` markup in `DataSettings` (including its "create new calendar" branch) so both entry points share one component.

### Modified Components
1. `src/App.tsx`: Mounts `IcsDropZone` and `IcsImportModal`.
2. `src/features/settings/components/DataSettings.tsx`: switch export to `src/lib/icsExport.ts` and import to the shared `IcsImportModal`; keep the existing `data-action="export-ics"` / `data-testid="ics-import-*"` hooks so `src/features/settings/__tests__/DataSettings.test.tsx` keeps passing.
3. `src/features/calendar/components/EventPreviewPopup.tsx`: Adds "Export (.ics)" button.
4. `src/features/calendar/components/Sidebar.tsx`: Adds "Export (.ics)" option to calendar context menu (the same menu that hosts the webcal/subscribe entries).

---

## 4. Implementation Steps

1. **Step 1: ICS Export Utilities (`src/lib/icsExport.ts`)**
   - Extract `buildVCalendar(events)` from `DataSettings.handleExportICS` verbatim (`VERSION:2.0`, `PRODID:-//Calino//Calendar//EN`, `CALSCALE:GREGORIAN`, per-type subcomponent dispatch), then point `DataSettings` at it.
   - `exportSingleEventIcs(event: CalendarEvent)` → `buildVCalendar([event])`, download as `[event-title].ics`.
   - `exportCalendarIcs(calendar: Calendar, events: CalendarEvent[])` → filter to `calendarId`, download as `[calendar.name].ics`.
   - Sanitize filenames: strip `/`, `\`, and control characters, collapse whitespace, cap length, and fall back to `event`/`calendar` when the title is empty or non-ASCII-only.

2. **Step 2: Export Affordances in UI**
   - Add download icon/button in `EventPreviewPopup.tsx` (`data-component="export-event-ics"`).
   - Add "Export Calendar" menu item in `Sidebar.tsx` calendar options (`data-component="export-calendar-ics"`).

3. **Step 3: Drag & Drop Ingestion (`IcsDropZone.tsx`)**
   - Attach `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers at the window level.
   - Track drag depth with a counter — `dragleave` fires on every child crossing, so a naive boolean flickers the overlay.
   - Only claim the drag when `dataTransfer.types` includes `Files`; never swallow Calino's own internal event drags (`event-move`, `todo-drag-parent` and friends already use DnD, and a window-level handler that `preventDefault`s everything will break them). Verify against `e2e/event-move.spec.ts` and `e2e/todo-drag-parent.spec.ts`.
   - Validate the `.ics` extension or `text/calendar` MIME type; ignore other files rather than erroring.
   - Read via `file.text()` and parse with `parseICALData(rawText, 'preview')`.
   - Store parsed candidates in state and open `IcsImportModal`.

4. **Step 4: Import Review Modal (`IcsImportModal.tsx`)**
   - Render dialog with preview of events (`data-component="ics-import-modal"`).
   - Calendar dropdown picker (`data-component="ics-target-calendar-select"`), plus the "create new calendar" branch carried over from `DataSettings`.
   - On submit, re-parse against the chosen `calendarId`, generate fresh ids, loop `addEvent`, dismiss, and toast.
   - **Re-import semantics:** decide explicitly whether an incoming `UID` that already exists is skipped, updated, or duplicated, and say so in the modal. Today's Settings import always duplicates. See `src/features/caldav/sync/detectUidCollisions.ts` for how collisions are already reasoned about.
   - **Sync:** events added to a CalDAV-backed calendar must land in `pendingChanges` like any other local creation; confirm `addEvent` already does this rather than assuming a separate "sync queue" step.

---

## 5. Verification & Testing

### Unit Tests
- `src/lib/__tests__/icsExport.test.ts`: verify generated `.ics` syntax (VEVENT, RRULE, VALARM), that tasks/journals emit `VTODO`/`VJOURNAL`, that the output has exactly one top-level `VCALENDAR`, and filename sanitization.
- Round-trip: `buildVCalendar([event])` → `parseICALData` returns an equivalent event. This is the test that actually protects the feature.
- `src/features/calendar/components/__tests__/IcsImportModal.test.tsx`: calendar selection, new-calendar branch, import submission.
- `src/features/settings/__tests__/DataSettings.test.tsx`: must still pass unchanged after the refactor — treat any required edit there as a regression signal.

### Playwright E2E Spec (`e2e/ics-import-export.spec.ts`)
- **Export Test**:
  - Seed an event $\to$ open preview popup $\to$ click "Export (.ics)" $\to$ capture via `page.waitForEvent('download')` and assert the payload contains the event UID and title.
- **Drag-Drop Import Test**:
  - Dispatch a synthetic `drop` with a `DataTransfer` built in-page (Playwright cannot drop OS files directly; build the `File` via `page.evaluateHandle`) $\to$ verify `IcsImportModal` is visible $\to$ select target calendar $\to$ Import $\to$ assert the event card renders in the week grid.
- **Regression**: dragging an existing event within the grid still moves it and does not open the import overlay.

---

## 6. Open Questions

- Should drag-and-drop import be suppressed when no writable calendar exists (read-only subscriptions only)? Proposed: show the overlay, then an empty-state in the modal explaining why import is unavailable.
- Per-calendar export of a **subscribed** (webcal) calendar — allowed, or hidden? Proposed: allowed; it is the user's own data view.
