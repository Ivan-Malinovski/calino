# Release Checklist

What to verify before cutting a release. The automated half is what
`scripts/release.sh` runs for you; the manual half is what it can't.

## Automated

```bash
./scripts/release.sh --dry-run    # typecheck + lint + unit + E2E + build + Docker checks
pnpm audit                        # optional dependency vulnerability review
```

The release script runs the full Playwright suite unless `--no-e2e` is passed.
The three browser projects run concurrently with isolated app and DAV mock
servers, one worker per browser, so they do not contend for the shared local
test backend. It runs the Docker build/probes unless `--no-docker` is passed.
It picks the first free host port from 8080 up for the container checks; pin it
with `HEALTH_PORT=…` if you need a specific one.

Then cut the release:

```bash
./scripts/release.sh --patch      # or --minor / --major
```

That bumps `package.json`, promotes `## [Unreleased]` when needed, commits,
tags `vX.Y.Z`, pushes, and creates the GitHub Release from the matching
`CHANGELOG.md` section. A pre-existing version section is used as-is; if there
is no usable changelog section, the release falls back to generated commit
notes.

## Manual

Things no test covers. Not every item applies to every release — work the ones
your changes could plausibly have broken.

- [ ] **Real servers** (iCloud / Nextcloud / Radicale): create a recurring
      event, edit one occurrence, edit the title, drag to reschedule, delete.
      Sync. No 412s, no silent drops.
- [ ] **Non-UTC timezone**: TZID preserved on round-trip.
- [ ] **Offline**: open the app offline, view cached events, edit, queue the
      sync. Reconnect — the sync completes.
- [ ] **Dark mode**: all themes, all views, all modals. No hardcoded colors.
- [ ] **Mobile** (iOS Safari + Android Chrome): safe areas respected, the FAB
      clears the home indicator, the on-screen keyboard doesn't cover inputs.
- [ ] **Screen reader** (VoiceOver / NVDA): tab through the main views; every
      interactive element has a name.
- [ ] **PWA install**: the prompt appears and the app launches standalone.
- [ ] **Notifications**: scheduling works; the denied state explains itself.
- [ ] **Drag-and-drop**: resize and move events in week and day views.
- [ ] **Recurrence**: the "this / this-and-future / all" dialog appears for
      recurring edits.
