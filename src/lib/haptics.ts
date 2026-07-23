import { Capacitor } from '@capacitor/core'
import { Haptics, NotificationType } from '@capacitor/haptics'

export type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

const HAPTIC_PATTERNS: Record<HapticType, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  success: [0, 30, 50, 30],
  warning: [0, 30, 30, 30],
  error: [0, 50, 50, 50],
}

// Native duration for the impact-style types, matching the web vibrate
// durations above. Haptics.impact()'s predefined OS effects (even at
// ImpactStyle.Light) felt far more intense than the equivalent web
// navigator.vibrate() call, so we use duration-controlled vibrate() instead.
const VIBRATE_DURATIONS: Record<'light' | 'medium' | 'heavy', number> = {
  light: 5,
  medium: 13,
  heavy: 25,
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

  if (type === 'success' || type === 'warning' || type === 'error') {
    void Haptics.notification({ type: NOTIFICATION_TYPES[type] })
  } else {
    void Haptics.vibrate({ duration: VIBRATE_DURATIONS[type] })
  }
}
