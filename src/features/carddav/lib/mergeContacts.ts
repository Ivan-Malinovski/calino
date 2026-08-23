import type { Contact, ContactAddress } from '../types'

export type DuplicateReason =
  | { kind: 'sameEmail'; value: string }
  | { kind: 'samePhone'; value: string }
  | { kind: 'sameNameAndOrg'; value: string }
  | { kind: 'sameContact' }

export interface DuplicateGroup {
  contacts: Contact[]
  reason: DuplicateReason
  confidence: 'high' | 'medium' | 'low'
}

// ---------------------------------------------------------------------------
// Union-Find for grouping duplicates
// ---------------------------------------------------------------------------

class UnionFind {
  parent: Map<string, string> = new Map()
  rank: Map<string, number> = new Map()

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.rank.set(x, 0)
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!))
    }
    return this.parent.get(x)!
  }

  union(x: string, y: string): void {
    const px = this.find(x)
    const py = this.find(y)
    if (px === py) return

    const rx = this.rank.get(px)!
    const ry = this.rank.get(py)!
    if (rx < ry) {
      this.parent.set(px, py)
    } else if (rx > ry) {
      this.parent.set(py, px)
    } else {
      this.parent.set(py, px)
      this.rank.set(px, rx + 1)
    }
  }

  groups(): Map<string, string[]> {
    const result = new Map<string, string[]>()
    for (const x of this.parent.keys()) {
      const root = this.find(x)
      const arr = result.get(root) ?? []
      arr.push(x)
      result.set(root, arr)
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export function findDuplicateGroups(contacts: Contact[]): DuplicateGroup[] {
  const uf = new UnionFind()
  const reasons = new Map<string, DuplicateReason>() // rootId -> reason

  // Phase 1: High confidence — same email or phone
  const emailIndex = new Map<string, string[]>()
  const phoneIndex = new Map<string, string[]>()

  for (const c of contacts) {
    for (const e of c.emails) {
      const key = normalizeEmail(e.value)
      if (!key) continue
      const arr = emailIndex.get(key) ?? []
      arr.push(c.id)
      emailIndex.set(key, arr)
    }
    for (const p of c.phones) {
      const key = normalizePhone(p.value)
      if (key.length < 5) continue
      const arr = phoneIndex.get(key) ?? []
      arr.push(c.id)
      phoneIndex.set(key, arr)
    }
  }

  for (const [email, ids] of emailIndex) {
    if (ids.length < 2) continue
    for (let i = 1; i < ids.length; i++) {
      uf.union(ids[0]!, ids[i]!)
    }
    const root = uf.find(ids[0]!)
    if (!reasons.has(root)) {
      reasons.set(root, { kind: 'sameEmail', value: email })
    }
  }

  for (const [phone, ids] of phoneIndex) {
    if (ids.length < 2) continue
    for (let i = 1; i < ids.length; i++) {
      uf.union(ids[0]!, ids[i]!)
    }
    const root = uf.find(ids[0]!)
    if (!reasons.has(root)) {
      reasons.set(root, { kind: 'samePhone', value: phone })
    }
  }

  // Phase 2: Medium confidence — same name + org (only for contacts not yet grouped)
  const contactMap = new Map(contacts.map((c) => [c.id, c]))
  const nameOrgIndex = new Map<string, string[]>()

  for (const c of contacts) {
    const nameKey = c.displayName.toLowerCase().trim()
    if (!nameKey) continue
    const orgKey = c.organization?.toLowerCase().trim() ?? ''
    if (!orgKey) continue
    const key = `${nameKey}|${orgKey}`
    const arr = nameOrgIndex.get(key) ?? []
    arr.push(c.id)
    nameOrgIndex.set(key, arr)
  }

  for (const [key, ids] of nameOrgIndex) {
    if (ids.length < 2) continue
    // Only group if not already in same group
    for (let i = 1; i < ids.length; i++) {
      if (uf.find(ids[0]!) !== uf.find(ids[i]!)) {
        uf.union(ids[0]!, ids[i]!)
        const root = uf.find(ids[0]!)
        const [name] = key.split('|')
        if (!reasons.has(root)) {
          reasons.set(root, { kind: 'sameNameAndOrg', value: name! })
        }
      }
    }
  }

  // Build result
  const groups: DuplicateGroup[] = []
  const ufGroups = uf.groups()

  for (const [, ids] of ufGroups) {
    if (ids.length < 2) continue
    const root = ids[0]!
    const groupContacts = ids.map((id) => contactMap.get(id)!).filter(Boolean)
    if (groupContacts.length < 2) continue

    // Determine confidence
    const reason: DuplicateReason = reasons.get(root) ?? { kind: 'sameContact' }
    let confidence: DuplicateGroup['confidence'] = 'low'
    if (reason.kind === 'sameEmail' || reason.kind === 'samePhone') {
      confidence = 'high'
    } else if (reason.kind === 'sameNameAndOrg') {
      confidence = 'medium'
    }

    groups.push({
      contacts: groupContacts,
      reason,
      confidence,
    })
  }

  // Sort: high first, then by group size descending
  groups.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 }
    const diff = confOrder[a.confidence] - confOrder[b.confidence]
    if (diff !== 0) return diff
    return b.contacts.length - a.contacts.length
  })

  return groups
}

// ---------------------------------------------------------------------------
// Merge two contacts
// ---------------------------------------------------------------------------

function unionByValue<T extends { value: string }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set(primary.map((item) => item.value.toLowerCase()))
  const result = [...primary]
  for (const item of secondary) {
    if (!seen.has(item.value.toLowerCase())) {
      result.push(item)
      seen.add(item.value.toLowerCase())
    }
  }
  return result
}

function preferPrimary(primary: string, secondary: string): string {
  return primary || secondary
}

function addressKey(addr: {
  street: string
  city: string
  postalCode: string
  country: string
}): string {
  return [addr.street, addr.city, addr.postalCode, addr.country].join('|').toLowerCase()
}

function unionByAddr(primary: ContactAddress[], secondary: ContactAddress[]): ContactAddress[] {
  const seen = new Set(primary.map(addressKey))
  const result = [...primary]
  for (const item of secondary) {
    const key = addressKey(item)
    if (key !== '|||' && !seen.has(key)) {
      result.push(item)
      seen.add(key)
    }
  }
  return result
}

export function mergeContacts(primary: Contact, secondary: Contact): Contact {
  return {
    // Keep primary's identity
    id: primary.id,
    addressBookId: primary.addressBookId,
    accountId: primary.accountId,
    url: primary.url,
    createdAt: primary.createdAt,
    lastModified: new Date().toISOString(),
    syncStatus: 'pending',

    // Union arrays by value
    emails: unionByValue(primary.emails, secondary.emails),
    phones: unionByValue(primary.phones, secondary.phones),
    addresses: unionByAddr(primary.addresses, secondary.addresses),
    urls: unionByValue(primary.urls, secondary.urls),
    ims: unionByValue(primary.ims, secondary.ims),
    langs: unionByValue(primary.langs, secondary.langs),
    related: unionByValue(primary.related, secondary.related),
    categories: [...new Set([...primary.categories, ...secondary.categories])],

    // Scalar fields: prefer primary, fall back to secondary
    displayName: preferPrimary(primary.displayName, secondary.displayName),
    givenName: preferPrimary(primary.givenName, secondary.givenName),
    familyName: preferPrimary(primary.familyName, secondary.familyName),
    additionalNames: preferPrimary(primary.additionalNames, secondary.additionalNames),
    prefixes: preferPrimary(primary.prefixes, secondary.prefixes),
    suffixes: preferPrimary(primary.suffixes, secondary.suffixes),
    nickname: preferPrimary(primary.nickname, secondary.nickname),
    organization: preferPrimary(primary.organization, secondary.organization),
    department: preferPrimary(primary.department, secondary.department),
    title: preferPrimary(primary.title, secondary.title),
    role: preferPrimary(primary.role, secondary.role),
    note: preferPrimary(primary.note, secondary.note),
    gender: preferPrimary(primary.gender, secondary.gender),
    birthday: primary.birthday ?? secondary.birthday,
    anniversary: primary.anniversary ?? secondary.anniversary,
    photo: primary.photo ?? secondary.photo,
    xmlData: primary.xmlData ?? secondary.xmlData,

    // Group fields
    isGroup: primary.isGroup || secondary.isGroup,
    memberUids: [...new Set([...primary.memberUids, ...secondary.memberUids])],

    // Keep primary's opaque lines (server data)
    opaqueLines: primary.opaqueLines,
  }
}
