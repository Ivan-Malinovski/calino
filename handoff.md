# Handoff — issues #87 and #86

Written 2026-07-31. Two independent branches, both off `main`.

`vite.config.ts` has an uncommitted change of Ivan's. It is deliberately excluded from
every commit below and will follow onto whatever branch is checked out. Don't commit it.

---

## Branch `fix/87-contact-relation-uuids` — DONE

Two commits, nothing outstanding.

- `757acdd` fix(contacts): resolve uuid relations to contacts, add a picker (#87)
- `9d8ac17` chore: bump version to 0.25.3 → 0.25.4

Verified: 20 new unit tests, 138 carddav unit tests pass, typecheck clean,
lint 0 errors / 40 warnings (baseline), 3 e2e specs pass and were proven to
fail on unchanged code first.

Ready to merge. Nothing to do here.

---

## Branch `fix/86-move-events-between-calendars` — 90% done, ONE test failing

- `6a5a338` test(e2e): failing coverage for moving events between calendars (#86)
- `5b23cd8` fix(caldav): move events between calendars instead of reverting them (#86)

### State

Typecheck clean. Lint 0 errors / 40 warnings (baseline). 331 caldav unit tests pass.

e2e (`E2E_PORT=5311 pnpm exec playwright test e2e/event-move.spec.ts`): **3 of 4 pass.**

| test | status |
|---|---|
| moves an event to another calendar and it stays there after a sync | PASS |
| moves a recurring series together with its detached override | PASS |
| moves an event across accounts | PASS |
| a failed cleanup DELETE never leaves the event in two calendars | **FAIL** |

The three passing tests mean the actual reported bug is fixed, including the two
hardest cases (recurrence with detached overrides, and cross-account).

### The one remaining failure

`e2e/event-move.spec.ts:281`. The test arms the mock's fault injector so the
first cleanup DELETE returns 500, then moves the event and syncs twice.

What passes: the destination collection has exactly 1 resource, and the UI shows
exactly 1 instance of the event. So the move itself is correct and no duplicate
is visible.

What fails, at `:324`:

```
expect(await dump(page, baseURL!, SOURCE)).toEqual({})

- Object {}
+ Object {
+   "/dav/calendars/user/move-source/flaky-cleanup.ics": "BEGIN:VCALENDAR…UID:flaky-cleanup…"
+ }
```

The stale source resource is still on the server after two syncs. The queued
`delete-href` cleanup is not clearing it.

### Where to look

I ran out of budget mid-diagnosis. Confirmed so far: `processPendingChanges()` IS
reachable from a sync (called at `useCalDAV.ts:1161` among others), and it is
called explicitly at the end of the move branch, so the retry path should be
exercised well inside `MAX_RETRIES` (10). Untested hypotheses, cheapest first:

1. **The `delete-href` change may never be queued.** In the move branch the
   cleanup is only enqueued when `!result.sourceDeleted && event.resourceHref`.
   Check `moveEventGroup` actually returned `sourceDeleted: false` here — the
   injector returns 500, `isAlreadyGone` is false, so it should. Log it.
2. **The immediate `processPendingChanges()` at the end of the move branch may
   consume the injector's single failure itself**, succeed, and delete the
   source — in which case the source would be empty and the test would pass, so
   this is probably NOT it, but it's worth confirming the ordering.
3. **The replayed DELETE may be rejected on etag.** `delete-href` passes
   `parsed.etag` (the pre-move etag) as `If-Match`. If the mock returns 412 the
   change stays queued forever and the resource survives. Consider sending an
   empty etag for cleanup deletes — the resource is being discarded, so a
   conditional delete buys nothing.
4. **Re-entrancy.** If `processPendingChanges` has a "already running" guard, the
   call at the end of the move branch may be a no-op, and the later syncs may
   collide similarly.

Start by putting a `console.log` in the `delete-href` case in
`processPendingChanges` (`useCalDAV.ts`, search `case 'delete-href'`) and re-run
just that test with `--grep "failed cleanup"`.

Note the subagent that wrote this test flagged that before the fix it failed
*earlier* than intended (no move happened at all, so cleanup was never
attempted). Now that the move works, this test is finally exercising its real
target for the first time — so treat a failure here as informative, not as a
regression.

### Not yet done on this branch

- CHANGELOG entry and a **minor** version bump (new capability), as a separate
  `chore:` commit. Current version on this branch is still 0.25.3, because the
  0.25.4 bump lives on the #87 branch. Sequence the two merges accordingly.
- `JournalView.tsx` has an `!editingId` gate on its calendar picker that exists
  only because moves didn't work. It can now be removed — separate change.

---

## Landmines worth knowing

**Do not run `pnpm format` unscoped.** `main` is not Prettier-clean; a run
rewrites files you never touched.

**e2e port.** `playwright.config.ts` on `main` defaults to **5173**, the same
port as `pnpm dev`, and `reuseExistingServer` is on — so the suite silently
attaches to a plain dev server with no `CALINO_E2E_MOCK=1` and the sync specs
fail in ways that look like flakes. I hit this repeatedly. **Always run e2e with
an explicit `E2E_PORT=<something unused>`** until the fix lands. A fix moving the
default to 5199 exists on `fix/journal-calendar-scoping` (`efdb4f4`) but is NOT
on main. That fix is also insufficient once agents use git worktrees, since two
worktrees then collide on 5199 — a port derived from the checkout path would be
the durable answer.

**`main` is currently red on any month-end.** `calendar-sync.spec.ts:230`
("does not apply a midnight EXDATE to a timed occurrence") seeds a 2-day series
anchored to today; the agenda renders one month, so on the last day of a month
the second occurrence falls outside the view and the count can never reach 2.
Today is 31 July, so it fails. Confirmed independently twice. Already fixed on
`fix/journal-calendar-scoping` (`efdb4f4`). The "1 did not run" that accompanies
it is the `mode: 'serial'` cascade, not a second bug.

**Merging `fix/journal-calendar-scoping` to main is the highest-value next
step** — it carries the e2e determinism fixes that both of these branches would
have benefited from.

**Single e2e files:** `pnpm exec playwright test <file>`. `pnpm test:e2e -- <file>`
does NOT filter and runs everything.
