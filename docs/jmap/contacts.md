# JMAP contacts boundary

`src/features/carddav/client/ContactsBackend.ts` extracts the methods currently
used by the contact hook: connect, address book listing, contact listing and
multiget, create/update/delete, and collection sync. The existing callers pass
`Contact` objects containing `rawVCard`, not bare strings; keeping those exact
signatures allows the unmodified `CardDAVClient` to satisfy the interface. A
test uses `satisfies ContactsBackend` with no assertion cast. The optional
`protocol` field treats legacy omission as CardDAV; JMAP always returns `jmap`.
The later call-site migration can make the field required after adding it to
CardDAVClient. No existing CardDAV implementation or caller is changed here.

`createJmapContactsBackend(serverUrl, credentials, proxyUrl = null)` connects
and returns `Promise<ContactsBackend>`. The concrete `JmapContactsBackend`
additionally exposes `fetchContact`, `createCard`/`updateCard` (vCard string
entry points), `createAddressBook`/`updateAddressBook`/`deleteAddressBook`,
`clearCache`, endpoint getters, and its contacts-specific `JmapClient` subclass.
The subclass overrides only account selection, so core transport, credentials,
custom headers, proxies, batching, blob transfer and loopback rebasing stay in
the existing transport. Calls and blobs use the contacts account, including
sessions without calendars or with distinct primary accounts.

## Wire and resource model

The backend uses `AddressBook/get/set` and
`ContactCard/get/set/query/changes` with the core and contacts capabilities.
ContactCard envelopes contain `jsCard` and `addressBookIds`; the query uses
`inAddressBook`. Reads also tolerate early flattened Card properties. Creates
use the enveloped form. No unsupported vendor properties are synthesized.

Book URLs are `<origin>/.jmap/<encoded-accountId>/ab/<encoded-addressBookId>/`;
contact URLs append the encoded ContactCard id. The card UID is independent of
this id, and the requested DAV filename is ignored. Hrefs must match the
connected origin/account and collection shape. Application book/account ids
are copied from the supplied AddressBook, as in CardDAV.

Etags are quoted SHA-256 hashes of recursively canonical server JSON, including
unknown fields. Updates/deletes re-read and raise `CardDAVConflictError` for
mismatches; its current etag and server vCard support existing conflict handling.
Per-object permission errors use `CardDAVPermissionError`. Other failures use
the existing status-bearing JMAP errors. This is best-effort optimistic locking:
a concurrent writer between the check and write can still win.

Updates compare the new vCard against the backend's own read projection. For
Contact callers the baseline also passes through Calino's parser/serializer,
accounting for its implicit first-item preference and lossy property handling.
Map entries are matched back to server ids; focused patches retain nested
unrepresented data, defaults and localizations. Deleted represented values are
removed. Moves patch addressBookIds; deleting one of several memberships removes
only that membership. Book destruction requests `onDestroyRemoveContents`.

AddressBook state is a metadata hint, not a ContactCard changes cursor. Returned
book syncToken is null; establish one with `syncCollection(book, null)`. Full
sync captures ContactCard state **before** listing to replay racing changes.
Incremental sync follows every changes page, fetches current cards and filters
book membership. Missing/destroyed cards or cards leaving the book become
removed tombstones. Errors invalidate the cursor for full resync. As with the
calendar backend, integration must not skip contact sync solely because the
book metadata ctag is unchanged.

## Conversion

The exported `jscontactToVCard(card, { version?, language? })` and
`vCardToJscontact(vcard)` use RFC 9553/RFC 9555 mapping conventions. Output defaults
to vCard 4.0; 3.0 output uses TYPE=pref and inline binary photos. Input is one
complete 3.0/4.0 vCard, with folded lines, property groups, quoted parameters,
caret encoding and escaped text. Output folds at 75 UTF-8 octets.

| vCard                     | JSContact                                                                  |
| ------------------------- | -------------------------------------------------------------------------- |
| UID, KIND, FN, N          | uid, kind, Name/full/components, SORT-AS                                   |
| NICKNAME                  | nicknames                                                                  |
| ORG, TITLE, ROLE          | organizations/units and titles; organizationId for a single organization   |
| EMAIL, TEL                | emails/address and phones/number; contexts, numeric pref, phone features   |
| ADR, LABEL                | address components and full; a full-only address is visible as street text |
| URL, IMPP                 | links/uri and onlineServices/uri/service                                   |
| NOTE                      | notes/note                                                                 |
| BDAY, ANNIVERSARY         | anniversaries with birth/wedding and PartialDate                           |
| PHOTO                     | media with kind photo and uri or blobId                                    |
| KIND=group, MEMBER        | kind group and members Boolean map                                         |
| CATEGORIES, RELATED, LANG | keywords, relatedTo/relation and preferredLanguages                        |
| FN;LANGUAGE               | localizations name/full patch; optional read language selection            |

`diffJscontact` emits RFC 8620 patch paths with escaped slash/tilde keys and null
deletions, ignoring server-owned id/blobId/size/audit fields. `contactPatch`
adds preservation of server data outside the represented projection.

Inline PHOTO data URIs are uploaded with `JmapClient.upload`; Media retains
blobId/mediaType instead of the inline URI on write. On read, photo Media with
blobId and no URI is downloaded and becomes a data URI for Calino. URL photos
are left as URLs. Only photos are downloaded, and blob reads are cached per
backend instance. Unchanged photos are neither uploaded again nor patched when
another field is edited. Clearing the cache permits an actual download.

## Tests and limits

All three paired fixtures in `contacts/__tests__/fixtures` and the fake server are
**hand-authored**, not Stalwart captures. The person vCard and JSON independently
describe the same contact; separate group and inline PNG photo pairs exercise
membership and binary media. Offline tests cover both conversion directions,
parser compatibility, 3.0/4.0, Unicode folding, contexts/pref/features, partial
dates, localization, groups, MIME-aware photos, patch paths, metadata retention,
account selection, pagination, CRUD, conflicts, moves, multi-book membership,
full/delta sync, race replay and failures. Run:

```sh
pnpm vitest --run src/features/jmap/contacts
pnpm typecheck
pnpm exec eslint src/features/carddav/client/ContactsBackend.ts src/features/jmap/contacts
pnpm exec prettier --write src/features/carddav/client/ContactsBackend.ts src/features/jmap/contacts docs/jmap/contacts.md
```

Vitest runs west/east timezone projects. The live lifecycle test reads
CALINO_TEST_JMAP_URL/USER/PASS via `globalThis.process.env`, skips unless all are
set, and skips with a reason when the session does not advertise contacts.
It creates a uniquely identified contact in a writable book, uploads/downloads
a photo, checks reads, updates, conflicts and sync tombstones, and attempts all
cleanup. A separate live probe attempts a group write, skips with an explicit
reason if the server rejects kind/members, and otherwise verifies membership
reads and an unrelated group edit. Credentials are never printed or persisted. Network access is
unavailable in this task; the lead must execute it against Stalwart.

This work is not wired into the UI yet and changes no user-visible behavior;
Playwright coverage belongs to call-site integration. Stalwart contacts wire
behavior, blob references, address book rights and **group acceptance still need
live verification**. Converter tests establish supported group mapping without
claiming server support. A server rejecting groups reports its set error.

The existing Contact model exposes one name, organization/title/role, note and
photo; multiple values are preserved on unrelated edits but cannot all be
edited in the current UI. Its date parser cannot display yearless birthdays,
although raw conversion preserves them. Empty KIND=group is explicitly restored
by the backend because the shared parser infers groups only from members.
The shared serializer labels inline photos JPEG; the JMAP boundary replaces its
PHOTO line with the caller's data URI to preserve the actual MIME. Both Contact
and raw `createCard`/`updateCard` entry points support MIME-aware writes.

Localized editing beyond FN, phonetic name/address fields, pronouns, grammatical
gender, complex anniversary timestamps, XML, unknown/X-properties and full
RFC 9555 lossless round-trips are not implemented. Server-side fields survive
unrelated updates; information originally present only in unsupported vCard
properties cannot cross the boundary. There is no contacts push subscription,
sharing UI or cross-account atomic move in this scope.
