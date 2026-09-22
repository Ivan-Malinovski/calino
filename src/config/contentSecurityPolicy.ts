const BASE_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'sha256-Qh5qqVHNcx0NmWPlYwpmDet5mMrPYpSQ6hcLzJTT3ZM=' 'sha256-AQQMVAHv1tQqIVb/aeGQWZo8IWdCg5J5kzrOTtjqgCY='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
] as const

/** Build the meta CSP baked into the main HTML entry. */
export function contentSecurityPolicy(selfHosted: boolean): string {
  const connectSrc = selfHosted ? "connect-src 'self' https: http:" : "connect-src 'self' https:"
  return [...BASE_DIRECTIVES.slice(0, 3), connectSrc, ...BASE_DIRECTIVES.slice(3)].join('; ')
}
