# Rolling-completion fixtures (#244)

Real `.ics` captured from the clients the rolling mode exists for, plus a few
synthetic series for edge cases. Loaded by
`src/lib/__tests__/rollingTaskCompletion.fixtures.test.ts`.

## Layout

```
synthetic/<name>.ics                 hand-written RFC 5545 inputs (edge cases)
calino/<series>/                     what Calino writes for the same seed: before.ics,
                                     override-after.ics (today's default) and
                                     rolling-after-{master,copy}.ics (reference only)
clients/<client>/<series>/
  meta.json                          what was done in the client (see below)
  before/*.ics                       the collection before completing
  after/*.ics                        the collection after completing
```

`<client>` is one of `davx5-opentasks`, `davx5-tasks-org` (Tasks.org syncing
through DAVx⁵), `tasks-org` (Tasks.org's built-in CalDAV), `apple-reminders`,
`calino`. `<series>` is one of `daily`, `weekly`, `count`, `exdate`, or `native`
(a task created in the app itself, kept for its `PRODID`; not a test input).

`meta.json`:

```json
{
  "completedDue": "2026-03-03",
  "writesCopy": true,
  "notes": "Completed from the list view, app version 4.x"
}
```

- `completedDue`: the due date of the occurrence that was ticked off.
- `writesCopy`: whether the client writes a standalone completed VTODO
  (`true` for OpenTasks / Apple Reminders, `false` for Tasks.org's bare `DUE`
  advance).

## Capturing

Use `scripts/capture-ics.py`. It downloads every VTODO in a collection and scrubs
UIDs, names, emails, locations and free text. Prefix a SUMMARY with `fixture:`
to keep it. Use one empty task list per series so `before/` holds only that
series.

Before you commit, check the output by hand, and never commit `.uid-map.json`.
