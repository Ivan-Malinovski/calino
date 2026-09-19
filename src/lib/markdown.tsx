/**
 * Markdown renderer for journal entries, contact notes and the descriptions of
 * tasks and events.
 * Uses `react-markdown` (CommonMark + GFM) and avoids `dangerouslySetInnerHTML`.
 */

import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { JSX } from 'react'
import { loadLinkSchemes } from './configLoader'
import { appOf, linkBareAppLinks } from './appLinks'

export interface MarkdownProps {
  text: string
  className?: string
}

/** Apps whose links open that app: scheme → name (calino.config.json). */
const LINK_SCHEMES = loadLinkSchemes()

export function MarkdownView({ text, className }: MarkdownProps): JSX.Element {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
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
            // its own keeps it.
            const bare = typeof children === 'string' && children === props.href
            // A click on a link opens it and goes no further, so a parent that
            // starts editing or opens an item on click keeps its hands off it.
            // A link into an app opens the app; a new tab for it would stay
            // behind, empty.
            return (
              <a
                {...props}
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
        {linkBareAppLinks(text, LINK_SCHEMES)}
      </Markdown>
    </div>
  )
}
