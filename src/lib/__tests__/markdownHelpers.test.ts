import { describe, expect, it } from 'vitest'
import { wrapMarkdownSelection } from '../markdownHelpers'

describe('wrapMarkdownSelection', () => {
  it('wraps selected text and returns the selection inside the markers', () => {
    expect(wrapMarkdownSelection('hello world', 6, 11, '**')).toEqual({
      value: 'hello **world**',
      selectionStart: 8,
      selectionEnd: 13,
    })
  })

  it('inserts a placeholder when there is no selection', () => {
    expect(wrapMarkdownSelection('hello', 5, 5, '*')).toEqual({
      value: 'hello*text*',
      selectionStart: 6,
      selectionEnd: 10,
    })
  })
})
