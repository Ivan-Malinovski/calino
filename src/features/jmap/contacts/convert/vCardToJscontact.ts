import type { JsonObject } from '../../types'
import { metadata, parseProperties, split, unescape, type JSContactCard } from './values'

function date(value: string): JsonObject {
  const match =
    value.match(/^(?:(\d{4})-?)?(\d{2})-?(\d{2})$/) ?? value.match(/^--(\d{2})-?(\d{2})$/)
  if (!match) return { '@type': 'Timestamp', utc: value }
  const partial = match.length === 3
  return {
    '@type': 'PartialDate',
    ...(partial || !match[1] ? {} : { year: Number(match[1]) }),
    month: Number(match[partial ? 1 : 2]),
    day: Number(match[partial ? 2 : 3]),
  }
}

/** RFC 9555 mappings, without unsupported vendor properties. No uid is invented. */
export function vCardToJscontact(vcard: string): JSContactCard {
  const card: JSContactCard = { '@type': 'Card', version: '1.0' }
  const properties = parseProperties(vcard)
  const counters: Record<string, number> = Object.create(null)
  const add = (field: string, value: JsonObject): string => {
    const id = `${field}${(counters[field] = (counters[field] ?? 0) + 1)}`
    const map = (card[field] ??= {}) as JsonObject
    map[id] = value
    return id
  }
  const name: JsonObject = { '@type': 'Name' }
  const organizations: { id: string; group: string }[] = []
  for (const property of properties) {
    const { name: key, params, value } = property
    const text = unescape(value)
    const meta = metadata(property)
    switch (key) {
      case 'UID':
        card.uid = text
        break
      case 'KIND':
        card.kind = text.toLowerCase()
        break
      case 'FN': {
        if (params.LANGUAGE) {
          const language = params.LANGUAGE[0]
          const localizations = (card.localizations ??= {}) as JsonObject
          localizations[language] = {
            ...((localizations[language] ?? {}) as JsonObject),
            'name/full': text,
          }
        }
        if (!name.full || !params.LANGUAGE) name.full = text
        break
      }
      case 'N': {
        const kinds = ['surname', 'given', 'given2', 'title', 'generation']
        name.components = split(value, ';').flatMap((component, index) =>
          split(component, ',')
            .filter(Boolean)
            .map((part) => ({
              '@type': 'NameComponent',
              kind: kinds[index] ?? 'surname',
              value: unescape(part),
            }))
        )
        if (params['SORT-AS'])
          name.sortAs = Object.fromEntries(
            params['SORT-AS'].map((part, index) => [kinds[index], part])
          )
        break
      }
      case 'NICKNAME':
        for (const part of split(value, ','))
          add('nicknames', { '@type': 'Nickname', name: unescape(part), ...meta })
        break
      case 'ORG': {
        const [org, ...units] = split(value, ';').map(unescape)
        const id = add('organizations', {
          '@type': 'Organization',
          name: org,
          ...(units.some(Boolean)
            ? { units: units.filter(Boolean).map((unit) => ({ '@type': 'OrgUnit', name: unit })) }
            : {}),
          ...meta,
        })
        organizations.push({ id, group: '' })
        break
      }
      case 'TITLE':
      case 'ROLE':
        add('titles', { '@type': 'Title', kind: key.toLowerCase(), name: text, ...meta })
        break
      case 'EMAIL':
        add('emails', { '@type': 'EmailAddress', address: text, ...meta })
        break
      case 'TEL': {
        const features = Object.fromEntries(
          (params.TYPE ?? [])
            .map((item) => item.toLowerCase())
            .filter((item) =>
              ['voice', 'fax', 'cell', 'video', 'pager', 'text', 'textphone'].includes(item)
            )
            .map((item) => [item === 'cell' ? 'mobile' : item, true])
        )
        add('phones', {
          '@type': 'Phone',
          number: text,
          ...(Object.keys(features).length ? { features } : {}),
          ...meta,
        })
        break
      }
      case 'ADR': {
        const kinds = [
          'postOfficeBox',
          'extension',
          'street',
          'locality',
          'region',
          'postcode',
          'country',
        ]
        const components = split(value, ';').flatMap((component, index) =>
          split(component, ',')
            .filter(Boolean)
            .map((part) => ({
              '@type': 'AddressComponent',
              kind: kinds[index] ?? 'street',
              value: unescape(part),
            }))
        )
        add('addresses', {
          '@type': 'Address',
          components,
          ...(params.LABEL ? { full: params.LABEL.join(',') } : {}),
          ...(params.CC ? { countryCode: params.CC[0] } : {}),
          ...meta,
        })
        break
      }
      case 'URL':
        add('links', { '@type': 'Link', uri: text, ...meta })
        break
      case 'IMPP':
        add('onlineServices', {
          '@type': 'OnlineService',
          uri: text,
          ...(params['X-SERVICE-TYPE'] ? { service: params['X-SERVICE-TYPE'][0] } : {}),
          ...meta,
        })
        break
      case 'NOTE':
        add('notes', { '@type': 'Note', note: text })
        break
      case 'BDAY':
      case 'ANNIVERSARY':
        add('anniversaries', {
          '@type': 'Anniversary',
          kind: key === 'BDAY' ? 'birth' : 'wedding',
          date: date(text),
        })
        break
      case 'CATEGORIES':
        card.keywords = Object.fromEntries(
          split(value, ',')
            .filter(Boolean)
            .map((part) => [unescape(part), true])
        )
        break
      case 'MEMBER': {
        const members = (card.members ??= {}) as JsonObject
        Object.defineProperty(members, text, {
          value: true,
          enumerable: true,
          configurable: true,
          writable: true,
        })
        card.kind = 'group'
        break
      }
      case 'RELATED': {
        const related = (card.relatedTo ??= {}) as JsonObject
        const previous = related[text] as JsonObject | undefined
        Object.defineProperty(related, text, {
          value: {
            '@type': 'Relation',
            relation: {
              ...((previous?.relation ?? {}) as JsonObject),
              ...Object.fromEntries(
                (params.TYPE ?? [])
                  .filter((type) => type.toLowerCase() !== 'pref')
                  .map((type) => [type.toLowerCase(), true])
              ),
            },
          },
          enumerable: true,
          configurable: true,
          writable: true,
        })
        break
      }
      case 'LANG': {
        const languages = (card.preferredLanguages ??= {}) as JsonObject
        Object.defineProperty(languages, text, {
          value: [
            ...(Array.isArray(languages[text]) ? languages[text] : []),
            { '@type': 'LanguagePref', ...meta },
          ],
          enumerable: true,
          configurable: true,
          writable: true,
        })
        break
      }
      case 'PHOTO': {
        const encoding = params.ENCODING?.[0]?.toLowerCase()
        const rawType =
          params.MEDIATYPE?.[0] ??
          params.TYPE?.find((type) => !['pref', 'home', 'work'].includes(type.toLowerCase())) ??
          'jpeg'
        const mediaType = rawType.includes('/')
          ? rawType.toLowerCase()
          : `image/${rawType.toLowerCase()}`
        const uri =
          encoding === 'b' || encoding === 'base64' ? `data:${mediaType};base64,${value}` : text
        add('media', {
          '@type': 'Media',
          kind: 'photo',
          uri,
          ...(uri.startsWith('data:')
            ? { mediaType: uri.slice(5).split(/[;,]/)[0] }
            : params.MEDIATYPE
              ? { mediaType }
              : {}),
          ...meta,
        })
        break
      }
    }
  }
  if (Object.keys(name).length > 1) card.name = name
  if (organizations.length === 1)
    for (const title of Object.values((card.titles ?? {}) as JsonObject))
      (title as JsonObject).organizationId = organizations[0].id
  return card
}
