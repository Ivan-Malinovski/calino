import { createDAVClient } from 'tsdav'
import type { CalDAVCredentials } from '@/features/caldav/types'
import type { AddressBook, Contact } from '../types'
import { parseVCard, contactToVCard } from '../adapter/vCardAdapter'
import { buildProxyUrl } from '@/features/caldav/client/CalDAVClient'
import { webFetch } from '@/lib/webFetch'
import {
  CardDAVConflictError,
  CardDAVPermissionError,
  CardDAVSizeLimitError,
  CardDAVVersionError,
} from './errors'

const NETWORK_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// sync-collection types
// ---------------------------------------------------------------------------

interface SyncCollectionChange {
  url: string
  etag: string | null
  status: 'added' | 'changed' | 'removed'
}

interface SyncCollectionResult {
  changes: SyncCollectionChange[]
  newSyncToken: string | null
  tokenInvalidated: boolean
}

// ---------------------------------------------------------------------------
// XML parsing helpers for DAV REPORT responses
// ---------------------------------------------------------------------------

interface ParsedDAVResponse {
  href: string
  status: number
  etag?: string
  addressData?: string
  error?: string
}

/**
 * Strip the transport syntax off an entity tag so we store the bare value.
 *
 * Servers hand out etags quoted (`"abc"`, or `W/"abc"` for weak validators). Storing them
 * as-is and then emitting `If-Match: "${etag}"` produces a doubled-up `""abc""`, which no
 * server matches — every conditional delete and update comes back 412. Normalize on the way
 * in and add exactly one pair of quotes on the way out.
 *
 * The callers here scrape etags out of raw multistatus XML, and sabre-based servers (Baikal,
 * Nextcloud) escape the quotes they contain: `<D:getetag>&quot;abc&quot;</D:getetag>`. Decode
 * first or the quote-stripping below matches nothing and the entity text is sent verbatim as
 * an If-Match that can never match — the CardDAV twin of issue #110.
 */
function normalizeEtag(raw: string | null | undefined): string {
  if (!raw) return ''
  return decodeXmlEntities(raw).trim().replace(/^W\//i, '').replace(/^"|"$/g, '')
}

/** The five predefined XML entities. Numeric character references are not used for etags. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Parse a DAV:multistatus XML response into individual D:response blocks.
 * Each D:response contains a D:href and either a D:propstat with properties
 * or a D:status.
 */
function parseMultistatus(xml: string): ParsedDAVResponse[] {
  const responses: ParsedDAVResponse[] = []

  // Match each <D:response>...</D:response> block
  const responseRegex = /<D:response\b[^>]*>([\s\S]*?)<\/D:response>/gi
  let match

  while ((match = responseRegex.exec(xml)) !== null) {
    const responseXml = match[0]

    // Extract D:href
    const hrefMatch = /<D:href\b[^>]*>([^<]*)<\/D:href>/i.exec(responseXml)
    if (!hrefMatch) continue
    const href = decodeURIComponent(hrefMatch[1])

    // Extract status or propstat
    const statusMatch = /<D:status\b[^>]*>HTTP\/\d\.\d\s+(\d+)/i.exec(responseXml)
    const propstatMatch = /<D:propstat>([\s\S]*?)<\/D:propstat>/i.exec(responseXml)

    if (statusMatch) {
      // Removed (404) or other status
      const status = parseInt(statusMatch[1], 10)
      responses.push({ href, status })
    } else if (propstatMatch) {
      const propstatXml = propstatMatch[1]

      // Check for error in propstat (e.g., 404 Not Found)
      const propStatusMatch = /<D:prop\b[^>]*>([\s\S]*?)<\/D:prop>/i.exec(propstatXml)
      if (propStatusMatch) {
        const propXml = propStatusMatch[1]

        // Check for 404 status inside propstat
        const innerStatusMatch = /<D:status\b[^>]*>HTTP\/\d\.\d\s+(\d+)/i.exec(propstatXml)

        if (innerStatusMatch) {
          const innerStatus = parseInt(innerStatusMatch[1], 10)
          responses.push({ href, status: innerStatus })
        } else {
          // Success case - extract etag and address-data
          const etagMatch = /<D:getetag\b[^>]*>([^<]*)<\/D:getetag>/i.exec(propXml)
          const addressDataMatch = /<C:address-data\b[^>]*>([\s\S]*?)<\/C:address-data>/i.exec(
            propXml
          )

          responses.push({
            href,
            status: 200,
            etag: etagMatch ? normalizeEtag(etagMatch[1]) : undefined,
            addressData: addressDataMatch ? addressDataMatch[1].trim() : undefined,
          })
        }
      }
    }
  }

  return responses
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Extract D:sync-token from response body (some servers put it there).
 */
function extractSyncTokenFromBody(xml: string): string | null {
  const match = /<D:sync-token\b[^>]*>([^<]*)<\/D:sync-token>/i.exec(xml)
  return match ? match[1] : null
}

// Takes the full `fetch` input type, not just `string | URL`: tsdav types its
// `fetch` option as `typeof fetch`, so a narrower parameter is not assignable.
async function fetchWithTimeout(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  try {
    return await webFetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function createProxyFetch(proxyUrl: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string
    if (typeof input === 'string') {
      url = input
    } else if (input instanceof Request) {
      url = input.url
    } else {
      url = input.toString()
    }
    const proxiedUrl = prefixUrlWithProxy(url, proxyUrl)
    return fetchWithTimeout(proxiedUrl, init)
  }
}

function prefixUrlWithProxy(url: string, proxyBase: string): string {
  if (!proxyBase) {
    return url
  }

  // Already pointing at the proxy — prefixing again yields
  // `proxy/https%3A%2F%2Fproxy/https%3A%2F%2Fdav…`, which resolves to nothing.
  // Same guard as CalDAVClient, for the same reason: stored hrefs from older
  // versions can already carry the proxy prefix.
  if (url.replace(/\/$/, '').startsWith(proxyBase.replace(/\/$/, '') + '/')) {
    return url
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return buildProxyUrl(proxyBase, url)
  }

  if (url.startsWith('/')) {
    return buildProxyUrl(proxyBase, url)
  }

  return buildProxyUrl(proxyBase, url)
}

export class CardDAVClient {
  private client: Awaited<ReturnType<typeof createDAVClient>> | null = null
  private serverUrl: string
  private proxyUrl: string | null
  private credentials: CalDAVCredentials
  private proxyFetch: (url: string | URL, init?: RequestInit) => Promise<Response>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cachedDavAddressBooks: any[] | null = null
  private cachedCollectionProps: Map<
    string,
    { supportedVersions?: ('3.0' | '4.0')[]; maxResourceSize?: number | null; canWrite?: boolean }
  > = new Map()

  constructor(serverUrl: string, credentials: CalDAVCredentials, proxyUrl: string | null = null) {
    this.serverUrl = serverUrl
    this.proxyUrl = proxyUrl
    this.credentials = credentials
    this.proxyFetch = proxyUrl ? createProxyFetch(proxyUrl) : fetchWithTimeout
  }

  async connect(): Promise<void> {
    this.client = await createDAVClient({
      serverUrl: this.serverUrl,
      credentials: {
        username: this.credentials.username,
        password: this.credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'carddav',
      fetch: this.proxyUrl ? createProxyFetch(this.proxyUrl) : fetchWithTimeout,
    })
  }

  /**
   * Get the Authorization header value.
   */
  private get authHeader(): string {
    return `Basic ${btoa(`${this.credentials.username}:${this.credentials.password}`)}`
  }

  private getClient() {
    if (!this.client) {
      throw new Error('Client not connected. Call connect() first.')
    }
    return this.client
  }

  /**
   * Get raw DAV address books, cached after first fetch.
   */
  private async getDavAddressBooks() {
    if (this.cachedDavAddressBooks) {
      return this.cachedDavAddressBooks
    }
    const client = this.getClient()
    this.cachedDavAddressBooks = await client.fetchAddressBooks()
    return this.cachedDavAddressBooks
  }

  private findDavAddressBook(url: string) {
    return this.cachedDavAddressBooks?.find((ab) => ab.url === url) ?? null
  }

  /**
   * Fetch all address books from the server.
   * Lazily runs discovery on first call to determine the addressbook-home-set.
   */
  async fetchAddressBooks(): Promise<AddressBook[]> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const davAddressBooks = await this.getDavAddressBooks()

    const results: AddressBook[] = []
    for (const ab of davAddressBooks) {
      // Fetch additional collection metadata (supported-address-data, max-resource-size, privileges)
      const collectionProps = await this.fetchCollectionProps(ab.url)

      // Cache on client instance for write operations
      this.cachedCollectionProps.set(ab.url, collectionProps)

      results.push({
        id: ab.url || crypto.randomUUID(),
        accountId: '', // Will be set by caller
        url: ab.url || '',
        name: typeof ab.displayName === 'string' ? ab.displayName : 'Unnamed Address Book',
        description: undefined,
        ctag: ab.ctag || null,
        syncToken: ab.syncToken || null,
        isVisible: true,
        supportedVersions: collectionProps.supportedVersions,
        maxResourceSize: collectionProps.maxResourceSize,
        canWrite: collectionProps.canWrite,
      })
    }

    return results
  }

  /**
   * Fetch all contacts from an address book.
   */
  async fetchContacts(addressBook: AddressBook): Promise<Contact[]> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const client = this.getClient()
    const davAb = this.findDavAddressBook(addressBook.url)

    if (!davAb) {
      throw new Error(`Address book not found: ${addressBook.url}`)
    }

    const vcards = await client.fetchVCards({
      addressBook: davAb,
    })

    const contacts: Contact[] = []

    for (const vcard of vcards) {
      if (vcard.data) {
        const contact = parseVCard(vcard.data as string, addressBook.id, addressBook.accountId)
        if (contact) {
          contact.etag = normalizeEtag(vcard.etag) || undefined
          // The resource href — without it we cannot update or delete this contact later
          contact.url = this.absoluteHref(vcard.url)
          contacts.push(contact)
        }
      }
    }

    return contacts
  }

  /**
   * Fetch a single contact by URL.
   */
  async fetchContact(addressBook: AddressBook, contactUrl: string): Promise<Contact | null> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const client = this.getClient()
    const davAb = this.findDavAddressBook(addressBook.url)

    if (!davAb) {
      throw new Error(`Address book not found: ${addressBook.url}`)
    }

    const vcards = await client.fetchVCards({
      addressBook: davAb,
      objectUrls: [contactUrl],
    })

    const vcard = vcards[0]
    if (!vcard?.data) {
      return null
    }

    const contact = parseVCard(vcard.data as string, addressBook.id, addressBook.accountId)
    if (contact) {
      contact.url = contactUrl
      contact.etag = normalizeEtag(vcard.etag) || undefined
    }
    return contact
  }

  /**
   * Create a new contact in an address book.
   */
  async createContact(
    addressBook: AddressBook,
    contact: Contact,
    filename: string
  ): Promise<{ url: string; etag: string }> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const auth = btoa(`${this.credentials.username}:${this.credentials.password}`)
    const targetUrl = `${addressBook.url.replace(/\/$/, '')}/${filename}`

    // Determine supported vCard version from cache, default to 3.0
    const props = this.cachedCollectionProps.get(addressBook.url)
    const supportedVersions = props?.supportedVersions
    const maxResourceSize = props?.maxResourceSize

    // Try each supported version once
    const versionsToTry: ('3.0' | '4.0')[] =
      supportedVersions && supportedVersions.length > 0 ? supportedVersions : ['3.0', '4.0']

    for (const targetVersion of versionsToTry) {
      const vCardString = contactToVCard(contact, targetVersion)
      const vCardBytes = new TextEncoder().encode(vCardString).length

      // Check max resource size before sending
      if (maxResourceSize != null && vCardBytes > maxResourceSize) {
        throw new CardDAVSizeLimitError(maxResourceSize, vCardBytes)
      }

      const headers: Record<string, string> = {
        'Content-Type': 'text/vcard; charset=utf-8',
        Authorization: `Basic ${auth}`,
        'If-None-Match': '*',
      }

      try {
        const response = await this.proxyFetch(targetUrl, {
          method: 'PUT',
          headers,
          body: vCardString,
        })

        if (response.status === 412 || response.status === 409) {
          // 412: something already lives at this href.
          // 409 <no-uid-conflict>: a card with this UID exists under a *different* href
          // (Radicale enforces UID uniqueness per collection).
          throw new CardDAVConflictError('', undefined)
        }

        if (response.status === 415) {
          // Unsupported media type - try other version on next iteration
          continue
        }

        if (response.status === 507) {
          throw new CardDAVSizeLimitError(maxResourceSize ?? 0, vCardBytes)
        }

        if (response.status === 403) {
          throw new CardDAVPermissionError()
        }

        if (!response.ok && response.status !== 201 && response.status !== 204) {
          throw new Error(
            `Failed to create contact: ${await CardDAVClient.describeFailure(response)}`
          )
        }

        // Extract URL from Location header or use target URL
        const responseUrl = response.headers.get('Location') || targetUrl
        const etag = await this.resolveWrittenEtag(response, responseUrl)

        return { url: responseUrl, etag }
      } catch (err) {
        if (
          err instanceof CardDAVConflictError ||
          err instanceof CardDAVSizeLimitError ||
          err instanceof CardDAVPermissionError
        ) {
          throw err
        }
        // For 415 on the last version, rethrow
        if (err instanceof Error && err.message.includes('415')) {
          throw new CardDAVVersionError(supportedVersions ?? versionsToTry)
        }
        throw err
      }
    }

    // Exhausted all versions without success
    throw new CardDAVVersionError(supportedVersions ?? versionsToTry)
  }

  /**
   * Update an existing contact.
   */
  async updateContact(
    addressBook: AddressBook,
    contact: Contact,
    contactUrl: string,
    etag: string | undefined
  ): Promise<{ url: string; etag: string }> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const auth = btoa(`${this.credentials.username}:${this.credentials.password}`)

    // Determine supported vCard version from cache, default to 3.0
    const props = this.cachedCollectionProps.get(addressBook.url)
    const supportedVersions = props?.supportedVersions
    const maxResourceSize = props?.maxResourceSize

    // Try each supported version once
    const versionsToTry: ('3.0' | '4.0')[] =
      supportedVersions && supportedVersions.length > 0 ? supportedVersions : ['3.0', '4.0']

    for (const targetVersion of versionsToTry) {
      const vCardString = contactToVCard(contact, targetVersion)
      const vCardBytes = new TextEncoder().encode(vCardString).length

      // Check max resource size before sending
      if (maxResourceSize != null && vCardBytes > maxResourceSize) {
        throw new CardDAVSizeLimitError(maxResourceSize, vCardBytes)
      }

      const headers: Record<string, string> = {
        'Content-Type': 'text/vcard; charset=utf-8',
        Authorization: `Basic ${auth}`,
      }
      // Only make the write conditional when we actually know the current etag. An
      // unconditional overwrite beats silently dropping the user's edit.
      if (etag) {
        headers['If-Match'] = `"${normalizeEtag(etag)}"`
      }

      try {
        const response = await this.proxyFetch(contactUrl, {
          method: 'PUT',
          headers,
          body: vCardString,
        })

        if (response.status === 412) {
          // Conflict - refetch from server to get current state
          const serverContact = await this.fetchContact(addressBook, contactUrl)
          throw new CardDAVConflictError(serverContact?.etag ?? '', serverContact?.rawVCard)
        }

        if (response.status === 415) {
          // Unsupported media type - try other version on next iteration
          continue
        }

        if (response.status === 507) {
          throw new CardDAVSizeLimitError(maxResourceSize ?? 0, vCardBytes)
        }

        if (response.status === 403) {
          throw new CardDAVPermissionError()
        }

        if (!response.ok && response.status !== 200 && response.status !== 204) {
          throw new Error(
            `Failed to update contact: ${await CardDAVClient.describeFailure(response)}`
          )
        }

        // Extract URL from Location header or use contact URL
        const responseUrl = response.headers.get('Location') || contactUrl
        const newEtag = (await this.resolveWrittenEtag(response, responseUrl)) || etag || ''

        return { url: responseUrl, etag: newEtag }
      } catch (err) {
        if (
          err instanceof CardDAVConflictError ||
          err instanceof CardDAVSizeLimitError ||
          err instanceof CardDAVPermissionError
        ) {
          throw err
        }
        // For 415 on the last version, rethrow
        if (err instanceof Error && err.message.includes('415')) {
          throw new CardDAVVersionError(supportedVersions ?? versionsToTry)
        }
        throw err
      }
    }

    // Exhausted all versions without success
    throw new CardDAVVersionError(supportedVersions ?? versionsToTry)
  }

  /**
   * Delete a contact.
   */
  async deleteContact(
    addressBook: AddressBook,
    contactUrl: string,
    etag: string | undefined
  ): Promise<void> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const auth = btoa(`${this.credentials.username}:${this.credentials.password}`)

    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
    }
    // Guard against a lost update only when we know the etag. When we don't — e.g. the
    // server never exposed one through CORS — delete unconditionally rather than skipping
    // the request, which used to leave the contact alive on the server forever.
    if (etag) {
      headers['If-Match'] = `"${normalizeEtag(etag)}"`
    }

    const response = await this.proxyFetch(contactUrl, {
      method: 'DELETE',
      headers,
    })

    if (response.status === 412) {
      // Conflict - contact was modified, try to refetch
      try {
        const serverContact = await this.fetchContact(addressBook, contactUrl)
        if (serverContact) {
          // Contact still exists, throw conflict
          throw new CardDAVConflictError(serverContact.etag ?? '', serverContact.rawVCard)
        }
        // Contact no longer exists (404), consider deletion successful
        return
      } catch (err) {
        if (err instanceof CardDAVConflictError) throw err
        // Network error during refetch, rethrow
        throw err
      }
    }

    if (response.status === 403) {
      throw new CardDAVPermissionError()
    }

    // 404 means already deleted, which is fine
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete contact: ${await CardDAVClient.describeFailure(response)}`)
    }
  }

  /**
   * Fetch collection metadata for an address book URL:
   * supported-address-data, max-resource-size, current-user-privilege-set.
   */
  private async fetchCollectionProps(addressBookUrl: string): Promise<{
    supportedVersions: ('3.0' | '4.0')[] | undefined
    maxResourceSize: number | null | undefined
    canWrite: boolean | undefined
  }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
      Depth: '0',
    }

    const propfindBody = `<?xml version="1.0" encoding="UTF-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <C:supported-address-data/>
    <C:max-resource-size/>
    <D:current-user-privilege-set/>
  </D:prop>
</D:propfind>`

    try {
      const response = await this.proxyFetch(addressBookUrl, {
        method: 'PROPFIND',
        headers,
        body: propfindBody,
      })

      if (!response.ok && response.status !== 207) {
        return { supportedVersions: undefined, maxResourceSize: undefined, canWrite: undefined }
      }

      const text = await response.text()

      // Parse supported-address-data
      const supportedVersions = this.parseSupportedAddressData(text)

      // Parse max-resource-size
      const maxResourceSize = this.parseMaxResourceSize(text)

      // Parse current-user-privilege-set to determine write ability
      const canWrite = this.parseCanWrite(text)

      return { supportedVersions, maxResourceSize, canWrite }
    } catch {
      return { supportedVersions: undefined, maxResourceSize: undefined, canWrite: undefined }
    }
  }

  /**
   * Resolve a DAV href against the server URL. Multistatus responses carry path-only hrefs
   * (`/user/contacts/x.vcf`); issuing a request against one of those would hit the app's own
   * origin instead of the server.
   */
  private absoluteHref(href: string | undefined): string {
    if (!href) return ''
    try {
      return new URL(href, this.serverUrl).toString()
    } catch {
      return href
    }
  }

  /**
   * Read the ETag of a single resource via PROPFIND.
   *
   * Needed because `ETag` is not a CORS-safelisted response header: unless the server sends
   * `Access-Control-Expose-Headers: ETag`, `response.headers.get('etag')` is null in the
   * browser even though the server did send it. Without a fallback we would store an empty
   * etag and later conditional requests would be built on nothing.
   */
  private async fetchEtagForHref(url: string): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
      Depth: '0',
    }

    const propfindBody = `<?xml version="1.0" encoding="UTF-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:propfind>`

    try {
      const response = await this.proxyFetch(url, {
        method: 'PROPFIND',
        headers,
        body: propfindBody,
      })

      if (!response.ok && response.status !== 207) return ''

      const text = await response.text()
      const match = text.match(/<(?:[a-z0-9]+:)?getetag[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?getetag>/i)
      return match ? normalizeEtag(match[1]) : ''
    } catch {
      return ''
    }
  }

  /**
   * Resolve the etag for a resource we just wrote: prefer the response header, fall back to
   * a PROPFIND when CORS hides it.
   */
  private async resolveWrittenEtag(response: Response, url: string): Promise<string> {
    const headerEtag = normalizeEtag(response.headers.get('etag'))
    if (headerEtag) return headerEtag
    return this.fetchEtagForHref(url)
  }

  /**
   * Read a failed response's body for diagnostics. Servers explain 4xx here (Radicale
   * answers "Bad Request" for a vCard it cannot parse) and without it a failure is just a
   * bare status code.
   */
  private static async describeFailure(response: Response): Promise<string> {
    let body = ''
    try {
      body = (await response.text()).trim().slice(0, 200)
    } catch {
      // body already consumed or unreadable — status alone will have to do
    }
    const status = `${response.status} ${response.statusText}`.trim()
    return body ? `${status} — ${body}` : status
  }

  private parseSupportedAddressData(text: string): ('3.0' | '4.0')[] | undefined {
    const versions: ('3.0' | '4.0')[] = []
    // Match <C:address-data-type content-type="text/vcard" version="3.0"/>
    const matches = text.matchAll(
      /<C:address-data-type[^>]*content-type="text\/vcard"[^>]*version="([\d.]+)"[^>]*\/>/gi
    )
    for (const match of matches) {
      const version = match[1]
      if (version === '3.0' || version === '4.0') {
        versions.push(version as '3.0' | '4.0')
      }
    }
    // Also try variant ordering
    if (versions.length === 0) {
      const altMatches = text.matchAll(
        /<C:supported-address-data[\s\S]*?<\/C:supported-address-data>/gi
      )
      for (const block of altMatches) {
        const inner = block[0]
        const ver3 = inner.match(/version="3\.0"/i)
        const ver4 = inner.match(/version="4\.0"/i)
        if (ver3) versions.push('3.0')
        if (ver4) versions.push('4.0')
      }
    }
    return versions.length > 0 ? versions : undefined
  }

  private parseMaxResourceSize(text: string): number | null | undefined {
    const match = text.match(/<C:max-resource-size>(\d+)<\/C:max-resource-size>/i)
    return match ? parseInt(match[1], 10) : undefined
  }

  private parseCanWrite(text: string): boolean | undefined {
    // Check for D:write privilege in current-user-privilege-set
    const writePrivMatches = text.matchAll(
      /<D:privilege>[\s\S]*?<D:write\/>[\s\S]*?<\/D:privilege>/gi
    )
    for (const _match of writePrivMatches) {
      return true
    }
    // Also try alternative pattern
    const altMatch = text.match(/<D:privilege>[\s\S]*?<D:write\/><\/D:privilege>/i)
    if (altMatch) return true
    return undefined
  }

  /**
   * Discover the CardDAV principal URL and address book home set.
   * Follows RFC 6764: .well-known/carddav → current-user-principal → addressbook-home-set
   */
  async discover(): Promise<{
    principalUrl: string
    addressbookHomeSet: string
  }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
    }

    // Step 1: well-known carddav
    const wellKnownUrl = `${this.serverUrl.replace(/\/$/, '')}/.well-known/carddav`
    let currentUrl = wellKnownUrl

    try {
      const redirectResponse = await this.proxyFetch(currentUrl, {
        method: 'PROPFIND',
        headers: { ...headers, Depth: '0' },
        body: this.getWellKnownPropfindBody(),
      })

      // Follow redirect if present
      if (redirectResponse.status === 301 || redirectResponse.status === 302) {
        const location = redirectResponse.headers.get('Location')
        if (location) currentUrl = location
      }

      // Step 2: current-user-principal
      const principalResponse = await this.proxyFetch(currentUrl, {
        method: 'PROPFIND',
        headers: { ...headers, Depth: '0' },
        body: this.getPrincipalPropfindBody(),
      })

      if (!principalResponse.ok && principalResponse.status !== 207) {
        throw new Error(`Principal discovery failed: ${principalResponse.status}`)
      }

      const principalText = await principalResponse.text()
      const principalUrl = this.extractHrefFromMultistatus(principalText)
      if (!principalUrl) throw new Error('Could not find current-user-principal')

      // Step 3: addressbook-home-set
      const homeSetResponse = await this.proxyFetch(principalUrl, {
        method: 'PROPFIND',
        headers: { ...headers, Depth: '0' },
        body: this.getAddressbookHomeSetBody(),
      })

      if (!homeSetResponse.ok && homeSetResponse.status !== 207) {
        throw new Error(`Addressbook home-set discovery failed: ${homeSetResponse.status}`)
      }

      const homeSetText = await homeSetResponse.text()
      const addressbookHomeSet = this.extractHrefFromMultistatus(homeSetText)
      if (!addressbookHomeSet) throw new Error('Could not find addressbook-home-set')

      return { principalUrl, addressbookHomeSet }
    } catch {
      // Discovery failed — fall back to using serverUrl as home set
      // This preserves backwards compatibility with direct URL entry
      return {
        principalUrl: this.serverUrl,
        addressbookHomeSet: this.serverUrl,
      }
    }
  }

  private getWellKnownPropfindBody(): string {
    return `<?xml version="1.0" encoding="UTF-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal/>
  </D:prop>
</D:propfind>`
  }

  private getPrincipalPropfindBody(): string {
    return `<?xml version="1.0" encoding="UTF-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal/>
  </D:prop>
</D:propfind>`
  }

  private getAddressbookHomeSetBody(): string {
    return `<?xml version="1.0" encoding="UTF-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <C:addressbook-home-set/>
  </D:prop>
</D:propfind>`
  }

  private extractHrefFromMultistatus(text: string): string | null {
    const match = text.match(/<D:href>([^<]+)<\/D:href>/)
    return match ? match[1] : null
  }

  /** Clear cached DAV address books (e.g. after a server-side change). */
  clearCache(): void {
    this.cachedDavAddressBooks = null
    this.cachedCollectionProps.clear()
  }

  // ---------------------------------------------------------------------------
  // sync-collection REPORT (RFC 6578)
  // ---------------------------------------------------------------------------

  /**
   * Perform an incremental sync using sync-collection REPORT (RFC 6578).
   * Falls back gracefully on token invalidation.
   */
  async syncCollection(
    addressBook: AddressBook,
    syncToken: string | null
  ): Promise<SyncCollectionResult> {
    const url = addressBook.url

    // If no token, do a full sync (token will be captured from response)
    const body = `<?xml version="1.0" encoding="UTF-8" ?>
<D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  ${syncToken ? `<D:sync-token>${escapeXml(syncToken)}</D:sync-token>` : ''}
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: `Basic ${btoa(`${this.credentials.username}:${this.credentials.password}`)}`,
    }

    try {
      const response = await this.proxyFetch(url, {
        method: 'REPORT',
        headers,
        body,
      })

      // Token invalidated — fall back to full sync
      if (response.status === 400 || response.status === 507) {
        return { changes: [], newSyncToken: null, tokenInvalidated: true }
      }

      if (!response.ok && response.status !== 207) {
        return { changes: [], newSyncToken: null, tokenInvalidated: true }
      }

      const text = await response.text()

      // Try to get token from headers first, then body
      const newSyncToken =
        response.headers.get('X-SYNC-TOKEN') ||
        response.headers.get('DAV:sync-token') ||
        extractSyncTokenFromBody(text) ||
        null

      const changes = this.parseSyncCollectionResponse(text)
      return { changes, newSyncToken, tokenInvalidated: false }
    } catch {
      return { changes: [], newSyncToken: null, tokenInvalidated: true }
    }
  }

  /**
   * Parse sync-collection REPORT response into individual changes.
   * Each D:response is either:
   * - added/changed: has D:getetag (status 200 or no explicit status)
   * - removed: has D:status of 404 Not Found
   */
  private parseSyncCollectionResponse(xml: string): SyncCollectionChange[] {
    const responses = parseMultistatus(xml)
    const changes: SyncCollectionChange[] = []

    for (const response of responses) {
      if (
        response.status === 404 ||
        response.href.includes('/404') ||
        response.href.includes('%2F404')
      ) {
        // Contact was removed
        changes.push({
          url: response.href,
          etag: null,
          status: 'removed',
        })
      } else if (response.etag) {
        // Added or changed - we treat all with etag as added/changed
        // The URL tells us if it's new or existing
        changes.push({
          url: response.href,
          etag: response.etag,
          status: 'added', // Will be determined by caller based on existing contacts
        })
      }
    }

    return changes
  }

  // ---------------------------------------------------------------------------
  // addressbook-multiget REPORT
  // ---------------------------------------------------------------------------

  /**
   * Fetch specific contacts by URL using addressbook-multiget REPORT.
   * More efficient than individual GETs for batch fetches.
   */
  async fetchContactsByUrls(addressBook: AddressBook, urls: string[]): Promise<Contact[]> {
    if (urls.length === 0) return []

    const davAb = this.findDavAddressBook(addressBook.url)
    if (!davAb) throw new Error(`Address book not found: ${addressBook.url}`)

    const hrefs = urls.map((u) => `<D:href>${escapeXml(u)}</D:href>`).join('\n    ')

    const body = `<?xml version="1.0" encoding="UTF-8" ?>
<C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  ${hrefs}
</C:addressbook-multiget>`

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: `Basic ${btoa(`${this.credentials.username}:${this.credentials.password}`)}`,
    }

    const response = await this.proxyFetch(addressBook.url, {
      method: 'REPORT',
      headers,
      body,
    })

    if (!response.ok && response.status !== 207) {
      throw new Error(`addressbook-multiget failed: ${response.status}`)
    }

    const text = await response.text()
    return this.parseMultigetResponse(text, addressBook.id, addressBook.accountId)
  }

  /**
   * Parse addressbook-multiget REPORT response into Contact objects.
   */
  private parseMultigetResponse(xml: string, addressBookId: string, accountId: string): Contact[] {
    const responses = parseMultistatus(xml)
    const contacts: Contact[] = []

    for (const response of responses) {
      if (response.status === 200 && response.addressData) {
        const contact = parseVCard(response.addressData, addressBookId, accountId)
        if (contact) {
          contact.etag = normalizeEtag(response.etag) || undefined
          contact.url = this.absoluteHref(response.href)
          contacts.push(contact)
        }
      }
    }

    return contacts
  }

  /**
   * Check if the server supports CardDAV by trying to fetch address books.
   */
  async checkCardDAVSupport(): Promise<boolean> {
    try {
      await this.fetchAddressBooks()
      return true
    } catch {
      return false
    }
  }

  getServerUrl(): string {
    return this.serverUrl
  }

  getProxyUrl(): string | null {
    return this.proxyUrl
  }
}

export async function createCardDAVClient(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null = null
): Promise<CardDAVClient> {
  const client = new CardDAVClient(serverUrl, credentials, proxyUrl)
  await client.connect()
  return client
}
