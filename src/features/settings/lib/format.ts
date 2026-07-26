import type { TimeFormat } from '@/types'
import { formatDateLong } from '@/lib/datetime'

/**
 * Format an ISO-8601 timestamp as a human-readable date+time string.
 * Respects the user's `timeFormat` preference (`'24h'` or `'12h'`).
 *
 * Returns the raw ISO string on parse error.
 * Used by the broken-events and data-management settings views.
 */
export function formatBrokenEventDate(iso: string, timeFormat: TimeFormat = '24h'): string {
  try {
    return formatDateLong(iso, timeFormat)
  } catch {
    return iso
  }
}
