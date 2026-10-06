import { describe, expect, it } from 'vitest'
import { SseParser, type SseEvent } from '../sse'

describe('SSE parser', () => {
  it('handles BOM, comments, mixed line endings, chunk boundaries, multiline data and ids', () => {
    const events: SseEvent[] = []
    const parser = new SseParser((event) => events.push(event))
    parser.feed('\uFEFF: comment\r')
    parser.feed('\nevent: state\r\nid: 42\r\ndata: {"a":\r')
    parser.feed('\ndata: 1}\r\n\r')
    parser.feed('\nevent: ping\ndata: {}\n\n')
    expect(events).toEqual([
      { event: 'state', data: '{"a":\n1}', id: '42' },
      { event: 'ping', data: '{}', id: '42' },
    ])
  })

  it('supports retry, empty id, default message and ignores unknown fields/invalid id', () => {
    const events: SseEvent[] = []
    const retries: number[] = []
    const parser = new SseParser(
      (event) => events.push(event),
      (value) => retries.push(value)
    )
    parser.feed(
      'retry: 1500\nretry: bogus\nid: ok\nid: bad\0id\nunknown: ignored\ndata\n\nid:\ndata: hi\n\n'
    )
    expect(retries).toEqual([1500])
    expect(events).toEqual([
      { event: 'message', data: '', id: 'ok' },
      { event: 'message', data: 'hi', id: '' },
    ])
  })

  it('does not dispatch events until their blank line arrives', () => {
    const events: SseEvent[] = []
    const parser = new SseParser((event) => events.push(event))
    parser.feed('event: state\ndata: partial\n')
    expect(events).toEqual([])
    parser.feed('\n')
    expect(events).toHaveLength(1)
  })
})
