import { describe, expect, it } from 'vitest'
import { parseVCard } from '@/features/carddav/adapter/vCardAdapter'
import { CardDAVClient } from '@/features/carddav/client/CardDAVClient'
import type { ContactsBackend } from '@/features/carddav/client/ContactsBackend'
import { applyJmapPatch } from '../../convert/jscalendarDiff'
import { jscontactToVCard } from '../convert/jscontactToVCard'
import { vCardToJscontact } from '../convert/vCardToJscontact'
import { contactPatch, diffJscontact } from '../convert/jscontactDiff'
import type { JSContactCard } from '../convert/values'
import person from './fixtures/person.json'
import vcard from './fixtures/person.vcf?raw'
import group from './fixtures/group.json'
import groupVcard from './fixtures/group.vcf?raw'
import photo from './fixtures/photo.json'
import photoVcard from './fixtures/photo.vcf?raw'

// Compile-time guard for migration: no casts, adapters or CardDAV modifications.
const legacy = new CardDAVClient('https://contacts.test', {
  id: 'test',
  serverUrl: 'https://contacts.test',
  username: 'test',
  password: '',
}) satisfies ContactsBackend

describe('hand-authored JSContact/vCard paired fixtures', () => {
  it.each([
    { name: 'group', card: group, input: groupVcard },
    { name: 'photo', card: photo, input: photoVcard },
  ])('maps the paired $name fixture in both directions', ({ card, input }) => {
    expect(vCardToJscontact(input)).toEqual(card)
    expect(vCardToJscontact(jscontactToVCard(card))).toEqual(card)
  })
  it('keeps the existing CardDAV call surface assignable', () => {
    expect(legacy).toBeInstanceOf(CardDAVClient)
  })
  it('maps every paired property to the independently authored JSON fixture', () => {
    expect(vCardToJscontact(vcard)).toEqual(person)
  })
  it.each(['4.0', '3.0'] as const)(
    'writes parser-compatible vCard %s and round-trips its semantic projection',
    (version) => {
      const output = jscontactToVCard(person, { version })
      const parsed = parseVCard(output, 'book', 'account')!
      expect(parsed).toMatchObject({
        id: 'urn:uuid:calino-person',
        displayName: 'Ada Lovelace',
        familyName: 'Lovelace',
        givenName: 'Ada',
        nickname: 'Enchantress',
        organization: 'Analytical Engines',
        department: 'Research',
        title: 'Programmer',
        role: 'Mathematician',
        birthday: '1815-12-10',
        anniversary: '1835-07-08',
        note: 'First algorithm\nPublished notes',
        categories: ['mathematics', 'history'],
        photo: 'https://example.test/ada.png',
      })
      expect(parsed.emails).toHaveLength(2)
      expect(parsed.emails[0]).toMatchObject({ type: 'work', isPrimary: true })
      expect(parsed.phones).toHaveLength(2)
      expect(parsed.addresses[0]).toMatchObject({
        street: '12 Engine Road',
        city: 'London',
        postalCode: 'NW1',
      })
      expect(parsed.ims[0].value).toBe('xmpp:ada@example.test')
      expect(parsed.related[0]).toMatchObject({ type: 'friend', value: 'urn:uuid:charles' })
      expect(vCardToJscontact(output)).toEqual(person)
    }
  )
  it('supports groups including empty groups without inventing members', () => {
    const group = {
      '@type': 'Card',
      version: '1.0',
      uid: 'group',
      kind: 'group',
      name: { '@type': 'Name', full: 'Friends' },
      members: { 'urn:uuid:a': true, 'mailto:b@example.test': true },
    }
    const output = jscontactToVCard(group)
    expect(output).toContain('KIND:group')
    expect(parseVCard(output, '', '')!.memberUids).toEqual(['urn:uuid:a', 'mailto:b@example.test'])
    expect(vCardToJscontact(output)).toMatchObject(group)
    expect(vCardToJscontact(jscontactToVCard({ ...group, members: {} })).kind).toBe('group')
  })
  it.each(['4.0', '3.0'] as const)(
    'preserves inline photo MIME and bytes in version %s',
    (version) => {
      const card = vCardToJscontact(
        'BEGIN:VCARD\nVERSION:3.0\nFN:Photo\nPHOTO;ENCODING=b;TYPE=PNG:aGVsbG8=\nEND:VCARD'
      )
      expect(card.media).toEqual({
        media1: {
          '@type': 'Media',
          kind: 'photo',
          uri: 'data:image/png;base64,aGVsbG8=',
          mediaType: 'image/png',
        },
      })
      expect(vCardToJscontact(jscontactToVCard(card, { version })).media).toEqual(card.media)
    }
  )
  it('keeps partial dates, numeric pref, features, full addresses and language selection', () => {
    const card: JSContactCard = {
      '@type': 'Card',
      version: '1.0',
      uid: 'test',
      name: { '@type': 'Name', full: 'Base' },
      localizations: { da: { 'name/full': 'Dansk' } },
      addresses: { a: { '@type': 'Address', full: 'Street\nCity' } },
      anniversaries: {
        b: {
          '@type': 'Anniversary',
          kind: 'birth',
          date: { '@type': 'PartialDate', month: 10, day: 6 },
        },
      },
      phones: {
        p: {
          '@type': 'Phone',
          number: '123',
          features: { voice: true, text: true },
          contexts: { work: true },
          pref: 7,
        },
      },
    }
    const output = jscontactToVCard(card)
    expect(output).toContain('FN:Base')
    expect(output).toContain('BDAY:--1006')
    expect(output).toContain('LABEL="Street^nCity"')
    expect(parseVCard(output, '', '')!.addresses[0].street).toBe('Street\nCity')
    expect(jscontactToVCard(card, { language: 'da' })).toContain('FN:Dansk')
    expect(vCardToJscontact(output)).toMatchObject({
      phones: { phones1: { pref: 7, features: { voice: true, text: true } } },
      anniversaries: { anniversaries1: { date: { month: 10, day: 6 } } },
    })
    expect(
      vCardToJscontact('BEGIN:VCARD\nVERSION:4.0\nFN:Base\nFN;LANGUAGE=da:Dansk\nEND:VCARD')
        .localizations
    ).toEqual({ da: { 'name/full': 'Dansk' } })
  })
  it('handles escaped separators, caret parameters, grouping, UTF-8 folds and hostile map keys', () => {
    const note = '😀漢字é'.repeat(40) + '\ncomma, semi; slash\\ end'
    const card = {
      '@type': 'Card',
      version: '1.0',
      uid: 'unicode',
      name: { '@type': 'Name', full: 'Test' },
      notes: { n: { '@type': 'Note', note } },
      keywords: Object.fromEntries([
        ['__proto__', true],
        ['a,b', true],
      ]),
    }
    const output = jscontactToVCard(card)
    for (const line of output.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(vCardToJscontact(output)).toMatchObject({
      notes: { notes1: { note } },
      keywords: card.keywords,
    })
    const grouped = vCardToJscontact(
      'BEGIN:VCARD\nVERSION:4.0\nFN:Test\nitem1.EMAIL;TYPE=work;PREF=2:a@example.test\nADR;LABEL="One: two^nThree";TYPE=home:;;One\\;Two;City;;;\nEND:VCARD'
    )
    expect(grouped).toMatchObject({
      emails: { emails1: { pref: 2 } },
      addresses: {
        addresses1: {
          full: 'One: two\nThree',
          components: [
            { '@type': 'AddressComponent', kind: 'street', value: 'One;Two' },
            { '@type': 'AddressComponent', kind: 'locality', value: 'City' },
          ],
        },
      },
    })
  })
  it('drops X properties and rejects malformed/multiple resources', () => {
    expect(
      vCardToJscontact('BEGIN:VCARD\nVERSION:4.0\nFN:Test\nX-CUSTOM:secret\nEND:VCARD')
    ).not.toHaveProperty('x-custom')
    expect(() => vCardToJscontact('FN:Broken')).toThrow()
    expect(() => vCardToJscontact(vcard + '\n' + vcard)).toThrow()
  })
})

describe('JSContact update patches', () => {
  it('escapes paths, removes represented fields and ignores server audit fields', () => {
    const before = {
      id: 'server',
      created: 'a',
      notes: { 'n/~': { note: 'old' } },
      keywords: { gone: true },
    }
    const after = { id: 'other', created: 'b', notes: { 'n/~': { note: 'new' } } }
    const patch = diffJscontact(before, after)
    expect(patch).toEqual({ 'notes/n~1~0/note': 'new', keywords: null })
    expect(applyJmapPatch(before, patch)).toEqual({ ...after, id: 'server', created: 'a' })
  })
  it('preserves server defaults, arbitrary ids, nested extensions, localizations and unedited lossy values', () => {
    const card: JSContactCard = {
      ...person,
      serverExtension: 'retain',
      localizations: { fr: { 'name/full': 'Ada FR' } },
      emails: {
        'server/~id': {
          '@type': 'EmailAddress',
          address: 'ada@example.test',
          contexts: { work: true },
          pref: 1,
          label: 'Original',
          vendor: 'keep',
        },
      },
    }
    const next = vCardToJscontact(jscontactToVCard(card))
    expect(contactPatch(card, next)).toEqual({})
    ;(next.name as JSContactCard).full = 'Changed'
    ;((next.emails as JSContactCard).emails1 as JSContactCard).address = 'new@example.test'
    const patch = contactPatch(card, next)
    expect(patch).toEqual({
      'name/full': 'Changed',
      'emails/server~1~0id/address': 'new@example.test',
    })
    expect(applyJmapPatch(card, patch)).toMatchObject({
      serverExtension: 'retain',
      localizations: card.localizations,
      emails: { 'server/~id': { label: 'Original', vendor: 'keep', address: 'new@example.test' } },
    })
  })
  it('retains unchanged entry ids when another entry is removed', () => {
    const card = {
      ...person,
      emails: {
        first: { '@type': 'EmailAddress', address: 'a@test' },
        second: { '@type': 'EmailAddress', address: 'b@test', label: 'keep' },
      },
    }
    const next = vCardToJscontact(jscontactToVCard(card).replace('EMAIL:a@test\r\n', ''))
    expect(contactPatch(card, next)).toEqual({ 'emails/first': null })
  })
})
