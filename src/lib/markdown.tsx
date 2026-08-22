/**
 * Markdown renderer for journal entries.
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
            return <a {...props} target="_blank" rel="noopener noreferrer" />
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
