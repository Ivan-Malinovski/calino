/**
 * Joins a user-supplied API root with an endpoint path.
 *
 * The base URL is taken as-is: whatever the user typed is the API root, so a
 * gateway mounted at a subpath or behind a non-standard version prefix works
 * without the app second-guessing it. The only normalization is dropping a
 * trailing slash, which would otherwise produce a double slash.
 */
export function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}
