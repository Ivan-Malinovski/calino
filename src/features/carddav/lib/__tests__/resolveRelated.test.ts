import { describe, it, expect } from 'vitest'
import { resolveRelatedInAddressBook, isUrnUuid } from '../resolveRelated'
import type { Contact, ContactRelated } from '../../types'

const MINIMAL_CONTACT = (overrides: Partial<Contact>): Contact => ({
  id: 'default-id',
  addressBookId: 'ab-1',
  accountId: 'acc-1',
  url: '/carddav/contact.vcf',
  familyName: '',
  givenName: '',
  additionalNames: '',
  prefixes: '',
  suffixes: '',
  nickname: '',
  displayName: 'Test Contact',
  organization: '',
  department: '',
  title: '',
  role: '',
  emails: [],
  phones: [],
  addresses: [],
  urls: [],
  ims: [],
  birthday: null,
  anniversary: null,
  gender: '',
  note: '',
  categories: [],
  photo: null,
  isGroup: false,
  memberUids: [],
  langs: [],
  related: [],
  xmlData: null,
  opaqueLines: [],
  createdAt: '2024-01-01T00:00:00Z',
  lastModified: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('resolveRelatedInAddressBook', () => {
  const contactA = MINIMAL_CONTACT({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  const contactB = MINIMAL_CONTACT({ id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6', displayName: 'Bob' })

  it('resolves urn:uuid to contact by ID', () => {
    const rel: ContactRelated = {
      value: `urn:uuid:${contactB.id}`,
      type: 'spouse',
      isPrimary: false,
    }
    const resolved = resolveRelatedInAddressBook(rel, contactA, [contactA, contactB])
    expect(resolved).toBe(contactB)
  })

  it('handles case-insensitive UUID match (uppercase in relation)', () => {
    const rel: ContactRelated = {
      value: `URN:UUID:${contactB.id.toUpperCase()}`,
      type: 'friend',
      isPrimary: false,
    }
    const resolved = resolveRelatedInAddressBook(rel, contactA, [contactA, contactB])
    expect(resolved).toBe(contactB)
  })

  it('handles case-insensitive UUID match (mixed case in both)', () => {
    const mixedId = 'aAbBcCdD-e5F6-7890-aBcD-Ef1234567890'
    const upperContact = MINIMAL_CONTACT({ id: mixedId.toUpperCase() })
    const rel: ContactRelated = {
      value: `urn:uuid:${mixedId.toLowerCase()}`,
      type: 'co-worker',
      isPrimary: false,
    }
    const resolved = resolveRelatedInAddressBook(rel, contactA, [upperContact])
    expect(resolved).toBe(upperContact)
  })

  it('returns null for plain text value', () => {
    const rel: ContactRelated = {
      value: 'John Smith',
      type: 'co-worker',
      isPrimary: false,
    }
    const resolved = resolveRelatedInAddressBook(rel, contactA, [contactA, contactB])
    expect(resolved).toBeNull()
  })

  it('returns null for unresolved UUID', () => {
    const rel: ContactRelated = {
      value: 'urn:uuid:00000000-0000-0000-0000-000000000000',
      type: 'friend',
      isPrimary: false,
    }
    const resolved = resolveRelatedInAddressBook(rel, contactA, [contactA, contactB])
    expect(resolved).toBeNull()
  })

  it('returns null for HTTP URL value', () => {
    const rel: ContactRelated = {
      value: 'http://example.com/directory/jdoe.vcf',
      type: 'other',
      isPrimary: false,
    }
    const resolved = resolveRelatedInAddressBook(rel, contactA, [contactA, contactB])
    expect(resolved).toBeNull()
  })

  it('filters by same address book', () => {
    const contactC = MINIMAL_CONTACT({
      id: '11111111-2222-3333-4444-555555555555',
      addressBookId: 'ab-2',
    })
    const rel: ContactRelated = {
      value: `urn:uuid:${contactC.id}`,
      type: 'friend',
      isPrimary: false,
    }
    // contactA is in ab-1, contactC is in ab-2 — should NOT resolve
    const resolved = resolveRelatedInAddressBook(rel, contactA, [contactA, contactC])
    expect(resolved).toBeNull()
  })

  it('resolves within same address book', () => {
    const contactD = MINIMAL_CONTACT({
      id: '22222222-3333-4444-5555-666666666666',
      displayName: 'Diana',
    })
    const rel: ContactRelated = {
      value: `urn:uuid:${contactD.id}`,
      type: 'family',
      isPrimary: false,
    }
    // Both in ab-1 (default) — should resolve
    const resolved = resolveRelatedInAddressBook(rel, contactA, [contactA, contactD])
    expect(resolved).toBe(contactD)
  })
})

describe('isUrnUuid', () => {
  it('returns true for urn:uuid format', () => {
    expect(isUrnUuid('urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6')).toBe(true)
  })

  it('returns true for uppercase URN:UUID format', () => {
    expect(isUrnUuid('URN:UUID:F81D4FAE-7DEC-11D0-A765-00A0C91E6BF6')).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(isUrnUuid('John Smith')).toBe(false)
  })

  it('returns false for HTTP URLs', () => {
    expect(isUrnUuid('http://example.com/contact.vcf')).toBe(false)
  })
})
