# Account connection and protocol labels

The normal account form accepts a server URL, username, password, optional
proxy, and custom headers. `probeConnection` calls the existing `detectProtocol`
transport helper before CalDAV discovery. A detected JMAP calendar session wins
on servers offering both protocols. It is verified with `Calendar/get`, using
the actual primary calendar account id from the session. The session URL is
stored as the account's server URL; it is never replaced with the proxy URL.
The calendar backend remains responsible for translating events at the boundary.

## Public API

`probeConnection(url, username, password, proxy?, originalUrl?, headers?, options?)`
returns `ProbeResult`, including `protocol: 'caldav' | 'jmap'`, `ok`, the resolved
server URL on success, and optional HTTP status, error code, message and hint.
`ConnectionOptions` adds `forceCalDAV` for new accounts and `protocol` for testing
an existing account without changing its transport.

`useCalDAV().addAccount` accepts the same final options plus
`onProtocolDetected(protocol)`. The add form uses that callback to show the
read-only protocol beside the existing connection-success message while the
first calendar import runs. Settings account rows always show JMAP or CalDAV.
The modal continues to close after the initial import completes.

Advanced → Use CalDAV bypasses JMAP detection. The resulting CalDAV protocol
is persisted, so later tests and account edits keep that choice. Existing
accounts without a protocol field retain the CalDAV default. Account edits do
not silently change the protocol; use a new account to switch transports.

JMAP authentication errors stop connection instead of falling through to DAV;
the existing password error styling and credential error message are reused.
JMAP API CORS/network failures and missing calendar capabilities use translated
messages in all seven languages. A stored JMAP account or explicit JMAP session
URL does not silently downgrade when it is unreachable or lacks calendars.
For generic URLs, the transport detector retains its fallback policy for
HTML/non-session responses and sessions without calendar support.

## Persistence audit

`accountStorage.saveAccount` spreads the complete input object, updates merge
fields, and reads return the complete JSON object. Protocol therefore survives
creation, renames, proxy edits, sync timestamps, reloads and account deletion of
other accounts. No account migration reconstructs a reduced account object.
`src/headless.ts`, pending changes, calendar synchronization and settings
synchronization already pass stored protocol to `createCalendarBackend`.
The data import/export UI moves iCalendar, event JSON and vCard data; it does not
export or replace account records. Preconfigured credentials go through
`addAccount` and thus use automatic detection too.

## Contacts seam

The calendar hook has two account-level contact discovery sites: mount-time
checking of saved accounts and checking after initial calendar import. Both
skip JMAP accounts. Their documented replacement seam is a future
`ContactsBackend` selected from the stored account protocol, returning vCard
strings and opaque identifiers to the contacts layer. No speculative interface
or CardDAV implementation changes are introduced here. JMAP calendar support
does not enable JMAP contacts; the existing contacts hook still needs a separate
backend integration before JMAP accounts can synchronize contacts.

## Tests

- `protocolProbe.test.ts`: mocked fetch with the real transport, preferred
  JMAP, authentication failure, CalDAV fallback, forced CalDAV, stored protocol,
  missing capability, API permission/CORS/network errors, headers and proxy.
  Its live probe is gated on `CALINO_TEST_JMAP_URL`, `CALINO_TEST_JMAP_USER` and
  `CALINO_TEST_JMAP_PASS`, read through `globalThis.process` for jsdom.
- `accountProtocol.test.ts`: storage preservation and legacy default.
- `useCalDAV.test.ts`: detected protocol selects and persists the JMAP backend.
- `jmap-connect.spec.ts`: add flow, success label, settings badge, reload,
  test/edit, auth styling without DAV fallback, and Advanced forced CalDAV.
- `vite-jmap-mock.ts`: session, Calendar/get, CalendarEvent/query/get/changes;
  real account id enforcement. An offline probe test also exercises this fixture
  through the real JMAP calendar backend. Registered by the existing CalDAV mock plugin
  under `/mock-jmap`, without claiming the origin-wide discovery endpoint used
  by unrelated CalDAV specs. No backend replacement is used.

Playwright and live Stalwart execution require a network-capable environment.
The sandbox for this task cannot access network services, including localhost.
