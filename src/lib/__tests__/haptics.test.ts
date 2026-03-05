import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { haptic, hapticIfEnabled } from '../haptics'

describe('haptics', () => {
  let originalVibrate: Navigator['vibrate']

  beforeEach(() => {
    originalVibrate = navigator.vibrate
    vi.stubGlobal('navigator', {
      vibrate: vi.fn(),
    })
  })

  afterEach(() => {
    vi.stubGlobal('navigator', { vibrate: originalVibrate })
  })

  describe('haptic', () => {
    it('calls navigator.vibrate with light pattern', () => {
      haptic('light')
      expect(navigator.vibrate).toHaveBeenCalledWith(10)
    })

    it('calls navigator.vibrate with medium pattern', () => {
      haptic('medium')
      expect(navigator.vibrate).toHaveBeenCalledWith(25)
    })

    it('calls navigator.vibrate with heavy pattern', () => {
      haptic('heavy')
      expect(navigator.vibrate).toHaveBeenCalledWith(50)
    })

    it('calls navigator.vibrate with success pattern', () => {
      haptic('success')
      expect(navigator.vibrate).toHaveBeenCalledWith([0, 30, 50, 30])
    })

    it('calls navigator.vibrate with warning pattern', () => {
      haptic('warning')
      expect(navigator.vibrate).toHaveBeenCalledWith([0, 30, 30, 30])
    })

    it('calls navigator.vibrate with error pattern', () => {
      haptic('error')
      expect(navigator.vibrate).toHaveBeenCalledWith([0, 50, 50, 50])
    })

    it('does not throw when vibrate is not available', () => {
      vi.stubGlobal('navigator', { vibrate: undefined })
      expect(() => haptic('medium')).not.toThrow()
    })
  })

  describe('hapticIfEnabled', () => {
    it('calls vibrate on mobile user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'iPhone',
        vibrate: vi.fn(),
      })
      hapticIfEnabled('light')
      expect(navigator.vibrate).toHaveBeenCalledWith(10)
    })

    it('calls vibrate on Android user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0',
        vibrate: vi.fn(),
      })
      hapticIfEnabled('medium')
      expect(navigator.vibrate).toHaveBeenCalledWith(25)
    })

    it('does not call vibrate on desktop user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        vibrate: vi.fn(),
      })
      hapticIfEnabled('light')
      expect(navigator.vibrate).not.toHaveBeenCalled()
    })
  })
})
