export interface SseEvent {
  event: string
  data: string
  id?: string
}

/** Incremental SSE framing, including CR/LF split across chunks and multiline data. */
export class SseParser {
  private buffer = ''
  private data: string[] = []
  private event = ''
  private id: string | undefined
  private first = true
  private onEvent: (event: SseEvent) => void
  private onRetry?: (milliseconds: number) => void

  constructor(onEvent: (event: SseEvent) => void, onRetry?: (milliseconds: number) => void) {
    this.onEvent = onEvent
    this.onRetry = onRetry
  }

  feed(chunk: string): void {
    if (this.first && chunk.length) {
      chunk = chunk.replace(/^\uFEFF/, '')
      this.first = false
    }
    this.buffer += chunk
    while (true) {
      const index = this.buffer.search(/[\r\n]/)
      if (index < 0 || (this.buffer[index] === '\r' && index === this.buffer.length - 1)) return
      const line = this.buffer.slice(0, index)
      const length = this.buffer[index] === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1
      this.buffer = this.buffer.slice(index + length)
      this.line(line)
    }
  }

  private line(line: string): void {
    if (!line) {
      if (this.data.length)
        this.onEvent({ event: this.event || 'message', data: this.data.join('\n'), id: this.id })
      this.data = []
      this.event = ''
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'data') this.data.push(value)
    else if (field === 'event') this.event = value
    else if (field === 'id' && !value.includes('\0')) this.id = value
    else if (field === 'retry' && /^\d+$/.test(value))
      this.onRetry?.(Math.min(Number(value), 60000))
  }
}
