/**
 * Links into other apps inside markdown text: which configured app a link goes
 * to, and turning bare links of those apps into autolinks.
 */

/** The configured app a link goes to, by its scheme, or undefined. */
export function appOf(
  href: string | undefined,
  schemes: Readonly<Record<string, string>>
): string | undefined {
  const colon = href?.indexOf(':') ?? -1
  if (colon <= 0) return undefined
  const scheme = href!.slice(0, colon).toLowerCase()
  return Object.hasOwn(schemes, scheme) ? schemes[scheme] : undefined
}

/**
 * GFM finds bare web addresses by itself, not those of other apps. A bare
 * `<scheme>://…` of a configured app becomes an autolink, which CommonMark
 * accepts for any scheme. One already inside `<…>` or a markdown link
 * `[…](…)` is left as it is, and punctuation that ends a sentence or closes a
 * bracket is not taken into the address.
 */
export function linkBareAppLinks(text: string, schemes: Readonly<Record<string, string>>): string {
  const names = Object.keys(schemes)
  if (names.length === 0) return text
  const alternatives = names.map((scheme) => scheme.replace(/[.+-]/g, '\\$&')).join('|')
  const bare = new RegExp(
    `(?<![\\w<]|\\]\\()((?:${alternatives}):\\/\\/[^\\s<>]*[^\\s<>.,;:!?)\\]])`,
    'gi'
  )
  return text.replace(bare, '<$1>')
}
