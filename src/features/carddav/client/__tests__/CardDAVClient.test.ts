import { describe, it, expect } from 'vitest'
import {
  CardDAVClient,
  parseMultistatus,
  extractSyncTokenFromBody,
} from '../CardDAVClient'
import type { CalDAVCredentials } from '@/features/caldav/types'
import radicaleSyncCollection from './fixtures/radicale-sync-collection.xml?raw'
import radicaleMultiget from './fixtures/radicale-addressbook-multiget.xml?raw'
import radicaleMultiget404 from './fixtures/radicale-multiget-404.xml?raw'
import radicalePropfind from './fixtures/radicale-propfind-addressbook.xml?raw'
import dprefixedMultiget from './fixtures/dprefixed-addressbook-multiget.xml?raw'
import dprefixedSyncCollection from './fixtures/dprefixed-sync-collection.xml?raw'

/**
 * DAV XML namespace-prefix handling.
 *
 * RFC 4918 lets a server bind DAV: to any prefix, including the default namespace
 * (no prefix at all). Radicale binds DAV: to the default namespace, caldav to "C"
 * and carddav to "CR" (see register_namespace() in radicale/xmlutils.py). Parsers
 * that hard-code a prefix therefore miss every element Radicale emits.
 *
 * The radicale-*.xml fixtures are verbatim responses from a real Radicale 3.7.2
 * (the deployed version), captured with the exact request bodies CardDAVClient
 * sends, against synthetic contacts. The dprefixed-*.xml fixtures are hand-written
 * and exist to prove the fix is additive rather than a Radicale-only swap.
 */

const credentials: CalDAVCredentials = {
  id: 'cred-1',
  serverUrl: 'https://dav.example.com',
  username: 'testuser',
  password: 'testpass',
}

describe('parseMultistatus', () => {
  describe('Radicale (DAV: is the default namespace, carddav is CR:)', () => {
    it('parses sync-collection responses that have no namespace prefix at all', () => {
      const responses = parseMultistatus(radicaleSyncCollection)

      expect(responses).toHaveLength(2)
      expect(responses[0].href).toBe('/test/contacts/contact-1.vcf')
      expect(responses[0].status).toBe(200)
      expect(responses[0].etag).toBe(
        '7b6a39d533ebd1c42b0c69a4604e7b97d57370671b4e4e0111d111212f7d1f12',
      )
      expect(responses[1].href).toBe('/test/contacts/contact-2.vcf')
    })

    // Guards the second, independent bug: Radicale emits <CR:address-data>, while
    // the parser looked for <C:address-data>. Fixing only the DAV: prefixes would
    // make contacts sync with addressData silently undefined, which is worse than
    // today's total miss because it looks like it works.
    it('parses addressbook-multiget responses WITH address data', () => {
      const responses = parseMultistatus(radicaleMultiget)

      expect(responses).toHaveLength(2)
      for (const response of responses) {
        expect(response.status).toBe(200)
        expect(response.addressData).toBeDefined()
        expect(response.addressData).toContain('BEGIN:VCARD')
        expect(response.addressData).toContain('END:VCARD')
      }
      expect(responses[0].addressData).toContain('FN:Test Person 1')
      expect(responses[1].addressData).toContain('FN:Test Person 2')
    })

    it('reports a bare 404 response block as a status, not a hit', () => {
      const responses = parseMultistatus(radicaleMultiget404)

      expect(responses).toHaveLength(2)
      const missing = responses.find((r) => r.href.endsWith('does-not-exist.vcf'))
      expect(missing?.status).toBe(404)
      expect(missing?.addressData).toBeUndefined()

      const found = responses.find((r) => r.href.endsWith('contact-1.vcf'))
      expect(found?.status).toBe(200)
      expect(found?.addressData).toContain('BEGIN:VCARD')
    })
  })

  // R3: the fix must be additive. Radicale is not the only server this code faces,
  // and a Radicale-only swap would be the same mistake in the mirror.
  describe('d:-prefixed servers (SabreDAV/Nextcloud shape) keep working', () => {
    it('parses a prefixed addressbook-multiget with address data', () => {
      const responses = parseMultistatus(dprefixedMultiget)

      expect(responses).toHaveLength(2)
      const found = responses.find((r) => r.href.endsWith('contact-1.vcf'))
      expect(found?.status).toBe(200)
      expect(found?.etag).toBe('d41d8cd98f00b204e9800998ecf8427e')
      expect(found?.addressData).toContain('FN:Test Person 1')

      const missing = responses.find((r) => r.href.endsWith('gone.vcf'))
      expect(missing?.status).toBe(404)
    })
  })
})

describe('extractSyncTokenFromBody', () => {
  // Without this, updateSyncToken never fires and every round is a full re-fetch.
  // The token's hash is per-collection-state, so assert its shape, not a literal.
  it('extracts an unprefixed Radicale sync-token', () => {
    expect(extractSyncTokenFromBody(radicaleSyncCollection)).toMatch(
      /^http:\/\/radicale\.org\/ns\/sync\/[0-9a-f]{64}$/,
    )
  })

  it('extracts a d:-prefixed sync-token', () => {
    expect(extractSyncTokenFromBody(dprefixedSyncCollection)).toBe(
      'http://sabredav.org/ns/sync/5001',
    )
  })

  it('returns null when there is no sync-token', () => {
    expect(extractSyncTokenFromBody(radicaleMultiget)).toBeNull()
  })
})

describe('collection property parsing', () => {
  const client = new CardDAVClient('https://dav.example.com', credentials)

  it('reads supported vCard versions from CR:-prefixed carddav elements', () => {
    const versions = client['parseSupportedAddressData'](radicalePropfind)
    expect(versions).toEqual(['3.0'])
  })

  // Radicale writes <privilege><write /></privilege>: unprefixed, and with a space
  // before the self-closing slash. The old regex needed <D:write/> and so missed on
  // both counts, leaving the address book looking read-only.
  it('detects the write privilege from unprefixed, space-padded elements', () => {
    expect(client['parseCanWrite'](radicalePropfind)).toBe(true)
  })

  it('reports no max-resource-size when the server 404s that property', () => {
    // Radicale does not implement max-resource-size; it returns the property in a
    // 404 propstat block. undefined ("unknown"), not null ("no limit"), is correct.
    expect(client['parseMaxResourceSize'](radicalePropfind)).toBeUndefined()
  })
})

describe('syncCollection', () => {
  const addressBook = {
    id: 'ab-1',
    accountId: 'acc-1',
    url: 'https://dav.example.com/test/contacts/',
  } as Parameters<CardDAVClient['syncCollection']>[0]

  function clientReplying(body: string, headers: Record<string, string> = {}) {
    const client = new CardDAVClient('https://dav.example.com', credentials)
    ;(client as unknown as { proxyFetch: typeof fetch }).proxyFetch = async () =>
      new Response(body, { status: 207, headers })
    return client
  }

  // Regression: reading the nonexistent `DAV:sync-token` header threw a TypeError
  // (a colon is not a valid header name), which syncCollection's catch reported as
  // an invalidated token — so no server ever got incremental sync.
  it('returns the token and changes from an unprefixed Radicale response', async () => {
    const result = await clientReplying(radicaleSyncCollection).syncCollection(addressBook, null)

    expect(result.tokenInvalidated).toBe(false)
    expect(result.newSyncToken).toMatch(/^http:\/\/radicale\.org\/ns\/sync\/[0-9a-f]{64}$/)
    expect(result.changes.map((c) => c.url)).toEqual([
      '/test/contacts/contact-1.vcf',
      '/test/contacts/contact-2.vcf',
    ])
  })

  it('returns the token from a d:-prefixed response', async () => {
    const result = await clientReplying(dprefixedSyncCollection).syncCollection(addressBook, null)

    expect(result.tokenInvalidated).toBe(false)
    expect(result.newSyncToken).toBe('http://sabredav.org/ns/sync/5001')
  })
})
