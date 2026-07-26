/**
 * Deterministic avatar background color from a compact 6-color palette.
 * Used for contact initials circles in the CardDAV views.
 */
export const AVATAR_COLORS: readonly string[] = [
  '#b07d4f',
  '#5b7fb5',
  '#5d9a78',
  '#c2697f',
  '#8a6aa8',
  '#bf944e',
] as const

/**
 * Pick a stable color from {@link AVATAR_COLORS} for the given name.
 * Uses the same 31-multiplier hash as the original local helpers.
 */
export function getAvatarColor(name: string): string {
  const hash = name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

/**
 * Two-letter initials from a display name.
 * - empty/whitespace name → `'?'`
 * - single word → first character uppercased
 * - 2+ words → first char of first word + first char of last word, uppercased
 *
 * Note: this does NOT match the signature used by `AttendeeSection`, which
 * returns the first two characters of a 1-word name (so a "name fallback"
 * case). AttendeeSection keeps its local helper to preserve that behaviour.
 */
export function getInitials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}
