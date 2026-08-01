import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useContactStore } from '@/store/contactStore'
import { createLocalStorageMock } from '@/test/storageMock'
import type { Contact } from '@/features/carddav/types'

// IndexedDB isn't available under jsdom, so the photo store is stubbed and the
// sync logic (rescue / hydrate / diff) is what's under test.
const mocks = vi.hoisted(() => ({
  putPhotos: vi.fn().mockResolvedValue(undefined),
  deletePhotos: vi.fn().mockResolvedValue(undefined),
  stored: new Map<string, string>(),
}))

vi.mock('@/lib/contactPhotoStore', () => ({
  putPhotos: mocks.putPhotos,
  deletePhotos: mocks.deletePhotos,
  getAllPhotos: () => Promise.resolve(mocks.stored),
}))

const INLINE_PHOTO = 'data:image/jpeg;base64,SGVsbG8='
const URL_PHOTO = 'https://example.com/photos/david.jpg'

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    uid: 'uid-1',
    addressBookId: 'book-1',
    firstName: 'John',
    lastName: 'Doe',
    middleName: '',
    prefix: '',
    suffix: '',
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
    createdAt: '2024-01-01T00:00:00Z',
    lastModified: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Contact
}

describe('contactStore — what reaches localStorage', () => {
  const storage = createLocalStorageMock()

  /** The contacts as they actually landed in localStorage. */
  function persistedContacts(): Record<string, unknown>[] {
    const raw = localStorage.getItem('calino-contacts')
    expect(raw).toBeTruthy()
    return JSON.parse(raw!).state.contacts
  }

  beforeEach(() => {
    storage.install()
    useContactStore.setState({ contacts: [], addressBooks: [], pendingChanges: [] })
  })

  afterEach(() => {
    storage.reset()
  })

  it('keeps inline photo data out of the persisted blob', () => {
    useContactStore.getState().setContacts([contact({ photo: INLINE_PHOTO })])

    expect(persistedContacts()[0]!.photo).toBeNull()
    expect(localStorage.getItem('calino-contacts')).not.toContain('base64')
  })

  it('keeps external photo URLs, which are cheap and round-trip as PHOTO;VALUE=URI', () => {
    useContactStore.getState().setContacts([contact({ photo: URL_PHOTO })])

    expect(persistedContacts()[0]!.photo).toBe(URL_PHOTO)
  })

  it('drops rawVCard, which embedded a second copy of the photo', () => {
    const rawVCard = `BEGIN:VCARD\nPHOTO;ENCODING=b:SGVsbG8=\nEND:VCARD`
    useContactStore.getState().setContacts([contact({ photo: INLINE_PHOTO, rawVCard })])

    expect(persistedContacts()[0]).not.toHaveProperty('rawVCard')
  })

  it('leaves the photo on the in-memory contact so the UI and vCard export still see it', () => {
    useContactStore.getState().setContacts([contact({ photo: INLINE_PHOTO })])

    expect(useContactStore.getState().contacts[0]!.photo).toBe(INLINE_PHOTO)
  })
})

describe('contactPhotoSync', () => {
  const { putPhotos, deletePhotos, stored } = mocks

  /**
   * A fresh module graph per test — contactPhotoSync keeps its "already
   * started" flag and its last-written map in module scope, and the store it
   * subscribes to must be the same instance the test drives.
   */
  async function freshSync(contacts: Contact[]): Promise<typeof useContactStore> {
    vi.resetModules()
    const store = (await import('@/store/contactStore')).useContactStore
    store.setState({ contacts, addressBooks: [], pendingChanges: [] })
    const { initContactPhotos } = await import('@/lib/contactPhotoSync')
    await initContactPhotos()
    return store
  }

  beforeEach(() => {
    putPhotos.mockClear()
    deletePhotos.mockClear()
    stored.clear()
  })

  it('rescues photos left inline by a pre-migration blob', async () => {
    await freshSync([contact({ photo: INLINE_PHOTO })])

    expect(putPhotos).toHaveBeenCalledWith([{ contactId: 'contact-1', photo: INLINE_PHOTO }])
  })

  it('puts stored photos back onto contacts that were persisted without them', async () => {
    stored.set('contact-1', INLINE_PHOTO)
    const store = await freshSync([contact({ photo: null })])

    expect(store.getState().contacts[0]!.photo).toBe(INLINE_PHOTO)
  })

  it('does not clobber a photo a sync landed while the read was in flight', async () => {
    stored.set('contact-1', INLINE_PHOTO)
    const store = await freshSync([contact({ photo: 'data:image/jpeg;base64,bmV3' })])

    expect(store.getState().contacts[0]!.photo).toBe('data:image/jpeg;base64,bmV3')
  })

  it('writes a newly set photo through, and deletes it when the contact goes', async () => {
    const store = await freshSync([contact({ photo: null })])
    putPhotos.mockClear()

    store.getState().updateContact('contact-1', { photo: INLINE_PHOTO })
    expect(putPhotos).toHaveBeenCalledWith([{ contactId: 'contact-1', photo: INLINE_PHOTO }])

    store.getState().deleteContact('contact-1')
    expect(deletePhotos).toHaveBeenCalledWith(['contact-1'])
  })

  it('does not delete stored photos just because hydration has not run', async () => {
    // The subscription must not start before hydration: at that point every
    // photo is null and a naive diff would wipe the whole table.
    stored.set('contact-1', INLINE_PHOTO)
    await freshSync([contact({ photo: null })])

    expect(deletePhotos).not.toHaveBeenCalled()
  })
})
