import Fuse, { type IFuseOptions } from 'fuse.js'
import type { Contact } from '../types'

const FUSE_OPTIONS: IFuseOptions<Contact> = {
  keys: [
    { name: 'displayName', weight: 3 },
    { name: 'nickname', weight: 2 },
    { name: 'organization', weight: 1.5 },
    { name: 'department', weight: 1 },
    { name: 'title', weight: 1 },
    { name: 'note', weight: 0.8 },
    { name: 'emails.value', weight: 2 },
    { name: 'phones.value', weight: 2 },
    { name: 'addresses.city', weight: 1 },
    { name: 'addresses.street', weight: 1 },
    { name: 'addresses.country', weight: 0.8 },
    { name: 'categories', weight: 0.5 },
    { name: 'urls.value', weight: 0.5 },
  ],
  threshold: 0.3,
  includeScore: true,
  minMatchCharLength: 2,
  ignoreLocation: true,
}

let fuseInstance: Fuse<Contact> | null = null
let indexedContacts: Contact[] = []

/**
 * Initialize or rebuild the Fuse.js search index with the given contacts.
 */
export function initializeContactSearchIndex(contacts: Contact[]): void {
  indexedContacts = contacts
  fuseInstance = new Fuse(contacts, FUSE_OPTIONS)
}

/**
 * Search contacts using Fuse.js fuzzy matching with optional filters.
 * Special case: if the query is all digits (≥3 chars), also does digit-only
 * matching against phone numbers.
 */
export function searchContacts(
  query: string,
  filters?: { addressBookIds?: string[]; tag?: string }
): Contact[] {
  if (!fuseInstance) {
    console.warn('[ContactSearch] Index not initialized.')
    return []
  }

  let results: Contact[]

  if (!query.trim()) {
    // No query — return all contacts, then apply filters
    results = [...indexedContacts]
  } else {
    // Fuse.js fuzzy search
    const fuseResults = fuseInstance.search(query)
    results = fuseResults.map((r) => r.item)

    // Phone number digit-only matching (if query has ≥3 digits)
    const digitQuery = query.replace(/\D/g, '')
    if (digitQuery.length >= 3) {
      const phoneMatches = indexedContacts.filter((c) =>
        c.phones.some((p) => p.value.replace(/\D/g, '').includes(digitQuery))
      )
      // Merge with Fuse results, dedup by id
      const ids = new Set(results.map((c) => c.id))
      for (const match of phoneMatches) {
        if (!ids.has(match.id)) {
          results.push(match)
          ids.add(match.id)
        }
      }
    }
  }

  // Apply filters
  if (filters?.addressBookIds && filters.addressBookIds.length > 0) {
    const abIds = new Set(filters.addressBookIds)
    results = results.filter((c) => abIds.has(c.addressBookId))
  }

  if (filters?.tag) {
    results = results.filter((c) => c.categories.includes(filters.tag!))
  }

  return results
}
