/**
 * Markdown renderer for journal entries, contact notes and the descriptions of
 * tasks and events.
 * Uses `react-markdown` (CommonMark + GFM) and avoids `dangerouslySetInnerHTML`.
 */

import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { JSX } from 'react'
import { BARE_APP_LINK, appOf, loadLinkSchemes, remarkAppLinks } from './appLinks'

export interface MarkdownProps {
  text: string
  className?: string
}

/** Apps whose links open that app: scheme → name (calino.config.json). */
const LINK_SCHEMES = loadLinkSchemes()

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks(LINK_SCHEMES)]

export function MarkdownView({ text, className }: MarkdownProps): JSX.Element {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        // react-markdown drops every scheme outside its safe list; the apps
        // configured for this build are let through beside them.
        urlTransform={(url) =>
          appOf(url, LINK_SCHEMES) !== undefined ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ node, children, ...props }) => {
            void node
            const app = appOf(props.href, LINK_SCHEMES)
            // A bare link into an app is an address that says little to the
            // reader, so it is shown by the app's name; a link with text of
            // its own keeps it. remarkAppLinks marks the bare ones.
            const { [BARE_APP_LINK]: bare, ...anchor } = props as typeof props & {
              [BARE_APP_LINK]?: unknown
            }
            // A click on a link opens it and goes no further, so a parent that
            // starts editing or opens an item on click keeps its hands off it.
            // A link into an app opens the app; a new tab for it would stay
            // behind, empty.
            return (
              <a
                {...anchor}
                target={app === undefined ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {app !== undefined && bare ? `${app} ↗` : children}
              </a>
            )
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
