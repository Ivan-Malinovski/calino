# Testing JMAP against a local Stalwart

Stalwart (0.16+) serves JMAP, CalDAV and CardDAV on one HTTP port, which makes
it the reference server for Calino's JMAP work: the same events can be written
over CalDAV and read back over JMAP to check the converters.

## Start it

Needs rootless `podman` (the repo does not use Docker). The image is about
1 GB, so check `df -h /` first.

```bash
scripts/jmap-dev-server.sh up      # start; bootstraps and creates the test user once
scripts/jmap-dev-server.sh env     # print the connection settings again
scripts/jmap-dev-server.sh down    # remove the container, keep the data
scripts/jmap-dev-server.sh reset   # wipe the data and start from scratch
```

Defaults: `http://127.0.0.1:18080`, user `alice@example.org`, password
`calino-dev-alice`. Override with `JMAP_DEV_PORT`, `JMAP_DEV_NAME`,
`JMAP_DEV_DATA`, `JMAP_DEV_USER`, `JMAP_DEV_PASSWORD`. The server binds to
loopback only. State lives in `.jmap-dev-data/` (git-ignored).

## What the script does, and why

- Stalwart starts in _bootstrap mode_ with a temporary admin. The script pins
  that admin's password through `STALWART_RECOVERY_ADMIN`, then completes
  bootstrap through the management API (`x:Bootstrap/set`; the `x:` prefix and
  the `urn:stalwart:jmap` capability are required).
- Bootstrap replaces the temporary admin with a generated permanent one and
  returns its secret **once**. The script stores it in
  `.jmap-dev-data/admin-secret` (mode 600). Lose that file and you must
  `reset`.
- The test user is created with `x:Account/set`. Calendars are created lazily,
  so a new account has one default calendar.

## Poking at it

```bash
curl -s -u alice@example.org:calino-dev-alice http://127.0.0.1:18080/jmap/session | jq .
curl -s -X PROPFIND -u alice@example.org:calino-dev-alice -H 'Depth: 1' \
  http://127.0.0.1:18080/dav/cal/
```

CalDAV paths use the URL-encoded address: `/dav/cal/alice%40example.org/default/`.
`/.well-known/jmap` redirects to `/jmap/session`.

## Quirks that affect tests

- JMAP methods need a real `accountId` (from the session); `null` is rejected.
- Vendor and `X-` properties are rejected or hidden over JMAP (see
  `docs/JMAP.md`, "Wire format notes"), so do not assert that they round-trip.
- Stalwart has no JMAP tasks capability: JMAP calendars are VEVENT-only.
- The browser can talk to Stalwart directly (CORS `*`), so e2e specs need no
  proxy.

## Browser access and CORS

By default Stalwart answers CORS preflights only on `/.well-known/jmap`. Its
`/jmap/*` endpoints return a bare `204` without `Access-Control-*` headers, so a
browser on another origin cannot call the API with an `Authorization` header
unless a reverse proxy adds them (or Calino's account proxy is used).

For local development, turn on Stalwart's own switch: set `usePermissiveCors`
to `true` on the `x:Http` singleton (admin UI, or `x:Http/set` with
`{"update":{"singleton":{"usePermissiveCors":true}}}` over JMAP as the admin)
and restart the container. `/jmap/*` then answers with
`Access-Control-Allow-Origin: *`. Do not use this on an internet-facing server
unless that is what you want; there, restrict origins at a reverse proxy.

Calino's own Content Security Policy is a second gate. Public builds only allow
`connect-src 'self' https:`, so the browser refuses a plain `http://` server
(such as the local Stalwart) before any request is sent, and the connect dialog
shows "Couldn't reach the server". Start the dev server in self-hosted mode,
which adds `http:` to the policy (see `docs/DOCKER.md`, "Content Security
Policy"):

```bash
CALINO_SELF_HOSTED=true pnpm dev
```

The hosted `proxy.calino.io` never reaches loopback or private addresses
(SSRF guard), so it cannot be used with a local server. The live
Playwright spec `e2e/jmap-live.spec.ts` adds the headers at the network layer
and aborts the EventSource stream; run it with:

```bash
CALINO_TEST_JMAP_URL=http://127.0.0.1:18080 \
CALINO_TEST_JMAP_USER=... CALINO_TEST_JMAP_PASS=... \
pnpm exec playwright test e2e/jmap-live.spec.ts --project=chromium
```

The invitation test in `src/features/jmap/backend/__tests__/live.test.ts` also
needs a second local user, given as `CALINO_TEST_JMAP_USER2` and
`CALINO_TEST_JMAP_PASS2` (the test skips without them). Create one in the
Stalwart admin UI, or with `x:Account/set`.
