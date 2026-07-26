export interface AddressBook {
  id: string
  accountId: string
  url: string
  name: string
  description?: string
  ctag: string | null
  syncToken: string | null
  isVisible: boolean
  // Cached from PROPFIND (client-side only, not persisted)
  supportedVersions?: ('3.0' | '4.0')[]
  maxResourceSize?: number | null
  canWrite?: boolean
}

export interface Contact {
  id: string
  addressBookId: string
  accountId: string
  url: string
  etag?: string

  // Structured name (N property)
  familyName: string
  givenName: string
  additionalNames: string
  prefixes: string
  suffixes: string
  nickname: string

  // Display name (FN property)
  displayName: string

  // Organization
  organization: string
  department: string
  title: string
  role: string

  // Contact info
  emails: ContactEmail[]
  phones: ContactPhone[]
  addresses: ContactAddress[]

  // Online presence
  urls: ContactUrl[]
  ims: ContactIM[]

  // Personal info
  birthday: string | null
  anniversary: string | null
  gender: string

  // Notes and categories
  note: string
  categories: string[]

  // Photo
  photo: string | null // data URI or URL

  // Group support
  isGroup: boolean
  memberUids: string[]

  // Extended vCard properties
  langs: ContactLang[]
  related: ContactRelated[]
  xmlData: string | null

  // Opaque vCard lines (round-trip preservation)
  opaqueLines: string[]

  // Raw vCard data (for sync)
  rawVCard?: string

  // Metadata
  createdAt: string
  lastModified: string
  syncStatus?: 'synced' | 'pending' | 'failed'
}

export interface ContactEmail {
  value: string
  type: 'home' | 'work' | 'other' | 'pref'
  isPrimary: boolean
}

export interface ContactPhone {
  value: string
  type: 'home' | 'work' | 'cell' | 'fax' | 'other' | 'pref'
  isPrimary: boolean
}

export interface ContactAddress {
  type: 'home' | 'work' | 'other' | 'pref'
  isPrimary: boolean
  poBox: string
  extended: string
  street: string
  city: string
  region: string
  postalCode: string
  country: string
}

export interface ContactUrl {
  value: string
  type: 'home' | 'work' | 'other' | 'pref'
  isPrimary: boolean
}

export interface ContactLang {
  value: string
  type: 'home' | 'work' | 'other' | 'pref'
  isPrimary: boolean
}

export interface ContactRelated {
  value: string
  type: 'friend' | 'co-worker' | 'family' | 'child' | 'spouse' | 'agent' | 'emergency' | 'other'
  isPrimary: boolean
}

export interface ContactIM {
  value: string
  type: 'home' | 'work' | 'other' | 'pref'
  protocol:
    | 'aim'
    | 'email'
    | 'facebook'
    | 'google'
    | 'irc'
    | 'msn'
    | 'qq'
    | 'skype'
    | 'twitter'
    | 'xmpp'
    | 'other'
  isPrimary: boolean
}

export interface CardDAVSyncState {
  status: 'idle' | 'syncing' | 'error' | 'offline'
  lastSyncAt: string | null
  error: string | null
  pendingChanges: number
}

export interface PendingContactChange {
  id: string
  type: 'create' | 'update' | 'delete'
  contactId: string
  addressBookId: string
  data?: string
  timestamp: string
  retryCount: number
}
