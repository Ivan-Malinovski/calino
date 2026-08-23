# Calino agent guide

This repository contains a React 19 + TypeScript + Vite calendar client for
CalDAV, with CardDAV contacts, webcal subscriptions, natural-language event
entry, and an Android wrapper built with Capacitor. The web app and Android app
share the implementation in `src/`; Android-specific code lives under
`android/` and is documented in [`android/CLAUDE.md`](android/CLAUDE.md).

## Project facts

- The project is pre-1.0 and follows semver. The version in `package.json` is
  the single source of truth for web and Android builds.
- Zustand stores persist most settings, calendar data, accounts, and contacts
  in browser `localStorage`. Large raw iCalendar documents, attachments, and
  contact photos use IndexedDB.
- CalDAV and CardDAV traffic goes directly from the browser to the configured
  server unless an account proxy is configured. Webcal feeds and optional AI
  photo extraction are additional user-configured network integrations.
- `vite.config.ts` builds both the main app (`index.html`) and the Android
  background-sync entry (`headless.html`). Do not assume the build has only one
  HTML entry.
- Do not commit credentials, `calino.config.json`, keystores, or local
  environment files. The repository's `.gitignore` lists the local files that
  contain secrets or generated state.

## Commands

Use pnpm 10 from the repository root. The authoritative command list is in
`package.json`; these are the common checks:

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test:run
pnpm test:e2e
pnpm check
pnpm build
```

## Testing policy

Every user-visible behavior change needs a passing Playwright spec. Pure type
changes, internal refactors with no visible effect, and semantic-neutral CSS
changes are exempt. E2E-specific fixtures, selectors, environment details, and
gotchas are documented in [`e2e/AGENTS.md`](e2e/AGENTS.md).

## Verification

For user-visible changes, run the smallest focused check and the broader checks
appropriate to the risk. `pnpm check` covers typecheck, lint, unit tests, and
the production build; it does not run E2E tests.

## Release and deployment

`scripts/release.sh` is mutating: it can run checks, bump versions, commit,
push, tag, and create a release. Read its `--help` output and
`docs/RELEASE_CHECKLIST.md` before using it. Docker and Android release details
are in `docs/DOCKER.md` and `android/CLAUDE.md`.
