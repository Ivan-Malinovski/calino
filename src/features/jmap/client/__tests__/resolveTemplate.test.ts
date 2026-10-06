import { describe, expect, it } from 'vitest'
import { resolveTemplate } from '../session'

describe('resolveTemplate', () => {
  it('rebases a loopback advertisement onto the origin that was reached', () => {
    expect(
      resolveTemplate('https://localhost/jmap/', 'http://192.168.1.50:8080/jmap/session')
    ).toBe('http://192.168.1.50:8080/jmap/')
  })

  it('keeps the template variables intact when rebasing', () => {
    expect(
      resolveTemplate(
        'https://localhost/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
        'http://127.0.0.1:18080/jmap/session'
      )
    ).toBe('http://127.0.0.1:18080/jmap/download/{accountId}/{blobId}/{name}?accept={type}')
  })

  it('never rebases a non-loopback advertisement', () => {
    expect(resolveTemplate('https://api.example.net/jmap/', 'https://example.org/session')).toBe(
      'https://api.example.net/jmap/'
    )
  })
})
