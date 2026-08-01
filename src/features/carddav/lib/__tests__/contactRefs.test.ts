import { describe, it, expect } from 'vitest'
import type { Contact } from '../../types'
import {
  normalizeContactRef,
  isContactRef,
  resolveContactRef,
  toContactRef,
} from '../contactRefs'

const ALICE_UID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const BOB_UID = '9c858901-8a57-4791-81fe-4c455b099bc9'

function makeContact(id: string, displayName: string, addressBookId: string): Contact {
  return {
    id,
    addressBookId,
    accountId: 'account-1',
    url: `https://dav.example/${addressBookId}/${id}.vcf`,
    displayName,
    familyName: '',
    givenName: displayName,
    additionalNames: '',
    prefixes: '',
    suffixes: '',
    nickname: '',
    note: '',
    categories: [],
    photo: null,
    isGroup: false,
    memberUids: [],
    langs: [],
    related: [],
    xmlData: null,
    opaqueLines: [],
    emails: [],
    phones: [],
  } as unknown as Contact
}

const alice = makeContact(ALICE_UID, 'Alice Adams', 'book-personal')
const bob = makeContact(BOB_UID, 'Bob Brown', 'book-work')
const contacts = [alice, bob]

describe('normalizeContactRef', () => {
  it('strips the urn:uuid: scheme', () => {
    expect(normalizeContactRef(`urn:uuid:${ALICE_UID}`)).toBe(ALICE_UID)
  })

  it('strips the scheme case-insensitively', () => {
    // The edit UI has always hinted at the uppercase `URN:uuid:` form.
    expect(normalizeContactRef(`URN:UUID:${ALICE_UID}`)).toBe(ALICE_UID)
    expect(normalizeContactRef(`Urn:Uuid:${ALICE_UID}`)).toBe(ALICE_UID)
  })

  it('strips a bare uuid: scheme', () => {
    expect(normalizeContactRef(`uuid:${ALICE_UID}`)).toBe(ALICE_UID)
  })

  it('leaves an unprefixed uuid untouched', () => {
    expect(normalizeContactRef(ALICE_UID)).toBe(ALICE_UID)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeContactRef(`  urn:uuid:${ALICE_UID}  `)).toBe(ALICE_UID)
  })

  it('leaves a plain name untouched', () => {
    expect(normalizeContactRef('Jane Doe')).toBe('Jane Doe')
  })
})

describe('isContactRef', () => {
  it('recognises uuid references with and without a scheme', () => {
    expect(isContactRef(`urn:uuid:${ALICE_UID}`)).toBe(true)
    expect(isContactRef(ALICE_UID)).toBe(true)
  })

  it('rejects plain names', () => {
    expect(isContactRef('Jane Doe')).toBe(false)
    expect(isContactRef('')).toBe(false)
  })

  it('accepts a schemed reference whose uid is not RFC 4122 hex', () => {
    // Radicale and friends mint readable UIDs and still wrap them in
    // urn:uuid:. The scheme is the signal that this is a reference.
    expect(isContactRef('urn:uuid:contact-carlos-mendez-04')).toBe(true)
    expect(isContactRef('uuid:not-a-uuid')).toBe(true)
  })

  it('rejects a bare non-uuid value', () => {
    // No scheme and not UUID-shaped: indistinguishable from a name.
    expect(isContactRef(ALICE_UID.slice(0, -1))).toBe(false)
  })
})

describe('resolveContactRef', () => {
  it('resolves a urn:uuid: reference to its contact', () => {
    expect(resolveContactRef(`urn:uuid:${ALICE_UID}`, contacts)).toBe(alice)
  })

  it('resolves an uppercase-scheme reference', () => {
    expect(resolveContactRef(`URN:UUID:${ALICE_UID}`, contacts)).toBe(alice)
  })

  it('resolves a bare uuid with no scheme', () => {
    expect(resolveContactRef(ALICE_UID, contacts)).toBe(alice)
  })

  it('resolves regardless of uuid hex case', () => {
    expect(resolveContactRef(`urn:uuid:${ALICE_UID.toUpperCase()}`, contacts)).toBe(alice)
  })

  it('resolves a contact that lives in a DIFFERENT address book', () => {
    // Regression guard for issue #87: UIDs are globally unique per RFC 6350
    // §6.7.6, and the contact store is flat, so cross-book references must
    // resolve. This must not be "fixed" by scoping the lookup to one book.
    expect(alice.addressBookId).not.toBe(bob.addressBookId)
    expect(resolveContactRef(`urn:uuid:${BOB_UID}`, contacts)).toBe(bob)
  })

  it('resolves a schemed reference to a server-minted readable uid', () => {
    // Regression guard: this rendered as the raw `urn:uuid:…` URI because the
    // lookup demanded RFC 4122 hex. See isContactRef.
    const carlos = makeContact('contact-carlos-mendez-04', 'Carlos Mendez', 'book-personal')
    expect(resolveContactRef('urn:uuid:contact-carlos-mendez-04', [...contacts, carlos])).toBe(
      carlos
    )
  })

  it('returns undefined for a plain name', () => {
    expect(resolveContactRef('Jane Doe', contacts)).toBeUndefined()
  })

  it('returns undefined when no contact has that uid', () => {
    expect(resolveContactRef('urn:uuid:00000000-0000-4000-8000-000000000000', contacts)).toBeUndefined()
  })

  it('returns undefined against an empty contact list', () => {
    expect(resolveContactRef(`urn:uuid:${ALICE_UID}`, [])).toBeUndefined()
  })
})

describe('toContactRef', () => {
  it('formats a bare uid as a canonical lowercase-scheme reference', () => {
    expect(toContactRef(ALICE_UID)).toBe(`urn:uuid:${ALICE_UID}`)
  })

  it('does not double up an existing scheme', () => {
    expect(toContactRef(`urn:uuid:${ALICE_UID}`)).toBe(`urn:uuid:${ALICE_UID}`)
  })

  it('round-trips through resolveContactRef', () => {
    expect(resolveContactRef(toContactRef(alice.id), contacts)).toBe(alice)
  })
})
