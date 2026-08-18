# Secondary Timezone Feature — Handoff Notes

## Summary of Changes

Implemented the **Secondary Timezone Display** feature per the specification in `docs/plans/02-secondary-timezone.md`.

### 1. Types, Settings Store & Sync Persistence
- [`src/types/index.ts`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/types/index.ts):
  - Added `secondaryTimezoneEnabled: boolean` (default `false`)
  - Added `secondaryTimezone: string | null` (default `null`, e.g. `'America/New_York'`)
  - Added `secondaryTimezoneLabel: string | null` (default `null`, optional custom label up to 8 characters)
- [`src/store/settingsStore.ts`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/store/settingsStore.ts):
  - Added default values to `DEFAULT_SETTINGS`
- [`src/lib/settingsSync.ts`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/lib/settingsSync.ts):
  - Added `'secondaryTimezoneEnabled'`, `'secondaryTimezone'`, `'secondaryTimezoneLabel'` to `SYNCABLE_SETTINGS` so preferences sync across devices.

### 2. Timezone Formatting Helpers
- [`src/lib/timezoneHelper.ts`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/lib/timezoneHelper.ts):
  - `formatTimeInZone(date, timeZone, use24Hour)`: Cached `Intl.DateTimeFormat` formatter for 24h (`HH:mm`) and 12h (`h a` or `h:mm a` when minutes !== 0 for sub-hour offset zones).
  - `getTimezoneAbbr(date, tz)`: Short timezone abbreviation extraction (e.g. `EST`, `CEST`, `UTC`, `GMT+5:30`).
  - `getSecondaryHourLabel(hour, baseDate, targetTz, timeFormat)`: Computes secondary hour and day delta (`+1d`, `-1d`, or `null`).
  - `getSupportedTimezones()`: Uses `Intl.supportedValuesOf('timeZone')` when available with a curated IANA fallback list for older Android WebViews, guaranteeing `'UTC'` presence.
  - `TIMEZONE_PRESETS`: Curated quick-select presets for major global hubs (UTC, New York, London, Paris, Tokyo, Sydney, San Francisco).

### 3. Settings UI
- [`src/features/settings/components/CalendarSettings.tsx`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/features/settings/components/CalendarSettings.tsx):
  - Added "Secondary Timezone" group with "Show Secondary Timezone" toggle.
  - Dropdown populated with presets and all IANA timezones (defaults to `UTC` on initial enable).
  - Custom label text input (max 8 characters, trimmed, empty string saved as `null`).
- [`src/features/settings/components/Settings.module.css`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/features/settings/components/Settings.module.css):
  - Added `.textInput` styling for settings input fields.

### 4. WeekView & DayView Time Gutter
- [`src/features/calendar/components/WeekView.tsx`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/features/calendar/components/WeekView.tsx) & [`WeekView.module.css`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/features/calendar/components/WeekView.module.css):
  - Uses CSS variable `--time-gutter-width` (`90px` when secondary timezone is enabled, `45px` default).
  - Renders dual header labels (`localTzAbbr` and `secondaryTzAbbr`) and dual time cells with rollover indicator badges.
- [`src/features/calendar/components/DayView.tsx`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/features/calendar/components/DayView.tsx) & [`DayView.module.css`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/features/calendar/components/DayView.module.css):
  - Uses CSS variable `--time-gutter-width` (`100px` when secondary timezone is enabled, `60px` default).
  - Renders header timezone label gutter aligned with body hour gutter.
  - Passes secondary timezone props to `HourCell` for dual hour display.

### 5. Tests
- Unit tests:
  - [`src/lib/__tests__/timezoneHelper.test.ts`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/lib/__tests__/timezoneHelper.test.ts): 24 unit tests covering 12h/24h formats, sub-hour offsets (`Asia/Kolkata` +5:30, `Australia/Eucla` +8:45, `Pacific/Chatham` +12:45, `Asia/Kathmandu` +5:45), DST spring-forward & autumn-fallback boundaries, and day rollovers across Tokyo, London, Honolulu.
  - [`src/features/settings/__tests__/CalendarSettings.test.tsx`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/src/features/settings/__tests__/CalendarSettings.test.tsx): Unit tests for secondary timezone toggle, select, and custom label.
- Playwright E2E tests:
  - [`e2e/secondary-timezone.spec.ts`](file:///tmp/claude-1000/-var-home-ivan-dev-calino/3fc6f5a9-2638-4c02-ba9e-4343a310b20b/scratchpad/wt-tz/e2e/secondary-timezone.spec.ts): E2E test verifying configuration in Settings, persistence across reload, dual-column display in Week and Day views, and drag-and-drop snapping accuracy regression test.

### 6. Verification
- `npx tsc -b`: 0 errors
- `npx eslint .`: 0 errors
- `npx vitest --run`: 279 files passed, 3749 tests passed
- `pnpm exec playwright test e2e/secondary-timezone.spec.ts`: 3 tests passed
