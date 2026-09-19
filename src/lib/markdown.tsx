/**
 * Markdown renderer for journal entries, contact notes and the descriptions of
 * tasks and events.
 * Uses `react-markdown` (CommonMark + GFM) and avoids `dangerouslySetInnerHTML`.
 */

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { JSX } from 'react'

export interface MarkdownProps {
  text: string
  className?: string
}

export function MarkdownView({ text, className }: MarkdownProps): JSX.Element {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => {
            void node
            // A click on a link opens it and goes no further, so a parent that
            // starts editing or opens an item on click keeps its hands off it.
            return (
              <a
                {...props}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              />
            )
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
