/**
 * Compare two resource hrefs for identity.
 *
 * Stored `resourceHref` values come from tsdav's `obj.url`; sync-collection
 * hrefs are resolved against the collection URL. The same resource can
 * therefore arrive as an absolute URL from one path and a server-relative one
 * from the other, and servers are inconsistent about a trailing slash. Compare
 * on the path only, and keep percent-encoding as-is — decoding would fold
 * `%2F` into a path separator.
 */
export function hrefKey(href: string): string {
  let path = href
  try {
    path = new URL(href, 'http://x.invalid').pathname
  } catch {
    // Not URL-shaped; fall through and compare the raw string.
  }
  return path.replace(/\/+$/, '')
}
