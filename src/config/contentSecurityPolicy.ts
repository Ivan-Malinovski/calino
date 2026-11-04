const BASE_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'sha256-Qh5qqVHNcx0NmWPlYwpmDet5mMrPYpSQ6hcLzJTT3ZM=' 'sha256-AQQMVAHv1tQqIVb/aeGQWZo8IWdCg5J5kzrOTtjqgCY='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
] as const

/**
 * Build the meta CSP baked into the main HTML entry. `extraConnectSources` is
 * for the dev server only (its HMR socket); builds pass nothing.
 */
export function contentSecurityPolicy(
  selfHosted: boolean,
  extraConnectSources: readonly string[] = []
): string {
  const connectSrc = [
    "connect-src 'self' https:",
    ...(selfHosted ? ['http:'] : []),
    ...extraConnectSources,
  ].join(' ')
  return [...BASE_DIRECTIVES.slice(0, 3), connectSrc, ...BASE_DIRECTIVES.slice(3)].join('; ')
}
