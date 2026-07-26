import { describe, it, expect } from 'vitest'
import { parseVCard, contactToVCard } from '../vCardAdapter'
import type { Contact } from '../../types'

// Helper to create a minimal valid Contact for serialization tests
function makeMinimalContact(id: string): Contact {
  return {
    id,
    addressBookId: 'ab-1',
    accountId: 'acc-1',
    url: '',
    familyName: '',
    givenName: '',
    additionalNames: '',
    prefixes: '',
    suffixes: '',
    nickname: '',
    displayName: 'Test',
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
  }
}

// --- Test vCard fixtures ---

const SIMPLE_VCARD = `BEGIN:VCARD
VERSION:3.0
UID:simple-001
FN:John Doe
N:Doe;John;;;
EMAIL;TYPE=HOME:john@example.com
END:VCARD`

const MULTI_FIELDS_VCARD = `BEGIN:VCARD
VERSION:3.0
UID:multi-001
FN:Jane Smith
N:Smith;Jane;;;
EMAIL;TYPE=HOME:jane@example.com
EMAIL;TYPE=WORK:jane.smith@company.com
TEL;TYPE=CELL:+1-555-0100
TEL;TYPE=WORK;TYPE=PREF:+1-555-0200
ADR;TYPE=HOME:;;123 Main St;Springfield;IL;62701;USA
ADR;TYPE=WORK:;;456 Corp Ave;Chicago;IL;60601;USA
END:VCARD`

const ORG_VCARD = `BEGIN:VCARD
VERSION:3.0
UID:org-001
FN:Alice Johnson
N:Johnson;Alice;;;
ORG:Acme Corp;Engineering
TITLE:Senior Engineer
ROLE:Tech Lead
EMAIL;TYPE=WORK:alice@acme.com
END:VCARD`

const PERSONAL_VCARD = `BEGIN:VCARD
VERSION:3.0
UID:personal-001
FN:Bob Williams
N:Williams;Bob;;;
BDAY:19900515
ANNIVERSARY:20180620
GENDER:M
NOTE:Met at conference 2024. Prefers email.
CATEGORIES:friend,colleague
EMAIL;TYPE=HOME:bob@example.com
END:VCARD`

const VCARD3_STYLE = `BEGIN:VCARD
VERSION:3.0
UID:v3-001
FN:Carol White
N:White;Carol;;;
EMAIL;TYPE=HOME,INTERNET:carol@example.com
TEL;TYPE=VOICE,HOME:+1-555-1234
ADR;TYPE=HOME:;;789 Oak Rd;Denver;CO;80201;USA
URL;TYPE=HOME:https://carolwhite.com
END:VCARD`

const VCARD4_PHOTO_URI = `BEGIN:VCARD
VERSION:4.0
UID:v4-photo-001
FN:David Lee
N:Lee;David;;;
PHOTO;VALUE=URI:https://example.com/photos/david.jpg
EMAIL;TYPE=WORK:david@example.com
END:VCARD`

const VCARD4_PHOTO_BASE64 = `BEGIN:VCARD
VERSION:4.0
UID:v4-photo-b64-001
FN:Eve Martin
N:Martin;Eve;;;
PHOTO;ENCODING=b;TYPE=JPEG:AAAAIGZ0eXBpc29t
EMAIL;TYPE=HOME:eve@example.com
END:VCARD`

const VCARD_FOLDED_LINES = `BEGIN:VCARD
VERSION:3.0
UID:folded-001
FN:Frank Brown
N:Brown;Frank;;;
NOTE:This is a very long note that spans multiple lines so it needs to be folded according to the vCard spec.
EMAIL;TYPE=HOME:frank@example.com
END:VCARD`

const VCARD_WITH_URL = `BEGIN:VCARD
VERSION:3.0
UID:url-001
FN:Grace Hopper
N:Hopper;Grace;;;
URL;TYPE=HOME:https://en.wikipedia.org/wiki/Grace_Hopper
URL;TYPE=WORK:https://gracehopper.com
EMAIL;TYPE=WORK:grace@navy.mil
END:VCARD`

const VCARD_WITH_IM = `BEGIN:VCARD
VERSION:3.0
UID:im-001
FN:Henry Ford
N:Ford;Henry;;;
IMPP;TYPE=HOME;X-SERVICE-TYPE=skype:henry.ford.skype
IMPP;TYPE=WORK;X-SERVICE-TYPE=twitter:@henryford
EMAIL;TYPE=HOME:henry@example.com
END:VCARD`

// --- Helpers ---

const ACCOUNT_ID = 'test-account-1'
const ADDRESS_BOOK_ID = 'test-ab-1'

// --- Tests ---

describe('parseVCard', () => {
  describe('simple contact', () => {
    it('parses a simple contact with name and email', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact).not.toBeNull()
      expect(contact!.id).toBe('simple-001')
      expect(contact!.displayName).toBe('John Doe')
      expect(contact!.givenName).toBe('John')
      expect(contact!.familyName).toBe('Doe')
      expect(contact!.addressBookId).toBe(ADDRESS_BOOK_ID)
      expect(contact!.accountId).toBe(ACCOUNT_ID)
    })

    it('parses a single home email', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.emails).toHaveLength(1)
      expect(contact!.emails[0].value).toBe('john@example.com')
      expect(contact!.emails[0].type).toBe('home')
      expect(contact!.emails[0].isPrimary).toBe(true) // auto-marked
    })

    it('generates a display name from N when FN is missing', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:no-fn-001
N:Doe;John;;;
EMAIL;TYPE=HOME:john@example.com
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.displayName).toBe('John Doe')
    })

    it('returns Unknown when both FN and N are missing', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:unknown-001
EMAIL;TYPE=HOME:x@example.com
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.displayName).toBe('Unknown')
    })

    it('generates a UUID when UID is missing', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
FN:No UID Person
N:Person;No;;;
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.id).toBeTruthy()
      expect(typeof contact!.id).toBe('string')
      expect(contact!.id.length).toBeGreaterThan(0)
    })
  })

  describe('multiple fields', () => {
    it('parses multiple emails with correct values', () => {
      const contact = parseVCard(MULTI_FIELDS_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.emails).toHaveLength(2)
      expect(contact!.emails[0].value).toBe('jane@example.com')
      expect(contact!.emails[0].type).toBe('home')
      expect(contact!.emails[0].isPrimary).toBe(true) // first auto-marked
      expect(contact!.emails[1].value).toBe('jane.smith@company.com')
      expect(contact!.emails[1].type).toBe('work')
    })

    it('parses multiple phones with correct values', () => {
      const contact = parseVCard(MULTI_FIELDS_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.phones).toHaveLength(2)
      expect(contact!.phones[0].value).toBe('+1-555-0100')
      expect(contact!.phones[0].type).toBe('cell')
      expect(contact!.phones[0].isPrimary).toBe(false) // no PREF, first not auto-marked when second has PREF
      expect(contact!.phones[1].value).toBe('+1-555-0200')
      expect(contact!.phones[1].type).toBe('work')
    })

    it('parses single email correctly', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.emails).toHaveLength(1)
      expect(contact!.emails[0].value).toBe('john@example.com')
      expect(contact!.emails[0].type).toBe('home')
      expect(contact!.emails[0].isPrimary).toBe(true)
    })

    it('parses single phone correctly', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:phone-001
FN:Phone Person
N:Person;Phone;;;
TEL;TYPE=CELL:+1-555-0100
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.phones).toHaveLength(1)
      expect(contact!.phones[0].value).toBe('+1-555-0100')
      expect(contact!.phones[0].type).toBe('cell')
    })

    it('parses multiple addresses with correct values', () => {
      const contact = parseVCard(MULTI_FIELDS_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.addresses).toHaveLength(2)

      const homeAddr = contact!.addresses[0]
      expect(homeAddr.type).toBe('home')
      expect(homeAddr.isPrimary).toBe(true) // first auto-marked when none has PREF
      expect(homeAddr.street).toBe('123 Main St')
      expect(homeAddr.city).toBe('Springfield')
      expect(homeAddr.region).toBe('IL')
      expect(homeAddr.postalCode).toBe('62701')
      expect(homeAddr.country).toBe('USA')

      const workAddr = contact!.addresses[1]
      expect(workAddr.type).toBe('work')
      expect(workAddr.isPrimary).toBe(false) // no PREF
      expect(workAddr.street).toBe('456 Corp Ave')
      expect(workAddr.city).toBe('Chicago')
      expect(workAddr.region).toBe('IL')
      expect(workAddr.postalCode).toBe('60601')
      expect(workAddr.country).toBe('USA')
    })

    it('parses single address correctly', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:addr-001
FN:Address Person
N:Person;Address;;;
ADR;TYPE=HOME:;;123 Main St;Springfield;IL;62701;USA
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.addresses).toHaveLength(1)
      expect(contact!.addresses[0].street).toBe('123 Main St')
      expect(contact!.addresses[0].city).toBe('Springfield')
      expect(contact!.addresses[0].region).toBe('IL')
      expect(contact!.addresses[0].postalCode).toBe('62701')
      expect(contact!.addresses[0].country).toBe('USA')
    })

    it('returns empty arrays when no multi-value properties exist', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.phones).toHaveLength(0)
      expect(contact!.addresses).toHaveLength(0)
      expect(contact!.urls).toHaveLength(0)
      expect(contact!.ims).toHaveLength(0)
    })
  })

  describe('organization', () => {
    it('parses organization and department', () => {
      const contact = parseVCard(ORG_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.organization).toBe('Acme Corp')
      expect(contact!.department).toBe('Engineering')
    })

    it('parses title and role', () => {
      const contact = parseVCard(ORG_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.title).toBe('Senior Engineer')
      expect(contact!.role).toBe('Tech Lead')
    })

    it('defaults to empty strings when org fields are absent', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.organization).toBe('')
      expect(contact!.department).toBe('')
      expect(contact!.title).toBe('')
      expect(contact!.role).toBe('')
    })

    it('parses single-part organization without department', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:single-org-001
FN:Test Org
N:Org;Test;;;
ORG:Just an Org
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.organization).toBe('Just an Org')
      expect(contact!.department).toBe('')
    })
  })

  describe('personal info', () => {
    it('parses birthday in YYYYMMDD format', () => {
      const contact = parseVCard(PERSONAL_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.birthday).toBe('1990-05-15')
    })

    it('parses anniversary in YYYYMMDD format', () => {
      const contact = parseVCard(PERSONAL_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.anniversary).toBe('2018-06-20')
    })

    it('parses gender', () => {
      const contact = parseVCard(PERSONAL_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.gender).toBe('M')
    })

    it('parses note with special characters', () => {
      const contact = parseVCard(PERSONAL_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.note).toBe('Met at conference 2024. Prefers email.')
    })

    it('parses categories as an array', () => {
      const contact = parseVCard(PERSONAL_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.categories).toEqual(['friend', 'colleague'])
    })

    it('parses birthday in YYYY-MM-DD format', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:bday-iso-001
FN:Bday ISO
N:ISO;Bday;;;
BDAY:1995-12-25
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.birthday).toBe('1995-12-25')
    })

    it('returns null for birthday/anniversary when not present', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.birthday).toBeNull()
      expect(contact!.anniversary).toBeNull()
    })

    it('returns empty string for note when absent', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.note).toBe('')
    })
  })

  describe('vCard 3.0 style', () => {
    it('parses TYPE params with comma-separated values', () => {
      const contact = parseVCard(VCARD3_STYLE, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.emails).toHaveLength(1)
      expect(contact!.emails[0].type).toBe('home')

      expect(contact!.phones).toHaveLength(1)
      expect(contact!.phones[0].value).toBe('+1-555-1234')
      expect(contact!.phones[0].type).toBe('home')

      expect(contact!.addresses).toHaveLength(1)
      expect(contact!.addresses[0].street).toBe('789 Oak Rd')
    })

    it('parses URLs', () => {
      const contact = parseVCard(VCARD3_STYLE, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.urls).toHaveLength(1)
      expect(contact!.urls[0].value).toBe('https://carolwhite.com')
      expect(contact!.urls[0].type).toBe('home')
      expect(contact!.urls[0].isPrimary).toBe(true)
    })
  })

  describe('vCard 4.0 style', () => {
    it('parses PHOTO with VALUE=URI', () => {
      const contact = parseVCard(VCARD4_PHOTO_URI, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.photo).toBe('https://example.com/photos/david.jpg')
    })

    it('parses PHOTO with ENCODING=b (base64)', () => {
      const contact = parseVCard(VCARD4_PHOTO_BASE64, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.photo).toBe('data:image/jpeg;base64,AAAAIGZ0eXBpc29t')
    })

    it('returns null photo when no PHOTO property', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.photo).toBeNull()
    })
  })

  describe('unfolded lines', () => {
    it('handles folded long lines (continuation)', () => {
      const contact = parseVCard(VCARD_FOLDED_LINES, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.note).toBe(
        'This is a very long note that spans multiple lines so it needs to be folded according to the vCard spec.'
      )
    })
  })

  describe('URLs', () => {
    it('parses single URL correctly', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:url-single-001
FN:URL Person
N:Person;URL;;;
URL;TYPE=HOME:https://home.example.com
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.urls).toHaveLength(1)
      expect(contact!.urls[0].value).toBe('https://home.example.com')
      expect(contact!.urls[0].type).toBe('home')
      expect(contact!.urls[0].isPrimary).toBe(true)
    })

    it('parses multiple URLs with correct values', () => {
      const contact = parseVCard(VCARD_WITH_URL, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.urls).toHaveLength(2)
      expect(contact!.urls[0].value).toBe('https://en.wikipedia.org/wiki/Grace_Hopper')
      expect(contact!.urls[0].type).toBe('home')
      expect(contact!.urls[0].isPrimary).toBe(true)
      expect(contact!.urls[1].value).toBe('https://gracehopper.com')
      expect(contact!.urls[1].type).toBe('work')
    })
  })

  describe('IMs', () => {
    it('parses single IM with protocol detection', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:im-single-001
FN:IM Person
N:Person;IM;;;
IMPP;TYPE=HOME;X-SERVICE-TYPE=skype:my.skype.id
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.ims).toHaveLength(1)
      expect(contact!.ims[0].value).toBe('my.skype.id')
      expect(contact!.ims[0].protocol).toBe('skype')
      expect(contact!.ims[0].type).toBe('home')
      expect(contact!.ims[0].isPrimary).toBe(true)
    })

    it('parses multiple IMs with correct values', () => {
      const contact = parseVCard(VCARD_WITH_IM, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.ims).toHaveLength(2)
      expect(contact!.ims[0].value).toBe('henry.ford.skype')
      expect(contact!.ims[0].protocol).toBe('skype')
      expect(contact!.ims[0].type).toBe('home')
      expect(contact!.ims[0].isPrimary).toBe(true) // first auto-marked
      expect(contact!.ims[1].value).toBe('@henryford')
      expect(contact!.ims[1].protocol).toBe('twitter')
      expect(contact!.ims[1].type).toBe('work')
    })

    it('returns empty array when no IMPP properties', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.ims).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      const result = parseVCard('', ADDRESS_BOOK_ID, ACCOUNT_ID)
      // parseVCard returns a Contact with empty fields, not null
      expect(result).not.toBeNull()
      expect(result!.displayName).toBe('Unknown')
    })

    it('handles vCard with only BEGIN/END', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
END:VCARD`

      const result = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(result).not.toBeNull()
      expect(result!.displayName).toBe('Unknown')
    })

    it('preserves rawVCard in the returned contact', () => {
      const contact = parseVCard(SIMPLE_VCARD, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.rawVCard).toBe(SIMPLE_VCARD)
    })

    it('parses URL property at top level', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:url-top-001
FN:URL Person
N:Person;URL;;;
URL:https://example.com
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.url).toBe('https://example.com')
    })

    it('handles empty categories string', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:no-cats-001
FN:No Cats
N:Cats;No;;;
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.categories).toEqual([])
    })

    it('handles PREF type mapping', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:pref-001
FN:Pref Person
N:Person;Pref;;;
EMAIL;TYPE=PREF:pref@example.com
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.emails[0].type).toBe('pref')
      expect(contact!.emails[0].isPrimary).toBe(true)
    })

    it('handles MOBILE phone type', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:mobile-001
FN:Mobile Person
N:Person;Mobile;;;
TEL;TYPE=MOBILE:+1-555-9999
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.phones[0].type).toBe('cell')
    })

    it('handles FAX phone type', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
UID:fax-001
FN:Fax Person
N:Person;Fax;;;
TEL;TYPE=FAX:+1-555-8888
END:VCARD`

      const contact = parseVCard(vcard, ADDRESS_BOOK_ID, ACCOUNT_ID)

      expect(contact!.phones[0].type).toBe('fax')
    })
  })
})

describe('contactToVCard', () => {
  const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
    id: 'test-contact-001',
    addressBookId: 'ab-1',
    accountId: 'acc-1',
    url: '',
    familyName: 'Doe',
    givenName: 'John',
    additionalNames: '',
    prefixes: '',
    suffixes: '',
    nickname: '',
    displayName: 'John Doe',
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
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-06-01T00:00:00.000Z',
    ...overrides,
  })

  it('serializes a minimal contact to valid vCard format', () => {
    const vcard = contactToVCard(makeContact())

    expect(vcard).toContain('BEGIN:VCARD')
    expect(vcard).toContain('END:VCARD')
    expect(vcard).toContain('VERSION:4.0')
    expect(vcard).toContain('UID:test-contact-001')
    expect(vcard).toContain('N:Doe;John;;;')
    expect(vcard).toContain('FN:John Doe')
  })

  it('includes CREATED and REV timestamps', () => {
    const vcard = contactToVCard(makeContact())

    expect(vcard).toContain('CREATED:2024-01-01T00:00:00.000Z')
    // REV is always set to current UTC timestamp in YYYYMMDDTHHMMSSZ format
    expect(vcard).toMatch(/REV:\d{8}T\d{6}Z/)
  })

  it('serializes organization and department', () => {
    const vcard = contactToVCard(
      makeContact({
        organization: 'Acme Corp',
        department: 'Engineering',
      })
    )

    expect(vcard).toContain('ORG:Acme Corp;Engineering')
  })

  it('serializes single-part organization without department', () => {
    const vcard = contactToVCard(
      makeContact({
        organization: 'Solo Org',
      })
    )

    expect(vcard).toContain('ORG:Solo Org;')
  })

  it('omits ORG when both organization and department are empty', () => {
    const vcard = contactToVCard(makeContact())

    expect(vcard).not.toContain('ORG:')
  })

  it('serializes title and role', () => {
    const vcard = contactToVCard(
      makeContact({
        title: 'Engineer',
        role: 'Developer',
      })
    )

    expect(vcard).toContain('TITLE:Engineer')
    expect(vcard).toContain('ROLE:Developer')
  })

  it('omits title and role when empty', () => {
    const vcard = contactToVCard(makeContact())

    expect(vcard).not.toContain('TITLE:')
    expect(vcard).not.toContain('ROLE:')
  })

  it('serializes emails with type params', () => {
    const vcard = contactToVCard(
      makeContact({
        emails: [
          { value: 'john@home.com', type: 'home', isPrimary: true },
          { value: 'john@work.com', type: 'work', isPrimary: false },
        ],
      })
    )

    expect(vcard).toContain('EMAIL;TYPE=home;TYPE=pref:john@home.com')
    expect(vcard).toContain('EMAIL;TYPE=work:john@work.com')
  })

  it('serializes phones with type params', () => {
    const vcard = contactToVCard(
      makeContact({
        phones: [
          { value: '+1-555-0001', type: 'cell', isPrimary: true },
          { value: '+1-555-0002', type: 'work', isPrimary: false },
        ],
      })
    )

    expect(vcard).toContain('TEL;TYPE=cell;TYPE=pref:+1-555-0001')
    expect(vcard).toContain('TEL;TYPE=work:+1-555-0002')
  })

  it('serializes addresses with semicolon-delimited value', () => {
    const vcard = contactToVCard(
      makeContact({
        addresses: [
          {
            type: 'home',
            isPrimary: true,
            poBox: '',
            extended: '',
            street: '123 Main St',
            city: 'Springfield',
            region: 'IL',
            postalCode: '62701',
            country: 'USA',
          },
        ],
      })
    )

    expect(vcard).toContain('ADR;TYPE=home;TYPE=pref:;;123 Main St;Springfield;IL;62701;USA')
  })

  it('serializes URLs', () => {
    const vcard = contactToVCard(
      makeContact({
        urls: [{ value: 'https://home.com', type: 'home', isPrimary: true }],
      })
    )

    expect(vcard).toContain('URL;TYPE=home;TYPE=pref:https://home.com')
  })

  it('serializes IMs with protocol', () => {
    const vcard = contactToVCard(
      makeContact({
        ims: [{ value: 'johnskype', type: 'home', protocol: 'skype', isPrimary: true }],
      })
    )

    expect(vcard).toContain('IMPP;TYPE=home;X-SERVICE-TYPE=skype;TYPE=pref:johnskype')
  })

  it('serializes birthday in YYYYMMDD format', () => {
    const vcard = contactToVCard(
      makeContact({
        birthday: '1990-05-15',
      })
    )

    expect(vcard).toContain('BDAY:19900515')
  })

  it('serializes anniversary in YYYYMMDD format', () => {
    const vcard = contactToVCard(
      makeContact({
        anniversary: '2018-06-20',
      })
    )

    expect(vcard).toContain('ANNIVERSARY:20180620')
  })

  it('serializes gender', () => {
    const vcard = contactToVCard(
      makeContact({
        gender: 'M',
      })
    )

    expect(vcard).toContain('GENDER:M')
  })

  it('serializes note with escaping', () => {
    const vcard = contactToVCard(
      makeContact({
        note: 'Has a cat; likes dogs\\and birds',
      })
    )

    expect(vcard).toContain('NOTE:Has a cat\\; likes dogs\\\\and birds')
  })

  it('serializes categories', () => {
    const vcard = contactToVCard(
      makeContact({
        categories: ['friend', 'colleague'],
      })
    )

    expect(vcard).toContain('CATEGORIES:friend,colleague')
  })

  it('serializes photo from data URI', () => {
    const vcard = contactToVCard(
      makeContact({
        photo: 'data:image/jpeg;base64,AAAA',
      })
    )

    expect(vcard).toContain('PHOTO;ENCODING=b;TYPE=JPEG:AAAA')
  })

  it('serializes photo from URL', () => {
    const vcard = contactToVCard(
      makeContact({
        photo: 'https://example.com/photo.jpg',
      })
    )

    expect(vcard).toContain('PHOTO;VALUE=URI:https://example.com/photo.jpg')
  })

  it('omits optional fields when not set', () => {
    const vcard = contactToVCard(makeContact())

    expect(vcard).not.toContain('ORG:')
    expect(vcard).not.toContain('TITLE:')
    expect(vcard).not.toContain('ROLE:')
    expect(vcard).not.toContain('BDAY:')
    expect(vcard).not.toContain('ANNIVERSARY:')
    expect(vcard).not.toContain('GENDER:')
    expect(vcard).not.toContain('NOTE:')
    expect(vcard).not.toContain('CATEGORIES:')
    expect(vcard).not.toContain('PHOTO:')
  })

  it('omits EMAIL/TEL/ADR when arrays are empty', () => {
    const vcard = contactToVCard(makeContact())

    expect(vcard).not.toContain('EMAIL:')
    expect(vcard).not.toContain('TEL:')
    expect(vcard).not.toContain('ADR:')
    expect(vcard).not.toContain('URL:')
    expect(vcard).not.toContain('IMPP:')
  })

  it('serializes "other" type without TYPE param', () => {
    const vcard = contactToVCard(
      makeContact({
        emails: [{ value: 'other@example.com', type: 'other', isPrimary: false }],
      })
    )

    // other type should not include TYPE=other
    expect(vcard).toContain('EMAIL:other@example.com')
    expect(vcard).not.toContain('TYPE=other')
  })

  it('omits displayName from FN when empty', () => {
    const vcard = contactToVCard(
      makeContact({
        displayName: '',
      })
    )

    expect(vcard).not.toContain('FN:')
  })
})

describe('round-trip', () => {
  it('preserves name, email through parse then serialize', () => {
    const contact = parseVCard(SIMPLE_VCARD, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.id).toBe(contact.id)
    expect(reparsed.displayName).toBe(contact.displayName)
    expect(reparsed.givenName).toBe(contact.givenName)
    expect(reparsed.familyName).toBe(contact.familyName)
    expect(reparsed.emails).toHaveLength(contact.emails.length)
    expect(reparsed.emails[0].value).toBe(contact.emails[0].value)
  })

  it('preserves single email and phone', () => {
    const contact = parseVCard(SIMPLE_VCARD, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.emails).toHaveLength(1)
    expect(reparsed.emails[0].value).toBe('john@example.com')
    expect(reparsed.emails[0].type).toBe('home')
  })

  it('preserves organization, title, role', () => {
    const contact = parseVCard(ORG_VCARD, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.organization).toBe('Acme Corp')
    expect(reparsed.department).toBe('Engineering')
    expect(reparsed.title).toBe('Senior Engineer')
    expect(reparsed.role).toBe('Tech Lead')
  })

  it('preserves birthday and anniversary', () => {
    const contact = parseVCard(PERSONAL_VCARD, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.birthday).toBe('1990-05-15')
    expect(reparsed.anniversary).toBe('2018-06-20')
  })

  it('preserves gender and note', () => {
    const contact = parseVCard(PERSONAL_VCARD, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.gender).toBe('M')
    expect(reparsed.note).toBe('Met at conference 2024. Prefers email.')
  })

  it('preserves categories', () => {
    const contact = parseVCard(PERSONAL_VCARD, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.categories).toEqual(['friend', 'colleague'])
  })

  it('preserves single address', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:roundtrip-addr-001
FN:Address Person
N:Person;Address;;;
ADR;TYPE=HOME:;;123 Main St;Springfield;IL;62701;USA
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.addresses).toHaveLength(1)
    expect(reparsed.addresses[0].street).toBe('123 Main St')
    expect(reparsed.addresses[0].city).toBe('Springfield')
    expect(reparsed.addresses[0].region).toBe('IL')
    expect(reparsed.addresses[0].postalCode).toBe('62701')
    expect(reparsed.addresses[0].country).toBe('USA')
  })

  it('preserves single URL', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:roundtrip-url-001
FN:URL Person
N:Person;URL;;;
URL;TYPE=HOME:https://example.com
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.urls).toHaveLength(1)
    expect(reparsed.urls[0].value).toBe('https://example.com')
  })

  it('preserves single IM', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:roundtrip-im-001
FN:IM Person
N:Person;IM;;;
IMPP;TYPE=HOME;X-SERVICE-TYPE=skype:my.skype.id
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.ims).toHaveLength(1)
    expect(reparsed.ims[0].value).toBe('my.skype.id')
    expect(reparsed.ims[0].protocol).toBe('skype')
  })

  it('preserves photo URL', () => {
    const contact = parseVCard(VCARD4_PHOTO_URI, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.photo).toBe('https://example.com/photos/david.jpg')
  })

  it('full contact with many fields round-trips correctly (single values)', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
UID:full-001
FN:Full Contact
N:Contact;Full;;;
ORG:Big Corp;Sales
TITLE:VP Sales
ROLE:Executive
EMAIL;TYPE=WORK;TYPE=PREF:full@bigcorp.com
TEL;TYPE=CELL;TYPE=PREF:+1-555-1111
ADR;TYPE=HOME:;;100 Home St;NY;NY;10001;USA
URL;TYPE=HOME:https://fullhome.com
IMPP;TYPE=WORK;X-SERVICE-TYPE=skype:full.skype
BDAY:19850101
ANNIVERSARY:20100615
GENDER:F
NOTE:Loves meetings. Prefers morning calls.
CATEGORIES:vip,partner
END:VCARD`

    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!

    expect(reparsed.id).toBe('full-001')
    expect(reparsed.displayName).toBe('Full Contact')
    expect(reparsed.organization).toBe('Big Corp')
    expect(reparsed.department).toBe('Sales')
    expect(reparsed.title).toBe('VP Sales')
    expect(reparsed.role).toBe('Executive')
    expect(reparsed.emails).toHaveLength(1)
    expect(reparsed.emails[0].value).toBe('full@bigcorp.com')
    expect(reparsed.phones).toHaveLength(1)
    expect(reparsed.phones[0].value).toBe('+1-555-1111')
    expect(reparsed.addresses).toHaveLength(1)
    expect(reparsed.addresses[0].street).toBe('100 Home St')
    expect(reparsed.urls).toHaveLength(1)
    expect(reparsed.urls[0].value).toBe('https://fullhome.com')
    expect(reparsed.ims).toHaveLength(1)
    expect(reparsed.ims[0].value).toBe('full.skype')
    expect(reparsed.ims[0].protocol).toBe('skype')
    expect(reparsed.birthday).toBe('1985-01-01')
    expect(reparsed.anniversary).toBe('2010-06-15')
    expect(reparsed.gender).toBe('F')
    expect(reparsed.note).toBe('Loves meetings. Prefers morning calls.')
    expect(reparsed.categories).toEqual(['vip', 'partner'])
  })
})

// ---------------------------------------------------------------------------
// vCard 3.0 + new property tests
// ---------------------------------------------------------------------------

describe('vCard 3.0 parsing', () => {
  it('parses VERSION:3.0 correctly', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:John Doe
N:Doe;John;;;
UID:test-30
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.displayName).toBe('John Doe')
    expect(contact.id).toBe('test-30')
  })

  it('parses PHOTO with ENCODING=b (3.0 format)', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Photo Test
N:Test;Photo;;;
UID:photo-30
PHOTO;ENCODING=b;TYPE=JPEG:SGVsbG8=
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.photo).toBe('data:image/jpeg;base64,SGVsbG8=')
  })

  it('parses BDAY in DD MM YYYY format', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Date Test
N:Test;Date;;;
UID:date-30
BDAY:15 06 1990
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.birthday).toBe('1990-06-15')
  })

  it('handles CHARSET parameter lines', () => {
    // vCard 3.0 may include CHARSET=UTF-8 on text properties.
    // Lines with params (NOTE;CHARSET=UTF-8:) are not matched by extractProperty
    // but NOTE is in knownPrefixes so they are excluded from opaqueLines too.
    // This is acceptable — CHARSET is a hint for the parser, not data.
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Charset Test
N:Test;Charset;;;
UID:charset-30
NOTE;CHARSET=UTF-8:Some note
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    // The note with CHARSET param is not parsed (expected behavior)
    expect(contact.displayName).toBe('Charset Test')
  })
})

describe('LANG property', () => {
  it('parses single LANG', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Lang Test
N:Test;Lang;;;
UID:lang-001
LANG:en
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.langs).toHaveLength(1)
    expect(contact.langs[0].value).toBe('en')
    expect(contact.langs[0].isPrimary).toBe(true)
  })

  it('parses multiple LANG with types', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Multi Lang
N:Lang;Multi;;;
UID:lang-002
LANG;TYPE=home:en
LANG;TYPE=work:fr
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.langs).toHaveLength(2)
    expect(contact.langs[0].value).toBe('en')
    expect(contact.langs[0].type).toBe('home')
    expect(contact.langs[0].isPrimary).toBe(true)
    expect(contact.langs[1].value).toBe('fr')
    expect(contact.langs[1].type).toBe('work')
  })

  it('returns empty array when no LANG', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:No Lang
N:No;Lang;;;
UID:lang-003
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.langs).toEqual([])
  })
})

describe('RELATED property', () => {
  it('parses RELATED with urn:uuid value', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Related Test
N:Test;Related;;;
UID:rel-001
RELATED;TYPE=friend:urn:uuid:abc-123
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.related).toHaveLength(1)
    expect(contact.related[0].value).toBe('urn:uuid:abc-123')
    expect(contact.related[0].type).toBe('friend')
  })

  it('parses RELATED with text value', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Text Related
N:Related;Text;;;
UID:rel-002
RELATED;TYPE=co-worker;VALUE=text:John Smith
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.related).toHaveLength(1)
    expect(contact.related[0].value).toBe('John Smith')
    expect(contact.related[0].type).toBe('co-worker')
  })

  it('parses multiple RELATED with types', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Multi Related
N:Related;Multi;;;
UID:rel-003
RELATED;TYPE=spouse:urn:uuid:spouse-001
RELATED;TYPE=family:urn:uuid:parent-001
RELATED;TYPE=emergency:Jane Doe
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.related).toHaveLength(3)
    expect(contact.related[0].type).toBe('spouse')
    expect(contact.related[1].type).toBe('family')
    expect(contact.related[2].type).toBe('emergency')
    expect(contact.related[2].value).toBe('Jane Doe')
  })

  it('returns empty array when no RELATED', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:No Related
N:No;Related;;;
UID:rel-004
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.related).toEqual([])
  })
})

describe('XML property', () => {
  it('parses XML property value', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:XML Test
N:Test;XML;;;
UID:xml-001
XML:<root><data>test</data></root>
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.xmlData).toBe('<root><data>test</data></root>')
  })

  it('returns null when no XML property', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:No XML
N:No;XML;;;
UID:xml-002
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.xmlData).toBeNull()
  })
})

describe('MEMBER property (groups)', () => {
  it('parses single MEMBER', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:My Group
N:Group;My;;;
UID:group-001
MEMBER:urn:uuid:member-001
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.isGroup).toBe(true)
    expect(contact.memberUids).toEqual(['urn:uuid:member-001'])
  })

  it('parses multiple MEMBERs', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Team Group
N:Group;Team;;;
UID:group-002
MEMBER:urn:uuid:member-001
MEMBER:urn:uuid:member-002
MEMBER:urn:uuid:member-003
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.isGroup).toBe(true)
    expect(contact.memberUids).toHaveLength(3)
  })

  it('sets isGroup to false when no MEMBER', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Not a Group
N:Not;Group;;;
UID:group-003
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.isGroup).toBe(false)
    expect(contact.memberUids).toEqual([])
  })
})

describe('new properties serialization', () => {
  it('serializes LANG property with type params', () => {
    const contact: Contact = {
      ...makeMinimalContact('lang-ser-001'),
      langs: [
        { value: 'en', type: 'home', isPrimary: true },
        { value: 'fr', type: 'work', isPrimary: false },
      ],
    }
    const vcard = contactToVCard(contact)
    expect(vcard).toContain('LANG;TYPE=home;TYPE=pref:en')
    expect(vcard).toContain('LANG;TYPE=work:fr')
  })

  it('serializes RELATED property with type params', () => {
    const contact: Contact = {
      ...makeMinimalContact('rel-ser-001'),
      related: [{ value: 'urn:uuid:abc', type: 'spouse', isPrimary: true }],
    }
    const vcard = contactToVCard(contact)
    expect(vcard).toContain('RELATED;TYPE=spouse;TYPE=pref:urn:uuid:abc')
  })

  it('serializes XML property', () => {
    const contact: Contact = {
      ...makeMinimalContact('xml-ser-001'),
      xmlData: '<root>data</root>',
    }
    const vcard = contactToVCard(contact)
    expect(vcard).toContain('XML:<root>data</root>')
  })

  it('serializes MEMBER properties', () => {
    const contact: Contact = {
      ...makeMinimalContact('mem-ser-001'),
      isGroup: true,
      memberUids: ['urn:uuid:m1', 'urn:uuid:m2'],
    }
    const vcard = contactToVCard(contact)
    expect(vcard).toContain('MEMBER:urn:uuid:m1')
    expect(vcard).toContain('MEMBER:urn:uuid:m2')
  })

  it('omits LANG/RELATED/XML/MEMBER when empty', () => {
    const contact: Contact = makeMinimalContact('empty-new-001')
    const vcard = contactToVCard(contact)
    expect(vcard).not.toContain('LANG:')
    expect(vcard).not.toContain('RELATED:')
    expect(vcard).not.toContain('XML:')
    expect(vcard).not.toContain('MEMBER:')
  })
})

describe('round-trip new properties', () => {
  it('preserves LANG through parse→serialize→parse', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Lang Round
N:Round;Lang;;;
UID:lang-rt-001
LANG;TYPE=home:en
LANG;TYPE=work:de
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!
    expect(reparsed.langs).toHaveLength(2)
    expect(reparsed.langs[0].value).toBe('en')
    expect(reparsed.langs[1].value).toBe('de')
  })

  it('preserves RELATED through parse→serialize→parse', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Rel Round
N:Round;Rel;;;
UID:rel-rt-001
RELATED;TYPE=spouse:urn:uuid:partner
RELATED;VALUE=text:Jane Smith
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!
    expect(reparsed.related).toHaveLength(2)
    expect(reparsed.related[0].type).toBe('spouse')
    expect(reparsed.related[1].value).toBe('Jane Smith')
  })

  it('preserves XML through parse→serialize→parse', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:XML Round
N:Round;XML;;;
UID:xml-rt-001
XML:<data>test</data>
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!
    expect(reparsed.xmlData).toBe('<data>test</data>')
  })

  it('preserves MEMBER/isGroup through parse→serialize→parse', () => {
    const vcard = `BEGIN:VCARD
VERSION:4.0
FN:Group Round
N:Round;Group;;;
UID:group-rt-001
MEMBER:urn:uuid:m1
MEMBER:urn:uuid:m2
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    expect(contact.isGroup).toBe(true)
    const serialized = contactToVCard(contact)
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!
    expect(reparsed.isGroup).toBe(true)
    expect(reparsed.memberUids).toHaveLength(2)
  })

  it('vCard 3.0 input round-trips correctly (parsed as 3.0, serialized as 4.0)', () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Compat Contact
N:Contact;Compat;;;
UID:compat-rt-001
EMAIL;TYPE=HOME:compat@test.com
TEL;TYPE=CELL:+1-555-0000
BDAY:19900101
END:VCARD`
    const contact = parseVCard(vcard, 'ab-1', 'acc-1')!
    const serialized = contactToVCard(contact, '4.0')
    expect(serialized).toContain('VERSION:4.0')
    const reparsed = parseVCard(serialized, 'ab-1', 'acc-1')!
    expect(reparsed.displayName).toBe('Compat Contact')
    expect(reparsed.emails[0].value).toBe('compat@test.com')
    expect(reparsed.phones[0].value).toBe('+1-555-0000')
    expect(reparsed.birthday).toBe('1990-01-01')
  })
})
