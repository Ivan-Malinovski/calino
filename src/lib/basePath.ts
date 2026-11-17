import { normalizeBasePath, withBasePath } from '@/config/basePath'

/**
 * Deployment base without a trailing slash: "" at the site root, "/cal" when
 * the app is served from https://example.com/cal/.
 *
 * Vite replaces `import.meta.env.BASE_URL` with the configured `base` at build
 * time, so this follows `CALINO_BASE_PATH`.
 */
export function getBasePath(): string {
  return normalizeBasePath(import.meta.env.BASE_URL).replace(/\/+$/, '')
}

/**
 * Prefix an app-absolute path with the deployment base so links, fetches and
 * redirects stay inside the subpath. At the root this is a no-op.
 */
export function withBase(path: string, base = getBasePath()): string {
  return withBasePath(path, base)
}
