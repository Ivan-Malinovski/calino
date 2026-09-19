import { describe, it, expect } from 'vitest'
import { appOf, linkBareAppLinks } from '../appLinks'

const schemes = { anytype: 'Anytype', obsidian: 'Obsidian' }

describe('linkBareAppLinks', () => {
  it('makes a bare app link an autolink', () => {
    expect(linkBareAppLinks('Deadline\nanytype://object?id=a&space=b', schemes)).toBe(
      'Deadline\n<anytype://object?id=a&space=b>'
    )
  })

  it('leaves closing punctuation outside the link', () => {
    expect(linkBareAppLinks('Open obsidian://open?vault=v.', schemes)).toBe(
      'Open <obsidian://open?vault=v>.'
    )
    expect(linkBareAppLinks('(see anytype://x)', schemes)).toBe('(see <anytype://x>)')
  })

  it('leaves autolinks, markdown links and other schemes alone', () => {
    expect(linkBareAppLinks('<anytype://x>', schemes)).toBe('<anytype://x>')
    expect(linkBareAppLinks('[note](obsidian://x)', schemes)).toBe('[note](obsidian://x)')
    expect(linkBareAppLinks('tg://resolve?domain=x', schemes)).toBe('tg://resolve?domain=x')
    expect(linkBareAppLinks('xanytype://y', schemes)).toBe('xanytype://y')
  })

  it('changes nothing when no app is configured', () => {
    expect(linkBareAppLinks('anytype://x', {})).toBe('anytype://x')
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
