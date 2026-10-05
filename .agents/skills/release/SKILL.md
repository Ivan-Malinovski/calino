---
name: release
description: Release Calino from main at a supplied version, with changelog notes and an optional native calino-android APK. Use for Calino release requests, including /release; not for releasing the separate Android repository itself.
---

# Release Calino

Accept a version and whether to include the native Android app, for example:

- `$release 0.39.0 calino-android=yes`
- `$release 0.39.1 calino-android=no`
- `$release 0.40.0 calino-android=0.12.0` (include that specific native release)

Natural-language equivalents are valid. Ask for either input if it is missing
and cannot be inferred from the request. `yes` means the latest published stable
native release; an explicit native version takes precedence. A request to
release authorizes preparation, checks, release commits, pushing `main` and the
version tag, publishing the GitHub Release and attaching the requested APK.
A request only to draft or review a release does not authorize publishing.

## Establish the release contents

Work from the Calino repository root. Read `AGENTS.md`,
`docs/RELEASE_CHECKLIST.md` and `scripts/release.sh --help`; read `e2e/AGENTS.md`
before working on browser tests. Inspect the current release workflows under
`.github/workflows/` rather than assuming their behavior has stayed the same.

- The main repository is `Ivan-Malinovski/calino`; the separate native app is
  `Ivan-Malinovski/calino-android`. Derive and verify the main remote locally.
- Release from `main`, using `v<version>` as the Git tag and GitHub Release
  title. The Docker moving tags `main` and `latest` identify a stable release;
  do not create a separate Git tag named `main`.
- Inspect the working tree, remote `main`, the latest published release and
  commits since it. Include completed uncommitted work clearly intended for
  this release, reviewing it before committing. Preserve unrelated work; use
  an isolated worktree if it would otherwise leak into the tested build.
- Honor the exact supplied version, even when it skips a minor number.
  `package.json` is the version source for both web and Capacitor Android.
  Do not hand-edit Gradle versions.
- If the requested tag or release exists, inspect it and resume missing work
  when appropriate. Do not move a published tag, overwrite an existing APK,
  or create another version merely to work around a failed release step.

## Prepare the notes and optional native APK

Update `package.json` and promote the current changelog into a dated
`## [<version>]` section, leaving a fresh `## [Unreleased]` above it. Build the
notes from both the changelog and the actual release diff. Use previous GitHub
releases and `CHANGELOG.md` as writing references: a short introduction,
user-facing Added/Changed/Fixed bullets, relevant issue links and contributor
thanks. Publish those notes at GitHub `/releases`; no local `releases/`
directory is needed. Add a Full Changelog comparison from the previous
published Calino version to the requested version.

Write each paragraph and list item as one source line. Use blank lines only
between paragraphs, headings and list items; do not manually hard-wrap prose
at a fixed column, because GitHub renders those source newlines as awkward
breaks in the release page.

When native Android is included:

1. Read the selected published release's notes and assets with `gh release
   view --repo Ivan-Malinovski/calino-android`. Resolve and pin its tag before
   downloading. Read intervening release notes as needed to summarize changes
   since the native version last attached to a Calino release.
2. Download the existing phone APK, normally `app-release.apk`, into a temporary
   directory. Attach it as `calino-android-<native-version>.apk`. The Wear OS APK
   is a separate asset and is not included unless requested.
3. Check the file size and SHA-256 against the source release metadata when a
   digest is available. Preserve those bytes; do not rebuild the native app
   from a moving branch.
4. Add a Native Android app section naming the exact APK and source release,
   summarizing relevant native changes and pointing feedback to its repository.
   Distinguish it from `calino-v<version>.apk`, the regular Capacitor app built
   by this repository's tag workflow. Verify any minimum-Android claim against
   the selected native release or its tagged source.

When native Android is excluded, omit its section and attachment. The normal
Capacitor APK workflow still applies.

## Verify the tree that will be tagged

Run focused Playwright coverage for any newly included visible behavior, then
run the repository's release checks. A useful preparation command after setting
an exact version is:

```bash
./scripts/release.sh --release-current --no-push
```

This runs typecheck, lint, unit tests, the full browser suite, and the production
container build/probes. The script may skip a browser whose host libraries are
missing; report the actual coverage. Do not equate a skipped browser with a pass.
If the container runtime is unavailable, use the documented local-build fallback
and verify the container through CI before reporting it as tested.

Resolve genuine failures before publishing. For demonstrated test-driver or
fixture defects, make narrow corrections and rerun affected specs. Passing
checks need not be repeated unless later changes invalidate them. If application
code changes, verify the changed behavior and rebuild the production artifact.
The build includes both `index.html` and `headless.html`.

Inspect what is staged and commit the intended source, tests and release
preparation. The release script only stages its own version bump or changelog
promotion; it does not commit arbitrary source changes, and with an already
prepared version/section it may make no commit at all.

## Publish and verify

After successful checks, push the release commit to `main` and the
`v<version>` tag pointing to that same commit. Use the script's publishing path
when suitable, or equivalent `git`/`gh` commands without repeating completed
checks. Keep exact multiline notes in a temporary file and use `--notes-file`.
For a manual release, use `gh release create` with `--verify-tag`, `--target main`
and, for a stable version, `--latest`. For a prerelease, use `--prerelease`
and `--latest=false`. Include the native APK in that creation command when requested, so it is present when the release is published.

Verify the published notes, target, stable/prerelease status and native asset
name and digest. Monitor workflows for the exact release commit and tag:

- GitHub Pages deploys the web app from `main`.
- Android Release builds and attaches `calino-v<version>.apk`.
- Docker publishes the version and moving `main`/`latest` tags through the
  release-tag workflow. Let that workflow publish the images; do not also
  perform a redundant manual Docker push.

Read failing job logs before retrying. Resume a transient failed step without
repeating completed publication or replacing the tag; stop and report if
credentials, permissions or a substantive external failure prevent completion.
Report release/CI failures honestly instead of announcing successful deployment.
Finish with the release link, attached APK versions, check/CI results and any
material coverage limitation.
