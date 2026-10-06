import { applyJmapPatch } from '../../convert/jscalendarDiff'
import type { JsonObject } from '../../types'
import { escape, fold, object, parameters, string, values, type JSContactCard } from './values'

export interface VCardOptions {
  version?: '3.0' | '4.0'
  language?: string
}
function components(value: JsonObject, kinds: string[]): string[] {
  const list = Array.isArray(value.components) ? value.components.map(object) : []
  return kinds.map((kind) =>
    list
      .filter((component) => component.kind === kind)
      .map((component) => escape(string(component.value)))
      .join(',')
  )
}
function date(value: JsonObject): string {
  if (value['@type'] === 'Timestamp') return string(value.utc).replace(/[-:]/g, '')
  const pad = (part: number) => String(part).padStart(2, '0')
  const year = typeof value.year === 'number' ? String(value.year).padStart(4, '0') : '--'
  return typeof value.month === 'number' && typeof value.day === 'number'
    ? `${year}${pad(value.month)}${pad(value.day)}`
    : ''
}

/** Select a localization only when requested; default reads retain the base language. */
export function jscontactToVCard(input: JSContactCard, options: VCardOptions = {}): string {
  const localized = options.language ? object(object(input.localizations)[options.language]) : {}
  const card = Object.keys(localized).length ? applyJmapPatch(input, localized) : input
  const version = options.version ?? '4.0'
  const name = object(card.name)
  const nameComponents = Array.isArray(name.components) ? name.components.map(object) : []
  const derivedName = ['given', 'given2', 'surname']
    .flatMap((kind) =>
      nameComponents
        .filter((component) => component.kind === kind)
        .map((component) => string(component.value))
    )
    .filter(Boolean)
    .join(' ')
  const lines = ['BEGIN:VCARD', `VERSION:${version}`]
  const add = (key: string, value: string, params = '') => {
    if (value) lines.push(`${key}${params}:${value}`)
  }
  add('UID', escape(string(card.uid) || string(card.id)))
  lines.push(
    `FN:${escape(
      string(name.full) ||
        derivedName ||
        values(card.organizations)
          .map((org) => string(org.name))
          .find(Boolean) ||
        'Unnamed'
    )}`
  )
  lines.push(
    `N:${components(name, ['surname', 'given', 'given2', 'title', 'generation']).join(';')}`
  )
  add('KIND', string(card.kind))
  add(
    'NICKNAME',
    values(card.nicknames)
      .map((nickname) => escape(string(nickname.name)))
      .join(',')
  )
  for (const org of values(card.organizations))
    add(
      'ORG',
      [
        escape(string(org.name)),
        ...(Array.isArray(org.units)
          ? org.units.map((unit) => escape(string(object(unit).name)))
          : []),
      ].join(';')
    )
  for (const title of values(card.titles))
    add(title.kind === 'role' ? 'ROLE' : 'TITLE', escape(string(title.name)))
  for (const email of values(card.emails))
    add('EMAIL', escape(string(email.address)), parameters(email, version))
  for (const phone of values(card.phones)) {
    const features = Object.entries(object(phone.features))
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => (key === 'mobile' ? 'cell' : key))
    add(
      'TEL',
      escape(string(phone.number) || string(phone.uri)),
      parameters(phone, version, features)
    )
  }
  for (const addr of values(card.addresses)) {
    const parts = components(addr, [
      'postOfficeBox',
      'extension',
      'street',
      'locality',
      'region',
      'postcode',
      'country',
    ])
    // Calino doesn't expose LABEL: keep full-only addresses visible as street text.
    if (!parts.some(Boolean) && addr.full) parts[2] = escape(string(addr.full))
    const label = string(addr.full).replace(/\^/g, '^^').replace(/\r?\n/g, '^n').replace(/"/g, "^'")
    add('ADR', parts.join(';'), parameters(addr, version) + (label ? `;LABEL="${label}"` : ''))
  }
  for (const link of values(card.links))
    add('URL', escape(string(link.uri)), parameters(link, version))
  for (const service of values(card.onlineServices))
    add('IMPP', escape(string(service.uri) || string(service.user)), parameters(service, version))
  for (const note of values(card.notes)) add('NOTE', escape(string(note.note) || string(note.text)))
  for (const anniversary of values(card.anniversaries))
    if (['birth', 'wedding'].includes(string(anniversary.kind)))
      add(anniversary.kind === 'birth' ? 'BDAY' : 'ANNIVERSARY', date(object(anniversary.date)))
  add(
    'CATEGORIES',
    Object.entries(object(card.keywords))
      .filter(([, enabled]) => enabled === true)
      .map(([keyword]) => escape(keyword))
      .join(',')
  )
  for (const [uid, member] of Object.entries(object(card.members)))
    if (member === true) add('MEMBER', escape(uid))
  for (const [uid, relation] of Object.entries(object(card.relatedTo)))
    add(
      'RELATED',
      escape(uid),
      parameters(
        {},
        version,
        Object.entries(object(object(relation).relation))
          .filter(([, enabled]) => enabled === true)
          .map(([kind]) => kind)
      )
    )
  for (const [language, prefs] of Object.entries(object(card.preferredLanguages))) {
    if (Array.isArray(prefs))
      for (const pref of prefs) add('LANG', escape(language), parameters(object(pref), version))
    else
      add(
        'LANG',
        escape(string(object(prefs).language) || language),
        parameters(object(prefs), version)
      )
  }
  for (const media of values(card.media))
    if (media.kind === 'photo') {
      const uri = string(media.uri)
      if (version === '3.0' && /^data:[^;,]+;base64,/i.test(uri)) {
        add(
          'PHOTO',
          uri.slice(uri.indexOf(',') + 1),
          `;ENCODING=b;TYPE=${uri
            .slice(5, uri.indexOf(';'))
            .replace(/^image\//, '')
            .toUpperCase()}`
        )
      } else add('PHOTO', uri, ';VALUE=URI')
    }
  lines.push('END:VCARD')
  return lines.map(fold).join('\r\n') + '\r\n'
}
