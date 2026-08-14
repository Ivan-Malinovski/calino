# Plan: Secondary Timezone Display

## 1. Overview & Goal

Enable users working across multiple time zones (e.g. remote teams, international clients, travelers) to display a **Secondary Timezone** alongside their primary local timezone in the Day and Week time grids.

**Scope boundary — read first.** Calino renders every date and time in the *device's* zone; the existing `timezone` field in settings is deliberately inert (see the comment above `getBrowserTimezone` in `settingsStore.ts` — its Settings picker was removed precisely because it claimed to control display and controlled nothing). This feature adds a **second read-only gutter label** and changes nothing about how events are stored, positioned, or edited. It is explicitly *not* "primary timezone override" — that is a much larger change touching event positioning, all-day boundaries, and recurrence expansion. Do not let the two merge.

---

## 2. User Experience & Flows

### A. Configuring Secondary Timezone
1. In **Settings $\to$ Calendar**, a new section **"Secondary Timezone"** is available.
2. Users can toggle "Show secondary timezone" and choose an IANA timezone (e.g. `America/New_York`, `UTC`, `Asia/Tokyo`, `Europe/London`) via a searchable select dropdown.
3. Users can optionally set a custom label (e.g., "NYC" or "HQ").

### B. Displaying in Week and Day Views
1. When enabled, [`WeekView.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/WeekView.tsx) and [`DayView.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/DayView.tsx) render a dual-column time gutter on the left.
2. The column header shows both timezone abbreviations/labels (e.g., `CEST` / `EST` or `Local` / `NYC`).
3. For each hour row (00:00 to 23:00):
   - Primary column displays local hour (e.g., `14:00`).
   - Secondary column displays the equivalent secondary timezone hour (e.g., `08:00`).
4. If a day rollover occurs across timezones (e.g., `+1` day or `-1` day), a small indicator (e.g., `+1d`) is rendered next to the secondary time for clarity.
5. The `CurrentTimeIndicator` extends across the primary time slot, secondary time slot, and the event columns.

---

## 3. Architecture & Key Files

### Existing Code to Reuse
- [`src/lib/datetime.ts`](file:///var/home/ivan/dev/calino/src/lib/datetime.ts): timezone formatting helpers.
- [`src/store/settingsStore.ts`](file:///var/home/ivan/dev/calino/src/store/settingsStore.ts): persistence for user preferences in `localStorage`.
- [`src/features/settings/components/CalendarSettings.tsx`](file:///var/home/ivan/dev/calino/src/features/settings/components/CalendarSettings.tsx): calendar settings UI.
- [`src/features/calendar/components/WeekView.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/WeekView.tsx) and [`DayView.tsx`](file:///var/home/ivan/dev/calino/src/features/calendar/components/DayView.tsx): time grid layouts.

### New & Modified Data Models
The settings shape lives in `UserSettings` in [`src/types/index.ts`](file:///var/home/ivan/dev/calino/src/types/index.ts) (there is no `SettingsState` interface); `settingsStore.ts` holds `DEFAULT_SETTINGS` and the zustand `persist` wiring.

```ts
// src/types/index.ts — UserSettings
secondaryTimezoneEnabled: boolean       // default false
secondaryTimezone: string | null        // IANA id, e.g. "America/New_York"
secondaryTimezoneLabel: string | null   // optional custom label, e.g. "HQ"
```

Add matching entries to `DEFAULT_SETTINGS` **and** to `SYNCABLE_SETTINGS` in
[`src/lib/settingsSync.ts`](file:///var/home/ivan/dev/calino/src/lib/settingsSync.ts) — otherwise the preference silently fails to follow the user across devices, and `e2e/settings-sync.spec.ts` is the place that proves it.

### Key Components to Modify
1. `src/features/settings/components/CalendarSettings.tsx`:
   - Add timezone picker with search and quick-select presets (UTC, major global business hubs).
2. `src/features/calendar/components/WeekView.tsx` & `WeekView.module.css`:
   - Expand `.timeGutter` / `.timeColumn` to support dual-column layout when `secondaryTimezoneEnabled` is true.
3. `src/features/calendar/components/DayView.tsx` & `DayView.module.css`:
   - Mirror the dual time gutter layout.
4. `src/lib/timezoneHelper.ts` (new; note `src/lib/datetime.ts` currently has **no** timezone-aware formatting at all — everything is device-local, so these helpers are genuinely new code, not wrappers):
   - `getSecondaryHourLabel(hour: number, baseDate: Date, targetTz: string, is24Hour: boolean)` computing the secondary hour and day delta.
   - Must respect the existing `timeFormat` setting (`'24h' | '12h'`) rather than introducing a parallel notion of 24-hour display.

---

## 4. Implementation Steps

1. **Step 1: Settings Store & Persistence**
   - Add `secondaryTimezoneEnabled`, `secondaryTimezone`, `secondaryTimezoneLabel` to `SettingsState` with default `false` / `null`.
   - Update settings migration and reset handlers.

2. **Step 2: Timezone Formatting Helpers (`src/lib/timezoneHelper.ts`)**
   - Implement `formatTimeInZone(date: Date, timeZone: string, use24Hour: boolean)` using `Intl.DateTimeFormat`.
   - Implement `getTimezoneAbbr(date, tz)` via `timeZoneName: 'short'`. Be aware this returns `GMT+5:30`-style strings for many zones rather than a letter abbreviation — the header must render those gracefully, and the custom label exists partly to escape them.
   - Construct `Intl.DateTimeFormat` instances **once per (zone, format)** and reuse; constructing one per hour row per render is a measurable cost in the week grid.
   - Compute the label from a real `Date` for that day, never from a fixed offset — the offset changes across DST, and the two zones' DST transitions do not coincide.

3. **Step 3: Calendar Settings UI**
   - In `CalendarSettings.tsx`, add a toggle: `"Show secondary timezone"`.
   - Add a searchable dropdown from `Intl.supportedValuesOf('timeZone')`, with a fallback curated IANA list — `supportedValuesOf` is unavailable on older WebViews, which matters for the Capacitor Android build.
   - Add optional custom label input (max 8 characters), trimmed; empty string persists as `null`.

4. **Step 4: Update WeekView & DayView Time Gutter**
   - Update `WeekView.tsx` and `DayView.tsx` time column headers to render:
     `<div className={styles.timeZoneHeaders}><span>{localLabel}</span><span>{secondaryLabel}</span></div>`
   - Render each time row with dual numbers:
     `<div className={styles.timeRow}><span className={styles.primaryTime}>{primaryTime}</span><span className={styles.secondaryTime}>{secondaryTime}</span></div>`
   - Adjust the gutter width dynamically. The gutter width is not local to the gutter: `CurrentTimeIndicator`, all-day row alignment, and drag-target math read from the same geometry. Prefer widening via a single CSS custom property (e.g. `--time-gutter-width`) consumed everywhere, over hardcoding a second width in two component stylesheets.
   - **Mobile:** the week grid is already tight on phones (`e2e/week-mobile.spec.ts`). Decide deliberately — proposal: suppress the second column below the mobile breakpoint, or stack the secondary label at reduced font size, rather than shrinking the day columns.
   - Ensure day rows that are hidden or collapsed (`compressPastWeeks`, hidden-hours logic in `src/lib/hours.ts`) still produce correct secondary labels — the label must derive from the row's actual date/hour, not from its index.

---

## 5. Verification & Testing

### Unit Tests
- `src/lib/__tests__/timezoneHelper.test.ts`: hour conversions, DST boundaries (including the spring-forward day where an hour does not exist locally, and the autumn day where one repeats), sub-hour offsets (`Asia/Kolkata` +5:30, `Australia/Eucla` +8:45 — the "secondary column shows whole hours" assumption breaks here and the design must say what it renders), and day rollovers (`+1d` / `-1d`) between Tokyo, London, Honolulu.
- Note the repo already runs its suite on both sides of UTC (commit `19d541e`); these tests must pass under both `TZ` settings.
- `src/features/settings/components/__tests__/CalendarSettings.test.tsx`: test enabling/disabling secondary timezone and selecting a zone.

### Playwright E2E Spec (`e2e/secondary-timezone.spec.ts`)
- **Settings Toggle**:
  - Open Settings $\to$ Calendar $\to$ Enable Secondary Timezone $\to$ Select `UTC` (or `America/New_York`).
- **Week & Day View Inspection**:
  - Navigate to `/week` $\to$ verify secondary timezone column appears in the time gutter with correct secondary hour labels.
  - Navigate to `/day` $\to$ verify secondary timezone gutter renders cleanly on single-day view.
  - Disable in Settings $\to$ verify time gutter collapses back to single column.
- **Regression**: with the secondary gutter enabled, dragging an event to a new time still lands on the intended slot (gutter width changes must not shift drag math) — mirror `e2e/drag-quarter-hour.spec.ts`.

---

## 6. Open Questions

- Sub-hour-offset zones (India, Nepal, Chatham): render `14:30` against a `10:00` primary row, or offset the secondary labels vertically? Proposal: render the true `:30` value in place — honest and cheap.
- Does the secondary column appear in the Month view's "day peek" popups, or grid views only? Proposal: grid views only, for now.
