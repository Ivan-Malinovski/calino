import type {
  Contact,
  ContactEmail,
  ContactPhone,
  ContactAddress,
  ContactUrl,
  ContactIM,
  ContactLang,
  ContactRelated,
} from '../types'

// ---------------------------------------------------------------------------
// RFC 6868 caret-encoding
// Per RFC 6868 §2: ^n → newline, ^^ → ^, ^' → "
// Applied to/from parameter values.
// ---------------------------------------------------------------------------

/**
 * Decode RFC 6868 caret-encoded string (for parameter values).
 */
export function decodeCaretEncoding(s: string): string {
  return s.replace(/\^n/gi, '\n').replace(/\^\^/g, '^').replace(/\^'/g, '"')
}

/**
 * Encode a string for RFC 6868 format (for parameter values).
 */
export function encodeCaretEncoding(s: string): string {
  return s.replace(/\^/g, '^^').replace(/'/g, "^'").replace(/\n/g, '^n')
}

// ---------------------------------------------------------------------------
// Line unfolding / folding
// RFC 6350 §3.2: lines longer than 75 octets should be folded.
// ---------------------------------------------------------------------------

/**
 * Unfold continuation lines (lines starting with space or tab).
 * Lenient: handles CRLF/LF, and catches common folded patterns.
 */
function unfoldVCard(vCard: string): string[] {
  const unfolded = vCard.replace(/\r?\n[ \t]/g, '')
  return unfolded.split(/\r?\n/)
}

/**
 * Fold a line at 75 UTF-8 octets, continuation lines start with a space.
 */
function foldLine(line: string): string {
  const maxBytes = 75
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= maxBytes) return line

  const parts: string[] = []
  let i = 0
  while (i < bytes.length) {
    if (i > 0) {
      // Need to break at or before byte 75
      let breakAt = i + maxBytes
      if (breakAt > bytes.length) breakAt = bytes.length

      // If we can't fit, back up to a character boundary
      while (breakAt > i && (bytes[breakAt - 1] & 0x80) !== 0 && (bytes[breakAt] & 0xc0) === 0x80) {
        breakAt--
      }
      if (breakAt === i) breakAt = Math.min(i + maxBytes, bytes.length) // fallback

      parts.push(' ' + new TextDecoder().decode(bytes.subarray(i, breakAt)))
      i = breakAt
    } else {
      // First line: no leading space, but same byte limit
      let breakAt = maxBytes
      if (breakAt > bytes.length) breakAt = bytes.length
      while (breakAt < bytes.length && (bytes[breakAt] & 0xc0) === 0x80) {
        breakAt-- // back up to valid UTF-8 start
      }
      if (breakAt === 0) breakAt = Math.min(maxBytes, bytes.length)

      parts.push(new TextDecoder().decode(bytes.subarray(i, breakAt)))
      i = breakAt
    }
  }
  return parts.join('\r\n')
}

// ---------------------------------------------------------------------------
// Value escaping / unescaping (RFC 6350 §3.4)
// ---------------------------------------------------------------------------

/**
 * Escape special characters in a vCard property value.
 * Applied to NOTE, and any other free-text values.
 */
function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Unescape a vCard property value (reverse of escapeVCardValue).
 * Applied to all parsed property values that may contain escapes.
 */
function unescapeVCardValue(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a single vCard line with property params.
 * e.g. 'EMAIL;TYPE=HOME:john@example.com' → { params: 'TYPE=HOME', value: 'john@example.com' }
 */
function parseLineWithParams(
  line: string,
  property: string
): { value: string; params: string } | null {
  const lineUpper = line.toUpperCase()
  const prefixWithSemicolon = (property + ';').toUpperCase()
  const prefixWithColon = (property + ':').toUpperCase()

  if (lineUpper.startsWith(prefixWithSemicolon)) {
    const rest = line.substring(property.length + 1)
    const colonIndex = rest.indexOf(':')
    if (colonIndex >= 0) {
      return {
        params: rest.substring(0, colonIndex),
        value: rest.substring(colonIndex + 1),
      }
    }
  } else if (lineUpper.startsWith(prefixWithColon)) {
    return {
      params: '',
      value: line.substring(property.length + 1),
    }
  }
  return null
}

function extractProperty(lines: string[], property: string): string | null {
  const prefix = property + ':'
  const prefixUpper = prefix.toUpperCase()

  for (const line of lines) {
    const lineUpper = line.toUpperCase()
    if (lineUpper.startsWith(prefixUpper)) {
      return line.substring(prefix.length)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// itemN. grouped property support (Apple Address Book format)
// ---------------------------------------------------------------------------

/** Apple AB tokens that map to standard type values */
const APPLE_LABEL_MAP: Record<string, string> = {
  '_$!<Mobile>!$_': 'cell',
  '_$!<HomePage>!$_': 'other',
  '_$!<Main>!$_': 'pref',
  '_$!<Work>!$_': 'work',
  '_$!<Home>!$_': 'home',
  '_$!<WorkFAX>!$_': 'fax',
  '_$!<Other>!$_': 'other',
}

/**
 * Process itemN. grouped properties (Apple Address Book format).
 * Scans for itemN.X-ABLabel lines and applies their values as type overrides
 * on the matching itemN.TEL/EMAIL/URL/ADR line.
 * Both the label line and the data line are preserved in opaqueLines.
 *
 * Returns a map of itemId → type string to apply.
 */
function processItemNGroups(
  lines: string[]
): Map<string, { dataLine: string; labelValue: string }> {
  const result = new Map<string, { dataLine: string; labelValue: string }>()
  const labelRegex = /^ITEM(\d+)\.X-ABLABEL$/i
  const dataPropRegex = /^ITEM(\d+)\.(TEL|EMAIL|URL|ADR)/i

  // Build index of label lines
  const labelLines = new Map<string, string>() // itemId → raw label line
  for (const line of lines) {
    const match = line.match(labelRegex)
    if (match) {
      const itemId = match[1]
      const parsed = parseLineWithParams(line, `ITEM${itemId}.X-ABLABEL`)
      if (parsed) {
        const rawValue = decodeCaretEncoding(parsed.value)
        labelLines.set(itemId, rawValue)
      }
    }
  }

  // Match data lines to their labels
  for (const line of lines) {
    const match = line.match(dataPropRegex)
    if (match) {
      const itemId = match[1]
      const labelValue = labelLines.get(itemId)
      if (labelValue !== undefined) {
        result.set(itemId, { dataLine: line, labelValue })
      }
    }
  }

  return result
}

/**
 * Apply Apple AB label token to a type string.
 */
function applyAppleLabel(type: string, labelValue: string): string {
  const mapped = APPLE_LABEL_MAP[labelValue]
  if (mapped) return mapped

  // Fallback: if label is a known string, use it
  const lower = labelValue.toLowerCase()
  if (lower.includes('mobile') || lower.includes('cell')) return 'cell'
  if (lower.includes('home')) return 'home'
  if (lower.includes('work')) return 'work'
  if (lower.includes('fax')) return 'fax'
  if (lower.includes('main') || lower.includes('primary')) return 'pref'
  return type
}

// ---------------------------------------------------------------------------
// Field extractors
// ---------------------------------------------------------------------------

function extractEmails(
  lines: string[],
  itemNMap: Map<string, { dataLine: string; labelValue: string }>
): ContactEmail[] {
  const emails: ContactEmail[] = []
  const usedItemNs = new Set<string>()

  for (const line of lines) {
    if (!line.toUpperCase().startsWith('EMAIL')) continue

    const result = parseLineWithParams(line, 'EMAIL')
    if (!result) continue

    let type = parseTypeParam(result.params)
    const isPrimary =
      result.params.toUpperCase().includes('PREF') || result.params.includes('TYPE=pref')

    // Check for itemN group with Apple label
    const itemNMatch = line.match(/^ITEM(\d+)\./i)
    if (itemNMatch) {
      const itemId = itemNMatch[1]
      const groupInfo = itemNMap.get(itemId)
      if (groupInfo && !usedItemNs.has(itemId)) {
        type = applyAppleLabel(type, groupInfo.labelValue) as typeof type
        usedItemNs.add(itemId)
      }
    }

    emails.push({
      value: unescapeVCardValue(result.value),
      type,
      isPrimary,
    })
  }

  // Mark first as primary if none marked
  if (emails.length > 0 && !emails.some((e) => e.isPrimary)) {
    emails[0].isPrimary = true
  }

  return emails
}

function extractPhones(
  lines: string[],
  itemNMap: Map<string, { dataLine: string; labelValue: string }>
): ContactPhone[] {
  const phones: ContactPhone[] = []
  const usedItemNs = new Set<string>()

  for (const line of lines) {
    if (!line.toUpperCase().startsWith('TEL')) continue

    const result = parseLineWithParams(line, 'TEL')
    if (!result) continue

    let type = parsePhoneTypeParam(result.params)
    const isPrimary =
      result.params.toUpperCase().includes('PREF') || result.params.includes('TYPE=pref')

    // Check for itemN group with Apple label
    const itemNMatch = line.match(/^ITEM(\d+)\./i)
    if (itemNMatch) {
      const itemId = itemNMatch[1]
      const groupInfo = itemNMap.get(itemId)
      if (groupInfo && !usedItemNs.has(itemId)) {
        type = applyAppleLabel(type, groupInfo.labelValue) as typeof type
        usedItemNs.add(itemId)
      }
    }

    phones.push({
      value: unescapeVCardValue(result.value),
      type,
      isPrimary,
    })
  }

  // Mark first as primary if none marked
  if (phones.length > 0 && !phones.some((p) => p.isPrimary)) {
    phones[0].isPrimary = true
  }

  return phones
}

function extractAddresses(
  lines: string[],
  itemNMap: Map<string, { dataLine: string; labelValue: string }>
): ContactAddress[] {
  const addresses: ContactAddress[] = []
  const usedItemNs = new Set<string>()

  for (const line of lines) {
    if (!line.toUpperCase().startsWith('ADR')) continue

    const result = parseLineWithParams(line, 'ADR')
    if (!result) continue

    let type = parseTypeParam(result.params)
    const isPrimary =
      result.params.toUpperCase().includes('PREF') || result.params.includes('TYPE=pref')

    // Check for itemN group with Apple label
    const itemNMatch = line.match(/^ITEM(\d+)\./i)
    if (itemNMatch) {
      const itemId = itemNMatch[1]
      const groupInfo = itemNMap.get(itemId)
      if (groupInfo && !usedItemNs.has(itemId)) {
        type = applyAppleLabel(type, groupInfo.labelValue) as typeof type
        usedItemNs.add(itemId)
      }
    }

    const parts = result.value.split(';')

    addresses.push({
      type,
      isPrimary,
      poBox: unescapeVCardValue(parts[0] || ''),
      extended: unescapeVCardValue(parts[1] || ''),
      street: unescapeVCardValue(parts[2] || ''),
      city: unescapeVCardValue(parts[3] || ''),
      region: unescapeVCardValue(parts[4] || ''),
      postalCode: unescapeVCardValue(parts[5] || ''),
      country: unescapeVCardValue(parts[6] || ''),
    })
  }

  // Mark first as primary if none marked
  if (addresses.length > 0 && !addresses.some((a) => a.isPrimary)) {
    addresses[0].isPrimary = true
  }

  return addresses
}

function extractUrls(
  lines: string[],
  itemNMap: Map<string, { dataLine: string; labelValue: string }>
): ContactUrl[] {
  const urls: ContactUrl[] = []
  const usedItemNs = new Set<string>()

  for (const line of lines) {
    if (!line.toUpperCase().startsWith('URL')) continue

    const result = parseLineWithParams(line, 'URL')
    if (!result) continue

    let type = parseTypeParam(result.params)
    const isPrimary =
      result.params.toUpperCase().includes('PREF') || result.params.includes('TYPE=pref')

    // Check for itemN group with Apple label
    const itemNMatch = line.match(/^ITEM(\d+)\./i)
    if (itemNMatch) {
      const itemId = itemNMatch[1]
      const groupInfo = itemNMap.get(itemId)
      if (groupInfo && !usedItemNs.has(itemId)) {
        type = applyAppleLabel(type, groupInfo.labelValue) as typeof type
        usedItemNs.add(itemId)
      }
    }

    urls.push({
      value: unescapeVCardValue(result.value),
      type,
      isPrimary,
    })
  }

  // Mark first as primary if none marked
  if (urls.length > 0 && !urls.some((u) => u.isPrimary)) {
    urls[0].isPrimary = true
  }

  return urls
}

function extractIMs(lines: string[]): ContactIM[] {
  const ims: ContactIM[] = []

  for (const line of lines) {
    if (!line.toUpperCase().startsWith('IMPP')) continue

    const result = parseLineWithParams(line, 'IMPP')
    if (!result) continue

    const type = parseTypeParam(result.params)
    const protocol = parseIMProtocol(result.params)
    const isPrimary =
      result.params.toUpperCase().includes('PREF') || result.params.includes('TYPE=pref')

    ims.push({
      value: unescapeVCardValue(result.value),
      type,
      protocol,
      isPrimary,
    })
  }

  // Mark first as primary if none marked
  if (ims.length > 0 && !ims.some((i) => i.isPrimary)) {
    ims[0].isPrimary = true
  }

  return ims
}

function extractPhoto(lines: string[]): string | null {
  for (const line of lines) {
    if (!line.toUpperCase().startsWith('PHOTO')) continue

    // Handle inline base64
    if (line.toUpperCase().includes('ENCODING=B')) {
      const colonIndex = line.lastIndexOf(':')
      if (colonIndex >= 0) {
        const base64 = line.substring(colonIndex + 1)
        return `data:image/jpeg;base64,${base64}`
      }
    }

    // Handle URI
    if (line.toUpperCase().includes('VALUE=URI')) {
      const colonIndex = line.indexOf(':')
      if (colonIndex >= 0) {
        return line.substring(colonIndex + 1)
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// New vCard property extractors (XML, LANG, RELATED, MEMBER)
// ---------------------------------------------------------------------------

function extractXmlData(lines: string[]): string | null {
  for (const line of lines) {
    if (!line.toUpperCase().startsWith('XML')) continue
    const colonIndex = line.indexOf(':')
    if (colonIndex >= 0) {
      return line.substring(colonIndex + 1)
    }
  }
  return null
}

function extractLangs(lines: string[]): ContactLang[] {
  const langs: ContactLang[] = []
  for (const line of lines) {
    if (!line.toUpperCase().startsWith('LANG')) continue
    const parsed = parseLineWithParams(line, 'LANG')
    if (!parsed) continue
    const type = parseTypeParam(parsed.params)
    const isPrimary = parsed.params.toUpperCase().includes('PREF')
    langs.push({
      value: unescapeVCardValue(parsed.value),
      type,
      isPrimary,
    })
  }
  if (langs.length > 0 && !langs.some((l) => l.isPrimary)) {
    langs[0].isPrimary = true
  }
  return langs
}

function parseRelatedType(params: string): ContactRelated['type'] {
  const upper = params.toUpperCase()
  if (upper.includes('FRIEND')) return 'friend'
  if (upper.includes('CO-WORKER') || upper.includes('COWORKER')) return 'co-worker'
  if (upper.includes('FAMILY')) return 'family'
  if (upper.includes('CHILD')) return 'child'
  if (upper.includes('SPOUSE')) return 'spouse'
  if (upper.includes('AGENT')) return 'agent'
  if (upper.includes('EMERGENCY')) return 'emergency'
  return 'other'
}

function extractRelated(lines: string[]): ContactRelated[] {
  const related: ContactRelated[] = []
  for (const line of lines) {
    if (!line.toUpperCase().startsWith('RELATED')) continue
    const parsed = parseLineWithParams(line, 'RELATED')
    if (!parsed) continue
    const type = parseRelatedType(parsed.params)
    const isPrimary = parsed.params.toUpperCase().includes('PREF')
    related.push({
      value: unescapeVCardValue(parsed.value),
      type,
      isPrimary,
    })
  }
  if (related.length > 0 && !related.some((r) => r.isPrimary)) {
    related[0].isPrimary = true
  }
  return related
}

function extractMemberUids(lines: string[]): string[] {
  const members: string[] = []
  for (const line of lines) {
    if (!line.toUpperCase().startsWith('MEMBER')) continue
    const parsed = parseLineWithParams(line, 'MEMBER')
    if (parsed) {
      members.push(unescapeVCardValue(parsed.value))
    }
  }
  return members
}

// ---------------------------------------------------------------------------
// Parameter parsers
// ---------------------------------------------------------------------------

function parseTypeParam(params: string): 'home' | 'work' | 'other' | 'pref' {
  const upper = params.toUpperCase()
  if (upper.includes('WORK')) return 'work'
  if (upper.includes('HOME')) return 'home'
  if (upper.includes('PREF')) return 'pref'
  return 'other'
}

function parsePhoneTypeParam(params: string): 'home' | 'work' | 'cell' | 'fax' | 'other' | 'pref' {
  const upper = params.toUpperCase()
  if (upper.includes('WORK')) return 'work'
  if (upper.includes('HOME')) return 'home'
  if (upper.includes('CELL') || upper.includes('MOBILE')) return 'cell'
  if (upper.includes('FAX')) return 'fax'
  if (upper.includes('PREF')) return 'pref'
  return 'other'
}

function parseIMProtocol(params: string): ContactIM['protocol'] {
  const upper = params.toUpperCase()
  if (upper.includes('AIM')) return 'aim'
  if (upper.includes('EMAIL')) return 'email'
  if (upper.includes('FACEBOOK')) return 'facebook'
  if (upper.includes('GOOGLE')) return 'google'
  if (upper.includes('IRC')) return 'irc'
  if (upper.includes('MSN')) return 'msn'
  if (upper.includes('QQ')) return 'qq'
  if (upper.includes('SKYPE')) return 'skype'
  if (upper.includes('TWITTER')) return 'twitter'
  if (upper.includes('XMPP') || upper.includes('JABBER')) return 'xmpp'
  return 'other'
}

function parseVCardDate(dateStr: string | null): string | null {
  if (!dateStr) return null

  // Handle YYYYMMDD format
  if (/^\d{8}$/.test(dateStr)) {
    const year = dateStr.substring(0, 4)
    const month = dateStr.substring(4, 6)
    const day = dateStr.substring(6, 8)
    return `${year}-${month}-${day}`
  }

  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr
  }

  // Handle DD MM YYYY format (vCard 3.0)
  if (/^\d{2} \d{2} \d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split(' ')
    return `${year}-${month}-${day}`
  }

  // Handle date-time formats
  if (dateStr.includes('T')) {
    return dateStr.split('T')[0]
  }

  return null
}

function formatVCardDate(dateStr: string): string | null {
  if (!dateStr) return null

  // Convert YYYY-MM-DD to YYYYMMDD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr.replace(/-/g, '')
  }

  // Handle full ISO 8601 timestamp: extract YYYYMMDDTHHMMSSZ
  // e.g. "2026-06-23T06:33:24.983Z" → "20260623T063324Z"
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/)
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}T${isoMatch[4]}${isoMatch[5]}${isoMatch[6]}Z`
  }

  return dateStr
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a vCard string into a Contact object.
 * Supports vCard 3.0 and 4.0.
 *
 * Unknown / opaque lines are preserved in `opaqueLines` for round-trip fidelity.
 * itemN. grouped properties (Apple Address Book format) are parsed and their
 * label values applied to the corresponding fields; both lines are preserved
 * in opaqueLines.
 *
 * RFC 6868 caret-encoding is decoded in parameter values.
 * RFC 6350 §3.4 escapes are reversed in all property values.
 */
export function parseVCard(
  vCardString: string,
  addressBookId: string,
  accountId: string
): Contact | null {
  const lines = unfoldVCard(vCardString)

  // Process itemN. grouped properties before the opaque pass
  const itemNMap = processItemNGroups(lines)

  // Collect opaque (unknown) lines
  const knownPrefixes = [
    'BEGIN',
    'END',
    'VERSION',
    'FN',
    'N',
    'UID',
    'URL',
    'ORG',
    'TITLE',
    'ROLE',
    'EMAIL',
    'TEL',
    'ADR',
    'IMPP',
    'BDAY',
    'ANNIVERSARY',
    'GENDER',
    'NOTE',
    'CATEGORIES',
    'PHOTO',
    'CREATED',
    'REV',
    'PRODID',
    'XML',
    'LANG',
    'RELATED',
    'MEMBER',
  ]
  const opaqueLines: string[] = []

  for (const line of lines) {
    const upper = line.toUpperCase().split(':')[0].split(';')[0]
    const isKnown = knownPrefixes.some((p) => upper.startsWith(p))
    if (!isKnown && line.trim() !== '') {
      opaqueLines.push(line)
    }
  }

  // Extract basic properties
  const fn = extractProperty(lines, 'FN') || ''
  const n = extractProperty(lines, 'N') || ''
  const nParts = n.split(';')

  const uid = extractProperty(lines, 'UID') || crypto.randomUUID()
  const url = extractProperty(lines, 'URL') || ''

  // Parse structured name
  const familyName = unescapeVCardValue(nParts[0] || '')
  const givenName = unescapeVCardValue(nParts[1] || '')
  const additionalNames = unescapeVCardValue(nParts[2] || '')
  const prefixes = unescapeVCardValue(nParts[3] || '')
  const suffixes = unescapeVCardValue(nParts[4] || '')

  // Parse organization
  const org = extractProperty(lines, 'ORG') || ''
  const orgParts = org.split(';')
  const organization = unescapeVCardValue(orgParts[0] || '')
  const department = unescapeVCardValue(orgParts[1] || '')

  // Parse title and role
  const title = unescapeVCardValue(extractProperty(lines, 'TITLE') || '')
  const role = unescapeVCardValue(extractProperty(lines, 'ROLE') || '')

  // Parse emails
  const emails = extractEmails(lines, itemNMap)

  // Parse phones
  const phones = extractPhones(lines, itemNMap)

  // Parse addresses
  const addresses = extractAddresses(lines, itemNMap)

  // Parse URLs
  const urls = extractUrls(lines, itemNMap)

  // Parse IMs
  const ims = extractIMs(lines)

  // Parse dates
  const birthday = parseVCardDate(extractProperty(lines, 'BDAY'))
  const anniversary = parseVCardDate(extractProperty(lines, 'ANNIVERSARY'))

  // Parse gender
  const gender = extractProperty(lines, 'GENDER') || ''

  // Parse nickname
  const nickname = unescapeVCardValue(extractProperty(lines, 'NICKNAME') || '')

  // Parse note
  const note = unescapeVCardValue(extractProperty(lines, 'NOTE') || '')

  // Parse categories
  const categoriesStr = extractProperty(lines, 'CATEGORIES') || ''
  const categories = categoriesStr
    .split(',')
    .map((c) => unescapeVCardValue(c.trim()))
    .filter(Boolean)

  // Parse photo
  const photo = extractPhoto(lines)

  // Parse XML data
  const xmlData = extractXmlData(lines)

  // Parse languages
  const langs = extractLangs(lines)

  // Parse related contacts
  const related = extractRelated(lines)

  // Parse member UIDs (groups)
  const memberUids = extractMemberUids(lines)
  const isGroup = memberUids.length > 0

  // Parse timestamps
  const created = extractProperty(lines, 'CREATED') || new Date().toISOString()
  const lastModified = extractProperty(lines, 'REV') || new Date().toISOString()

  // Derive fallback display name from N or ORG, only fall back to 'Unknown' if both empty
  let displayName = fn
  if (!displayName) {
    const derivedFromN = `${givenName} ${familyName}`.trim()
    if (derivedFromN) {
      displayName = derivedFromN
    } else if (organization) {
      displayName = organization
    } else {
      displayName = 'Unknown'
    }
  }

  return {
    id: uid,
    addressBookId,
    accountId,
    url,
    familyName,
    givenName,
    additionalNames,
    prefixes,
    suffixes,
    displayName,
    organization,
    department,
    title,
    role,
    emails,
    phones,
    addresses,
    urls,
    ims,
    birthday,
    anniversary,
    gender,
    nickname,
    note,
    categories,
    photo,
    rawVCard: vCardString,
    createdAt: created,
    lastModified,
    opaqueLines,
    isGroup,
    memberUids,
    langs,
    related,
    xmlData,
  }
}

// ---------------------------------------------------------------------------
// Main serializer
// ---------------------------------------------------------------------------

const CALINO_PRODID = '-//Calino//Calino 0.15//EN'

/**
 * Serialize a Contact object into a vCard string.
 *
 * @param contact     - The contact to serialize
 * @param targetVersion - Target vCard version: '3.0' or '4.0' (default '4.0')
 *
 * When `targetVersion` is '3.0':
 * - VERSION:3.0 is emitted instead of 4.0
 * - PHOTO uses ENCODING=b;TYPE=JPEG: (inline base64)
 * - TYPE=pref is used instead of PREF=1
 * - TYPE values are comma-joined (e.g. TYPE=HOME,VOICE)
 *
 * `contact.opaqueLines` is emitted verbatim before END:VCARD.
 * If opaqueLines contains a non-Calino PRODID, it is preserved.
 * REV is always set to current UTC timestamp.
 * PRODID is set to Calino's unless the original was a non-Calino PRODID in opaqueLines.
 */
export function contactToVCard(contact: Contact, targetVersion: '3.0' | '4.0' = '4.0'): string {
  const lines: string[] = []

  lines.push('BEGIN:VCARD')
  lines.push(`VERSION:${targetVersion}`)

  // UID
  lines.push(`UID:${contact.id}`)

  // Structured name
  const n = [
    contact.familyName,
    contact.givenName,
    contact.additionalNames,
    contact.prefixes,
    contact.suffixes,
  ]
    .map((v) => escapeVCardValue(v))
    .join(';')
  lines.push(`N:${n}`)

  // Display name
  if (contact.displayName) {
    lines.push(`FN:${escapeVCardValue(contact.displayName)}`)
  }

  // Organization
  if (contact.organization || contact.department) {
    lines.push(
      `ORG:${escapeVCardValue(contact.organization)};${escapeVCardValue(contact.department)}`
    )
  }

  // Title and role
  if (contact.title) {
    lines.push(`TITLE:${escapeVCardValue(contact.title)}`)
  }
  if (contact.role) {
    lines.push(`ROLE:${escapeVCardValue(contact.role)}`)
  }

  // Emails
  for (const email of contact.emails) {
    const params = buildTypeParamsV(targetVersion, email.type, email.isPrimary)
    lines.push(`EMAIL${params}:${escapeVCardValue(email.value)}`)
  }

  // Phones
  for (const phone of contact.phones) {
    const params = buildTypeParamsV(targetVersion, phone.type, phone.isPrimary)
    lines.push(`TEL${params}:${escapeVCardValue(phone.value)}`)
  }

  // Addresses
  for (const addr of contact.addresses) {
    const params = buildTypeParamsV(targetVersion, addr.type, addr.isPrimary)
    const value = [
      escapeVCardValue(addr.poBox),
      escapeVCardValue(addr.extended),
      escapeVCardValue(addr.street),
      escapeVCardValue(addr.city),
      escapeVCardValue(addr.region),
      escapeVCardValue(addr.postalCode),
      escapeVCardValue(addr.country),
    ].join(';')
    lines.push(`ADR${params}:${value}`)
  }

  // URLs
  for (const url of contact.urls) {
    const params = buildTypeParamsV(targetVersion, url.type, url.isPrimary)
    lines.push(`URL${params}:${escapeVCardValue(url.value)}`)
  }

  // IMs
  for (const im of contact.ims) {
    const params = buildIMParamsV(targetVersion, im.type, im.protocol, im.isPrimary)
    lines.push(`IMPP${params}:${escapeVCardValue(im.value)}`)
  }

  // Birthday
  if (contact.birthday) {
    const bday = formatVCardDate(contact.birthday)
    if (bday) {
      lines.push(`BDAY:${bday}`)
    }
  }

  // Anniversary
  if (contact.anniversary) {
    const ann = formatVCardDate(contact.anniversary)
    if (ann) {
      lines.push(`ANNIVERSARY:${ann}`)
    }
  }

  // Gender
  if (contact.gender) {
    lines.push(`GENDER:${contact.gender}`)
  }

  // Nickname
  if (contact.nickname) {
    lines.push(`NICKNAME:${escapeVCardValue(contact.nickname)}`)
  }

  // Note
  if (contact.note) {
    lines.push(`NOTE:${escapeVCardValue(contact.note)}`)
  }

  // Categories
  if (contact.categories.length > 0) {
    lines.push(`CATEGORIES:${contact.categories.map((c) => escapeVCardValue(c)).join(',')}`)
  }

  // Languages
  if (contact.langs && contact.langs.length > 0) {
    for (const lang of contact.langs) {
      const params = buildTypeParamsV(targetVersion, lang.type, lang.isPrimary)
      lines.push(`LANG${params}:${escapeVCardValue(lang.value)}`)
    }
  }

  // Related contacts
  if (contact.related && contact.related.length > 0) {
    for (const rel of contact.related) {
      const params = buildRelatedParamsV(targetVersion, rel.type, rel.isPrimary)
      lines.push(`RELATED${params}:${escapeVCardValue(rel.value)}`)
    }
  }

  // XML data
  if (contact.xmlData) {
    lines.push(`XML:${contact.xmlData}`)
  }

  // Member UIDs (groups)
  if (contact.memberUids && contact.memberUids.length > 0) {
    for (const uid of contact.memberUids) {
      lines.push(`MEMBER:${uid}`)
    }
  }

  // Photo
  if (contact.photo) {
    if (contact.photo.startsWith('data:')) {
      const base64 = contact.photo.split(',')[1]
      if (base64) {
        if (targetVersion === '3.0') {
          lines.push('PHOTO;ENCODING=b;TYPE=JPEG:' + base64)
        } else {
          lines.push('PHOTO;ENCODING=b;TYPE=JPEG:' + base64)
        }
      }
    } else if (contact.photo.startsWith('http')) {
      lines.push(`PHOTO;VALUE=URI:${contact.photo}`)
    }
  }

  // Timestamps
  lines.push(`CREATED:${contact.createdAt}`)

  // REV: always current UTC
  const now = new Date()
  const revDate = formatVCardDate(now.toISOString()) || ''
  lines.push(`REV:${revDate}`)

  // PRODID: preserve original non-Calino PRODID from opaqueLines
  const opaque = contact.opaqueLines ?? []
  const hasOtherProdid = opaque.some((l) => {
    const upper = l.toUpperCase()
    return upper.startsWith('PRODID:') && !l.includes(CALINO_PRODID)
  })
  if (hasOtherProdid) {
    // Preserve the non-Calino PRODID — don't write our own
  } else {
    lines.push(`PRODID:${CALINO_PRODID}`)
  }

  // Emit opaque lines verbatim before END
  for (const opaqueLine of opaque) {
    lines.push(opaqueLine)
  }

  lines.push('END:VCARD')

  // Fold every line
  return lines.map((l) => foldLine(l)).join('\r\n')
}

// ---------------------------------------------------------------------------
// Version-aware type param builders
// ---------------------------------------------------------------------------

function buildTypeParamsV(version: '3.0' | '4.0', type: string, isPrimary: boolean): string {
  const parts: string[] = []

  if (version === '3.0') {
    // 3.0: comma-joined TYPE values, pref as TYPE=pref
    const typeParts: string[] = []
    if (type !== 'other') typeParts.push(type)
    if (isPrimary) typeParts.push('pref')
    if (typeParts.length > 0) parts.push(`TYPE=${typeParts.join(',')}`)
  } else {
    // 4.0: separate TYPE=... params for each type value + TYPE=pref for primary
    if (type !== 'other') parts.push(`TYPE=${type}`)
    if (isPrimary) parts.push('TYPE=pref')
  }

  return parts.length > 0 ? ';' + parts.join(';') : ''
}

function buildIMParamsV(
  version: '3.0' | '4.0',
  type: string,
  protocol: string,
  isPrimary: boolean
): string {
  const parts: string[] = []

  if (version === '3.0') {
    const typeParts: string[] = []
    if (type !== 'other') typeParts.push(type)
    if (isPrimary) typeParts.push('pref')
    if (typeParts.length > 0) parts.push(`TYPE=${typeParts.join(',')}`)
  } else {
    // 4.0: TYPE first, then protocol, then TYPE=pref
    if (type !== 'other') parts.push(`TYPE=${type}`)
    if (protocol !== 'other') parts.push(`X-SERVICE-TYPE=${protocol}`)
    if (isPrimary) parts.push('TYPE=pref')
  }

  return parts.length > 0 ? ';' + parts.join(';') : ''
}

function buildRelatedParamsV(version: '3.0' | '4.0', type: string, isPrimary: boolean): string {
  const parts: string[] = []

  if (version === '3.0') {
    const typeParts: string[] = []
    if (type !== 'other') typeParts.push(type)
    if (isPrimary) typeParts.push('pref')
    if (typeParts.length > 0) parts.push(`TYPE=${typeParts.join(',')}`)
  } else {
    if (type !== 'other') parts.push(`TYPE=${type}`)
    if (isPrimary) parts.push('TYPE=pref')
  }

  return parts.length > 0 ? ';' + parts.join(';') : ''
}
