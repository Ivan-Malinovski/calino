import { Capacitor } from '@capacitor/core'
import { Haptics, NotificationType } from '@capacitor/haptics'
import { useSettingsStore } from '@/store/settingsStore'

export type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

const HAPTIC_PATTERNS: Record<HapticType, number | number[]> = {
  light: 1,
  medium: 3,
  heavy: 5,
  success: [0, 3, 5, 3],
  warning: [0, 3, 3, 3],
  error: [0, 5, 5, 5],
}

// Native duration for the impact-style types, matching the web vibrate
// durations above. Haptics.impact()'s predefined OS effects (even at
// ImpactStyle.Light) felt far more intense than the equivalent web
// navigator.vibrate() call, so we use duration-controlled vibrate() instead.
const VIBRATE_DURATIONS: Record<'light' | 'medium' | 'heavy', number> = {
  light: 1,
  medium: 2,
  heavy: 3,
}

const NOTIFICATION_TYPES: Record<'success' | 'warning' | 'error', NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
}

export function haptic(type: HapticType): void {
  if (!('vibrate' in navigator) || typeof navigator.vibrate !== 'function') return
  navigator.vibrate(HAPTIC_PATTERNS[type])
}

export function hapticIfEnabled(type: HapticType): void {
  if (!Capacitor.isNativePlatform()) return
  // Read at call time rather than subscribing: this is called from event
  // handlers and gesture callbacks, not from render.
  if (!useSettingsStore.getState().enableHaptics) return

  // On Android, bridge calls to the Haptics plugin can get severely queued up
  // (5-10 second delays) when the main thread is busy (e.g. during gestures).
  // The web navigator.vibrate API is handled directly by the WebView without
  // hitting the Capacitor bridge, resulting in zero latency.
  if (Capacitor.getPlatform() === 'android') {
    if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(HAPTIC_PATTERNS[type])
    }
    return
  }

  if (type === 'success' || type === 'warning' || type === 'error') {
    void Haptics.notification({ type: NOTIFICATION_TYPES[type] })
  } else {
    void Haptics.vibrate({ duration: VIBRATE_DURATIONS[type] })
  }
}
