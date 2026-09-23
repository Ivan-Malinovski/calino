# Contributing to Calino

Contributions are very welcome — bug reports, fixes, and features alike. Calino
is pre-1.0 and moves fast, so this document is short: it covers what to expect,
how to get a change into a shape that can be merged, and the few conventions
that matter.

## Before you build something big

Small fixes need no ceremony — open the pull request.

For anything larger (a new view, a new sync behavior, a new integration, a
dependency), **open an issue first** and say what you have in mind. Not to gate
you, but because Calino has opinions about scope and about how CalDAV data is
modeled, and it is much nicer to discover a mismatch in a paragraph than after
a weekend of work. A short "I'd like to add X, planning to do it roughly like
Y" is enough.

If you have already built something in your fork and are not sure it fits: open
an issue linking the branch. A branch sitting unmerged in a fork helps nobody.

## Getting set up

Calino uses **pnpm 10** (see `packageManager` in `package.json`).

```bash
pnpm install
pnpm dev
```

The README covers self-hosting, Docker, CORS proxying, and supported CalDAV
servers. `AGENTS.md` is written for coding agents but is an accurate short
orientation to the codebase for humans too.

To develop against a real server you need CalDAV credentials and, usually, CORS
headers or a proxy — see the README's *CORS Headers* and *Self-Hosting a CORS
Proxy* sections.

## Checks

Before pushing:

```bash
pnpm check    # typecheck + lint + unit tests + production build
```

Run the E2E suite when your change touches user-visible behavior:

```bash
pnpm test:e2e
```

`pnpm check` deliberately does not run E2E. If a change touches Docker, there
is also `pnpm check:docker`.

Formatting is Prettier (`.prettierrc`) and ESLint (`eslint.config.js`);
`pnpm lint:fix` and `pnpm format` will sort most of it out.

## Tests

**Every user-visible behavior change needs a passing Playwright spec.**
Exempt: pure type changes, internal refactors with no visible effect, and
semantic-neutral CSS changes.

E2E fixtures, selectors, environment details, and the gotchas that will
otherwise cost you an hour are documented in [`e2e/AGENTS.md`](e2e/AGENTS.md).
Unit tests (Vitest) live next to what they test, in `__tests__/` directories.

Bug fixes should come with a test that fails before the fix. CalDAV bugs are
usually server-shaped — a fixture capturing the server's actual response is
worth more than a mocked assertion.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
with a scope, matching the existing history:

```
fix(agenda): read a task's due time from dueDate, not from start
feat(themes): add Catppuccin light companion
fix(caldav): keep events when a parallel component query fails
```

Common scopes: `caldav`, `carddav`, `agenda`, `month`, `year`, `tasks`,
`themes`, `webcal`, `android`, `sync`, `modal`, `header`, `e2e`, `deps`.

For pull requests:

- **One concern per PR.** Several small PRs get reviewed and merged much faster
  than one large one. If you have a feature plus three drive-by fixes you found
  along the way, the fixes are separate PRs and will probably land first.
- Branch from current `main` and keep the branch rebased on it.
- Say what changed and why, and how you verified it. If it is visual, a
  screenshot or a short clip saves a round trip.
- Do not bump the version or edit release notes — releases are handled by
  `scripts/release.sh` and `docs/RELEASE_CHECKLIST.md`.
- Do not commit lockfiles for other package managers (`package-lock.json`,
  `yarn.lock`), credentials, `calino.config.json`, keystores, or local env
  files.

## Scope of a few specific areas

- **CalDAV / CardDAV** — Calino talks to a wide range of servers (Radicale,
  Nextcloud, Baïkal, Fastmail, iCloud, …) that disagree about almost
  everything. Parse defensively: namespace-aware XML, no assumptions about
  prefixes, tolerate missing properties. If a change is needed for one specific
  server, say which one and which version.
- **Themes** — see [`docs/THEMING.md`](docs/THEMING.md).
- **Translations** — see [`docs/TRANSLATIONS.md`](docs/TRANSLATIONS.md). New
  user-facing strings go through i18n; a feature PR that adds English strings
  only is fine, other locales can follow.
- **Android** — the web app and Android app share `src/`. Android-specific code
  and its release process are in [`android/CLAUDE.md`](android/CLAUDE.md). Note
  `vite.config.ts` builds two HTML entries (`index.html` and the Android
  background-sync `headless.html`); do not assume one.
- **Dependencies** — new runtime dependencies need a reason. Calino is a local,
  privacy-oriented client; anything that phones home is a hard no.

## Licence

Calino is MIT. By contributing you agree your contributions are licensed under
it.
