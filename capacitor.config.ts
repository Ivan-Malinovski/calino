import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

const config: CapacitorConfig = {
  appId: 'calino.malinov.ski',
  appName: 'Calino',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // Note: `enabled` monkey-patches window.fetch/XHR so cross-origin requests
    // go through the native HTTP layer (bypassing CORS — this is what lets
    // webcal/ICS subscriptions work on device). That layer cannot send WebDAV
    // verbs, so CalDAV/CardDAV opts back out via `webFetch` in
    // src/lib/webFetch.ts. See the comment there before changing this.
    CapacitorHttp: {
      enabled: true,
    },
    // `Native` resizes the WebView window itself, so `100dvh` and the
    // bottom-anchored sheets shrink with the keyboard instead of sitting
    // underneath it. `resizeOnFullScreen` is the Android-only workaround for
    // the platform bug where an edge-to-edge activity reports no inset at all.
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
  },
}

export default config
