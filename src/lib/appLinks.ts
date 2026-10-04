/**
 * Links into other apps inside markdown text: which apps are configured, which
 * of them a link goes to, and turning bare links of those apps into links.
 */

import { findAndReplace } from 'mdast-util-find-and-replace'
import type { Link, Nodes, Root } from 'mdast'

// Injected by Vite's define at build time
declare const __CALINO_CONFIG__: Record<string, unknown> | null

/** Schemes that run code instead of opening something are never links. */
const UNSAFE_SCHEMES = ['javascript', 'vbscript', 'data']

const MAX_NAME_LENGTH = 40

/**
 * The apps whose links in descriptions and notes open that app, from the
 * optional `linkSchemes` of calino.config.json: scheme → the name a bare link
 * is shown by, e.g. `{ "obsidian": "Obsidian" }`. Read on its own, apart from
 * the accounts, so a config that only lists apps asks for no master password.
 * An entry that is not a URL scheme, a scheme that runs code, and a scheme
 * listed a second time in another case are skipped.
 */
export function loadLinkSchemes(
  raw: unknown = typeof __CALINO_CONFIG__ === 'undefined' ? null : __CALINO_CONFIG__
): Record<string, string> {
  const entries = (raw as { linkSchemes?: unknown } | null)?.linkSchemes
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {}
  const schemes: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) {
    const scheme = key.trim().toLowerCase()
    const name = typeof value === 'string' ? value.trim() : ''
    if (
      !/^[a-z][a-z0-9+.-]*$/.test(scheme) ||
      UNSAFE_SCHEMES.includes(scheme) ||
      name.length === 0 ||
      name.length > MAX_NAME_LENGTH
    ) {
      console.warn('[appLinks] Skipping invalid link scheme entry', key)
      continue
    }
    if (Object.hasOwn(schemes, scheme)) {
      console.warn('[appLinks] Skipping link scheme listed twice', key)
      continue
    }
    schemes[scheme] = name
  }
  return schemes
}

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

/** The property a bare link into an app carries to the renderer. */
export const BARE_APP_LINK = 'data-bare-app-link'

function markBare(link: Link): Link {
  link.data = { ...link.data, hProperties: { ...link.data?.hProperties, [BARE_APP_LINK]: true } }
  return link
}

/**
 * GFM finds bare web addresses by itself, not those of other apps. This remark
 * plugin makes a bare `<scheme>://…` of a configured app a link. It works on
 * the parsed tree and only on plain text outside links, so code and existing
 * links are left as they are. Punctuation that ends a sentence or closes a
 * bracket is not taken into the address, and a scheme that is only the tail of
 * a longer one (`my-obsidian://`) is not matched.
 *
 * The links it makes, and autolinks `<scheme://…>` written by hand, are marked
 * with BARE_APP_LINK: their text is the address itself.
 */
export function remarkAppLinks(schemes: Readonly<Record<string, string>>) {
  const names = Object.keys(schemes)
  const alternatives = names.map((scheme) => scheme.replace(/[.+-]/g, '\\$&')).join('|')
  const bare = new RegExp(
    `(?<![a-z0-9+.-])(?:${alternatives}):\\/\\/[^\\s<>]*[^\\s<>.,;:!?)\\]]`,
    'gi'
  )

  // Text that ends inside an app address.
  const unfinished = new RegExp(`(?<![a-z0-9+.-])(?:${alternatives}):\\/\\/\\S*$`, 'i')

  const prepare = (node: Nodes): void => {
    if (node.type === 'link') {
      if (typedAddress(node) === node.url && appOf(node.url, schemes) !== undefined) markBare(node)
      return
    }
    if (!('children' in node)) return
    const children: Nodes[] = node.children
    for (let index = 0; index < children.length; index++) {
      const text = children[index]
      if (text.type !== 'text') {
        prepare(text)
        continue
      }
      // GFM links a web or mail address wherever it stands, also inside an app
      // address (`obsidian://open?url=https://…`). The app address gets back
      // what was cut from it.
      while (unfinished.test(text.value)) {
        const next = children[index + 1]
        const typed = next?.type === 'text' ? next.value : next && typedAddress(next)
        if (typed === undefined || /^\s/.test(typed)) break
        text.value += typed
        children.splice(index + 1, 1)
      }
    }
  }

  return () =>
    (tree: Root): void => {
      if (names.length === 0) return
      prepare(tree)
      findAndReplace(
        tree,
        [
          bare,
          (url: string): Link =>
            markBare({ type: 'link', url, children: [{ type: 'text', value: url }] }),
        ],
        { ignore: ['link', 'linkReference'] }
      )
    }
}

/** What was typed for a link that is an address and nothing else, or undefined. */
function typedAddress(node: Nodes): string | undefined {
  if (node.type !== 'link' || node.children.length !== 1) return undefined
  const [text] = node.children
  if (text.type !== 'text') return undefined
  const typed = text.value
  return [typed, `http://${typed}`, `mailto:${typed}`].includes(node.url) ? typed : undefined
}
