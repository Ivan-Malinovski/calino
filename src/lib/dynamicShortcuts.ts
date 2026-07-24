import { Capacitor, registerPlugin } from '@capacitor/core'

interface DynamicShortcutsPlugin {
  setAiPhotoImportEnabled(options: { enabled: boolean }): Promise<void>
}

const DynamicShortcuts = registerPlugin<DynamicShortcutsPlugin>('DynamicShortcuts')

/**
 * Shows or hides the "Photo import" home-screen shortcut (long-press the app
 * icon) to match whether AI photo import is actually configured — pointless
 * to surface a shortcut for a feature the user hasn't set up. Backed by
 * DynamicShortcutsPlugin.java; native-only, silently a no-op on web.
 */
export function syncAiPhotoImportShortcut(enabled: boolean): void {
  if (!Capacitor.isNativePlatform()) return
  void DynamicShortcuts.setAiPhotoImportEnabled({ enabled }).catch(() => {})
}
