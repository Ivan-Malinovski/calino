import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { Haptics } from '@capacitor/haptics'
import { haptic, hapticIfEnabled } from '../haptics'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn() },
}))

vi.mock('@capacitor/haptics', () => ({
  Haptics: { vibrate: vi.fn(), notification: vi.fn() },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}))

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
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('calls Haptics.vibrate with a short duration on native platform for impact types', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
      hapticIfEnabled('medium')
      expect(Haptics.vibrate).toHaveBeenCalledWith({ duration: 13 })
    })

    it('calls Haptics.notification on native platform for notification types', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
      hapticIfEnabled('success')
      expect(Haptics.notification).toHaveBeenCalledWith({ type: 'SUCCESS' })
    })

    it('does not call Haptics or vibrate off native platform', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false)
      hapticIfEnabled('light')
      expect(Haptics.vibrate).not.toHaveBeenCalled()
      expect(navigator.vibrate).not.toHaveBeenCalled()
    })
  })
})
