import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showNotification } from '../notifications'

describe('browser notifications', () => {
  const instances: Array<{ title: string; options: Record<string, unknown> }> = []

  class MockNotification {
    static permission = 'granted'
    onclick: (() => void) | null = null

    constructor(title: string, options: Record<string, unknown>) {
      instances.push({ title, options })
    }

    close(): void {}
  }

  beforeEach(() => {
    instances.length = 0
    vi.stubGlobal('Notification', MockNotification)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the packaged app icon for browser reminders', () => {
    showNotification('Event', 'Starts soon', 'event-1', '2026-08-29T10:00:00.000Z')

    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
    })
  })
})
