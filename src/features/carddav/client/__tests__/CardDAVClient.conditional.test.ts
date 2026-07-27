import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AddressBook } from '../../types'

vi.mock('@/lib/webFetch')

import { webFetch } from '@/lib/webFetch'
import { CardDAVClient } from '../CardDAVClient'

const mockFetch = webFetch as unknown as ReturnType<typeof vi.fn>

const BOOK: AddressBook = {
  id: 'https://dav.example/book/',
  url: 'https://dav.example/book/',
  name: 'Book',
  accountId: 'acct',
  isVisible: true,
} as AddressBook

const CONTACT_URL = 'https://dav.example/book/alice.vcf'

function makeClient(): CardDAVClient {
  return new CardDAVClient('https://dav.example/', { username: 'u', password: 'p' })
}

function headersOf(callIndex = 0): Record<string, string> {
  return mockFetch.mock.calls[callIndex][1].headers as Record<string, string>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({
    ok: true,
    status: 204,
    statusText: 'No Content',
    headers: new Headers(),
    text: async () => '',
  })
})

describe('CardDAVClient — conditional requests', () => {
  // Servers hand out etags already quoted. Wrapping them again produces `""abc""`, which
  // matches nothing: every delete and update came back 412 and silently never happened.
  it('sends exactly one pair of quotes for an etag the server already quoted', async () => {
    await makeClient().deleteContact(BOOK, CONTACT_URL, '"abc123"')

    expect(headersOf()['If-Match']).toBe('"abc123"')
  })

  it('quotes a bare etag', async () => {
    await makeClient().deleteContact(BOOK, CONTACT_URL, 'abc123')

    expect(headersOf()['If-Match']).toBe('"abc123"')
  })

  it('strips a weak validator prefix', async () => {
    await makeClient().deleteContact(BOOK, CONTACT_URL, 'W/"abc123"')

    expect(headersOf()['If-Match']).toBe('"abc123"')
  })

  it('omits If-Match entirely when no etag is known', async () => {
    await makeClient().deleteContact(BOOK, CONTACT_URL, undefined)

    expect(headersOf()).not.toHaveProperty('If-Match')
  })
})
