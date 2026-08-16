/// <reference types="vite/client" />

declare module '@touch4it/ical-timezones/zones.js' {
  const zones: Record<string, string>
  export default zones
}

declare const __APP_VERSION__: string
declare const __CALINO_SELF_HOSTED__: boolean

interface ImportMetaEnv {
  readonly CALINO_GITHUB_REPO?: string
  readonly CALINO_CONTACT_EMAIL?: string
  readonly CALINO_ENABLE_SW?: string
}
