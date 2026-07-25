import type { CapacitorConfig } from '@capacitor/cli'

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
  },
}

export default config
