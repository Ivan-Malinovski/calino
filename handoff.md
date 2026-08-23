# i18n retrofit — handoff

Wave 2 (Sonnet fan-out) was killed mid-task by an account spend limit. This
document is the ground-truth state as of investigation, for whichever agent
picks this up next.

## Orientation

- **Plan**: `/home/ivan/.claude/plans/create-a-whole-plan-flickering-pearl.md`
  — full spec, conventions, key-naming rules, the `yyyy-MM-dd` trap, and the
  §8 wave/model-tiering plan. Read it before touching anything.
- **Branch**: `feature/i18n`, based on `feature/adjustable-theme`
  (commit `44c3ae5e`).
- **Wave 1** (foundation — i18next setup, date/time locale layer, the
  `language` setting, test harness): committed at `341c88c2`. Done, safe,
  green.
- **Wave 2** (string extraction, 5 parallel Sonnet agents A–E): **not
  committed**. All progress lives in the working tree as 63 uncommitted
  modified files. This is what got interrupted.
- **The stash** (`stash@{0}: WIP on feature/i18n: 341c88c2 ...`) is a
  **strictly older, strictly smaller snapshot** of the same work — every file
  in it is byte-for-byte covered by the current working tree, which has 3
  files with *more* content than the stash (`DeleteDialog.tsx`,
  `calendar.json`, `commands.json`) and no file with less. **The stash is
  redundant and safe to drop** (`git stash drop`) once you're comfortable;
  I did not drop it myself since destructive git ops aren't mine to do
  unprompted.

## What I did in this session

1. Confirmed the working tree is a superset of the stash (see above).
2. Verified all 7 `src/locales/en/*.json` catalogs are valid JSON.
3. Ran `pnpm typecheck` — found and fixed 2 mechanical errors:
   - `EventFormFields.tsx`: `TFunction` isn't exported from `react-i18next`
     in this version — import it from `i18next` instead.
   - `CommandItem.eventRow.test.tsx`: needed a `t` prop added to match the
     now-required `CommandItemContentProps.t`.
   `pnpm typecheck` and `pnpm lint` are both clean now.
4. Ran the full suite (`pnpm test:run`) and root-caused every failure. Fixed
   what was small and unambiguous; left what requires judgment. Current
   state: **14 known-expected failures + ~62 failures from one root cause**,
   detailed below.

### Bugs fixed (real regressions, not just missing keys)

- **`src/lib/i18n.ts`** — `currentLanguage()` read `i18n.resolvedLanguage`,
  which lags behind `changeLanguage()` until an async event settles. Every
  locale-aware date formatter was one language-switch behind. Fixed to read
  `i18n.language` directly. This was silently breaking `formatMonthYear`,
  `formatWeekdayLong`, etc. for **any** language switch, not just an edge
  case — worth flagging as the most important fix in this pass.
- **`CalendarGrid.tsx`** — a day cell's `aria-label` had been switched to
  `formatFullDate()` (date-fns `'PPPP'`), which uses `en-US`'s default
  ordinal day ("March 15th"). The rest of the app doesn't use ordinals.
  Reverted to `formatDisplayDate(day, 'EEEE, MMMM d, yyyy')`.
- **`AdjustableThemeControls.tsx`** — `colorAriaLabel` is nested under
  `theme.adjustable.colors.colorAriaLabel` in `settings.json`, but the
  component called it as `theme.adjustable.colorAriaLabel` (wrong path) with
  the wrong interpolation param name (`name` vs. the catalog's `{{label}}`).
  Fixed both.
- **`CommandItem.eventRow.test.tsx`** — my own typecheck fix (step 3 above)
  had stubbed `t` as an identity function, which passed typecheck but broke
  the test's real assertions on rendered English text once i18n was wired
  through. Fixed to use `i18n.getFixedT(null, 'commands')`, matching how
  `CommandPalette.tsx` actually scopes `t` for this helper.

### The one big remaining root cause: `EventPreviewPopup.tsx`

Agent C's territory (calendar modals). The component was rewritten to call
`t('modals.eventPreview.<key>', ...)` at **28 distinct call sites**, but the
`modals.eventPreview` subtree was never added to
`src/locales/en/calendar.json` — it doesn't exist at all. Every one of these
keys currently renders its own raw key string instead of English text. This
is the direct cause of ~20 failures in `EventPreviewPopup.test.tsx`, the
`Bug 11` failure in `bug-fixes.test.tsx` (can't find the "Delete" button),
and probably the `CommandItem`/other-component failures that render an
event preview under the hood.

The 28 keys, gathered via
`grep -oE "t\('modals\.eventPreview\.[a-zA-Z0-9_.]*'" src/features/calendar/components/EventPreviewPopup.tsx`:

```
allDay, completed, delete, description, editLocation, editTime,
emailAttendees, emailAttendeesCount, endMustBeAfterStart,
failedToUpdateOccurrence, markComplete, markCompleteShort, markIncomplete,
masterEventNotFoundSingleOccurrence, masterEventNotFoundThisOccurrence,
minTravel, noDueDate, openEvent, openInMaps, openTask, priority,
reminderAtTimeOfEvent, reminderDaysBefore, reminderHoursBefore,
reminderMinutesBefore, saveChanges, subtaskOf, subtasks
```

**To recover the original English wording**, diff against the pre-extraction
version:
```
git show HEAD:src/features/calendar/components/EventPreviewPopup.tsx > /tmp/orig.tsx
diff /tmp/orig.tsx src/features/calendar/components/EventPreviewPopup.tsx
```
`HEAD` here is `341c88c2` (Wave 1), i.e. English-only, pre-extraction. Some
of these are plural-bearing (`emailAttendeesCount`, `reminderDaysBefore`,
`reminderHoursBefore`, `reminderMinutesBefore` almost certainly need
`_one`/`_other` suffixes — check the original ternaries/count logic before
writing the JSON). This is exactly the "judgment" work the plan assigns to
the Sonnet tier — don't just paraphrase, check what the original string
actually said and what `t()` is called with (interpolation args) at each
site.

### Other known-broken item (separate from the above)

- **`WeekView.bugs.test.tsx`**: "puts the overflow control at the bottom of
  the stack" fails — not a missing-key issue (the `views.week.showMoreAllDayItems`
  / `showFewerAllDayItems` keys are present and correct, plural suffixes and
  all). The overflow toggle button never renders in this test at all; the
  rendered task card shows `"Task One due 00:00"` where it should read
  `"All day"` — this points at a regression in `EventCard.tsx`'s all-day/due-time
  formatting logic (Agent B or C's territory), not yet diagnosed further.
  Start there.

### Expected, not a bug

- **14 `catalogs.test.ts` failures** (`da`/`de` missing keys for every
  namespace) — these are supposed to fail right now. `da`/`de` catalogs
  still reflect an earlier, smaller key set; Wave 2 added many new `en` keys
  that haven't been translated yet. This is exactly what the parity test is
  for. **Do not touch `da`/`de` JSON until every `en` namespace is finished
  and frozen** — that's Wave 3 (Haiku), gated on Wave 2 being complete.

## Recommended next steps

1. `git stash drop` (optional cleanup — confirmed redundant, see above).
2. Finish `EventPreviewPopup.tsx`'s `modals.eventPreview` subtree in
   `calendar.json` (28 keys, English only) — this alone should clear ~22 of
   the ~62 non-catalog failures.
3. Diagnose the `EventCard.tsx` all-day/due-time regression behind the
   `WeekView` overflow-control failure.
4. Re-run `pnpm typecheck && pnpm lint && pnpm test:run` — should be fully
   green except the 14 expected `catalogs.test.ts` failures.
5. Spot-check the other 4 agents' territories (B: calendar views, D:
   contacts+commands, E: errors/toasts) for the same failure mode — a
   component calling `t()` with a key namespace never populated. The
   EventPreviewPopup gap suggests Agent C got killed specifically mid-file
   on this component; check if other agents left similar half-finished
   files by grepping each namespace's JSON for missing keys their assigned
   components reference.
6. Once `en` catalogs are complete and the full suite is green, commit Wave
   2, then proceed to Wave 3 (Haiku translation into `da`/`de`, gated by
   `catalogs.test.ts`).

## Conventions everyone must keep following (from the plan)

- Key naming: `namespace:section.item`, e.g. `calendar:modals.eventPreview.allDay`.
- Plurals: i18next `_one`/`_other` suffixes, `t(key, { count })`.
- Never translate through storage/routing date keys — `yyyy-MM-dd` and
  friends must stay on `format()`/`toLocalDateString`, never
  `formatDisplayDate`. See the comment block in `src/lib/datetime.ts`.
- `calendar.json` is shared between agents B (views) and C (modals) —
  partitioned by top-level `views.*` vs `modals.*` keys. Don't cross the
  boundary.
- Write only `en` JSON in this phase. `da`/`de` come later, mechanically,
  once `en` is frozen and the parity test passes.
