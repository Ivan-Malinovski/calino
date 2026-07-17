/**
 * Recurring occurrences are encoded as `${masterId}-${occurrence}` so a single
 * `id` resolves to the master through `findEventById` everywhere. The suffix
 * shape depends on the event type:
 *   - timed:  `master-2024-03-15T10:00:00.000Z`  (full ISO timestamp, see
 *             `calendarStore.ts` recurrence expansion).
 *   - all-day: `master-2024-03-15`               (date-only, no time component
 *             because the rrule expansion is computed in whole-day terms to
 *             stay immune to DST shifts).
 *
 * Try the more specific timestamp form first; fall back to the date-only form
 * so all-day occurrences (e.g. clicking a recurring all-day card in month view)
 * resolve back to the master too. The fallback to the date form is safe because
 * `findEventById` only returns the master if the extracted prefix is itself a
 * known event id — a spurious prefix just yields `undefined`, same as before.
 */
export function extractOriginalEventId(eventId: string): string | null {
  const isoTimestampMatch = eventId.match(
    /(.+)-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)$/
  )
  if (isoTimestampMatch) {
    return isoTimestampMatch[1]
  }
  const dateOnlyMatch = eventId.match(/(.+)-(\d{4}-\d{2}-\d{2})$/)
  return dateOnlyMatch ? dateOnlyMatch[1] : null
}

/**
 * Resolves an event by id, falling back to its recurrence-master id when the id
 * refers to a generated recurring instance (see {@link extractOriginalEventId}).
 * Centralizes the `find(id) ?? find(originalId)` pattern used across the app.
 *
 * Pass a precomputed `Map` (from {@link buildEventIndex}) to avoid O(n) scans in
 * hot paths; otherwise an array is scanned directly.
 */
export function findEventById<T extends { id: string }>(
  events: readonly T[] | ReadonlyMap<string, T>,
  id: string | null | undefined
): T | undefined {
  if (!id) return undefined
  const originalId = extractOriginalEventId(id)
  if (events instanceof Map) {
    return events.get(id) ?? (originalId !== null ? events.get(originalId) : undefined)
  }
  const arr = events as readonly T[]
  return (
    arr.find((e) => e.id === id) ??
    (originalId !== null ? arr.find((e) => e.id === originalId) : undefined)
  )
}

/** Builds an id → event Map for O(1) lookups via {@link findEventById}. */
export function buildEventIndex<T extends { id: string }>(events: readonly T[]): Map<string, T> {
  const index = new Map<string, T>()
  for (const event of events) index.set(event.id, event)
  return index
}

export function hasDueTime(event: { dueDate?: string | null; isAllDay?: boolean }): boolean {
  if (!event.dueDate) return false
  if (event.isAllDay) return false
  if (!event.dueDate.includes('T')) return false
  const timePart = event.dueDate.split('T')[1]
  if (!timePart) return false
  const normalizedTime = timePart.split('.')[0]
  return normalizedTime !== '00:00:00' && normalizedTime !== '00:00'
}

export function formatTravelDuration(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (mins > 0) {
      return `${hours}h ${mins}m`
    }
    return `${hours}h`
  }
  return `${minutes} min`
}
