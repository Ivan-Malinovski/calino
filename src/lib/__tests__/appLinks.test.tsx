import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { appOf, loadLinkSchemes, remarkAppLinks } from '../appLinks'

const schemes = { anytype: 'Anytype', obsidian: 'Obsidian' }

function html(text: string, configured: Record<string, string> = schemes): string {
  return renderToStaticMarkup(
    <Markdown remarkPlugins={[remarkGfm, remarkAppLinks(configured)]} urlTransform={(url) => url}>
      {text}
    </Markdown>
  )
}

const link = (url: string, text = url): string =>
  `<a href="${url}" data-bare-app-link="true">${text}</a>`

describe('remarkAppLinks', () => {
  it('makes a bare app link a link', () => {
    expect(html('Deadline anytype://object?id=a')).toBe(
      `<p>Deadline ${link('anytype://object?id=a')}</p>`
    )
  })

  it('leaves closing punctuation outside the link', () => {
    expect(html('Open obsidian://open?vault=v.')).toBe(
      `<p>Open ${link('obsidian://open?vault=v')}.</p>`
    )
    expect(html('(see anytype://x)')).toBe(`<p>(see ${link('anytype://x')})</p>`)
  })

  it('links inside emphasis without taking the markers', () => {
    expect(html('**obsidian://open?vault=v**')).toBe(
      `<p><strong>${link('obsidian://open?vault=v')}</strong></p>`
    )
  })

  it('leaves code alone', () => {
    expect(html('`obsidian://open?vault=X`')).toBe('<p><code>obsidian://open?vault=X</code></p>')
    expect(html('```\nobsidian://code\n```')).toBe('<pre><code>obsidian://code\n</code></pre>')
  })

  it('leaves the text of another link alone', () => {
    expect(html('[see obsidian://x](https://foo.example)')).toBe(
      '<p><a href="https://foo.example">see obsidian://x</a></p>'
    )
    expect(html('[note](obsidian://x)')).toBe('<p><a href="obsidian://x">note</a></p>')
  })

  it('does not match a scheme that is the tail of a longer one', () => {
    for (const text of ['my-obsidian://x', 'foo.obsidian://x', 'a+obsidian://x', 'xanytype://y']) {
      expect(html(text)).toBe(`<p>${text}</p>`)
    }
  })

  it('leaves other schemes alone', () => {
    expect(html('tg://resolve?domain=x')).toBe('<p>tg://resolve?domain=x</p>')
    expect(html('anytype://x', {})).toBe('<p>anytype://x</p>')
  })

  it('keeps a web or mail address inside an app address', () => {
    for (const address of [
      'obsidian://open?url=https://foo.example/a',
      'obsidian://open?u=www.foo.example&x=1',
      'obsidian://open?mail=a@b.example&x=1',
    ]) {
      expect(html(`See ${address} and https://foo.example`)).toBe(
        `<p>See ${link(address.replaceAll('&', '&amp;'))} and <a href="https://foo.example">https://foo.example</a></p>`
      )
    }
  })

  it('marks an autolink written by hand', () => {
    expect(html('<anytype://x>')).toBe(`<p>${link('anytype://x')}</p>`)
  })
})

describe('MarkdownView', () => {
  it('shows a bare app link by the app name, whatever its address needs encoded', async () => {
    vi.stubGlobal('__CALINO_CONFIG__', { linkSchemes: { obsidian: 'Obsidian' } })
    const { MarkdownView } = await import('../markdown')
    const address = 'obsidian://open?vault=%D0%97%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8'

    expect(renderToStaticMarkup(<MarkdownView text="obsidian://open?vault=Заметки" />)).toBe(
      `<div><p><a href="${address}" rel="noopener noreferrer">Obsidian ↗</a></p></div>`
    )
    expect(renderToStaticMarkup(<MarkdownView text="<obsidian://open?vault=Заметки>" />)).toBe(
      `<div><p><a href="${address}" rel="noopener noreferrer">Obsidian ↗</a></p></div>`
    )
    expect(renderToStaticMarkup(<MarkdownView text="[Plan](obsidian://x)" />)).toBe(
      '<div><p><a href="obsidian://x" rel="noopener noreferrer">Plan</a></p></div>'
    )
    vi.unstubAllGlobals()
  })
})

describe('appOf', () => {
  it('names the configured app of a link, whatever the case of its scheme', () => {
    expect(appOf('Anytype://x', schemes)).toBe('Anytype')
    expect(appOf('https://x.org', schemes)).toBeUndefined()
    expect(appOf(undefined, schemes)).toBeUndefined()
    expect(appOf('constructor://x', schemes)).toBeUndefined()
  })
})

describe('loadLinkSchemes', () => {
  it('reads scheme → name, lower-casing the scheme', () => {
    expect(loadLinkSchemes({ linkSchemes: { Obsidian: 'Obsidian', tg: ' Telegram ' } })).toEqual({
      obsidian: 'Obsidian',
      tg: 'Telegram',
    })
  })

  it('skips schemes that run code, names that are not schemes and empty names', () => {
    expect(
      loadLinkSchemes({
        linkSchemes: { javascript: 'x', data: 'x', '1abc': 'x', 'a b': 'x', ok: '', fine: 'Fine' },
      })
    ).toEqual({ fine: 'Fine' })
  })

  it('keeps the first of two keys that differ only in case', () => {
    expect(loadLinkSchemes({ linkSchemes: { Obsidian: 'First', obsidian: 'Second' } })).toEqual({
      obsidian: 'First',
    })
  })

  it('needs no accounts and tolerates a missing or malformed field', () => {
    expect(loadLinkSchemes(null)).toEqual({})
    expect(loadLinkSchemes({ version: 1 })).toEqual({})
    expect(loadLinkSchemes({ linkSchemes: ['obsidian'] })).toEqual({})
  })
})
