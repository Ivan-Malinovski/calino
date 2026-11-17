/**
 * Normalize a deployment base path for Vite. The result always starts and ends
 * with "/"; an empty value or "/" means the site root.
 *
 * Kept free of `import.meta.env` so the Vite config can import it too.
 */
export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed || trimmed === '/') return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

/**
 * Prefix an app-absolute path with a base path that has no trailing slash.
 * `withBasePath('/settings', '/cal')` → `/cal/settings`.
 */
export function withBasePath(path: string, base: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}
