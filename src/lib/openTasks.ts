import { nextOpenOccurrence, materializeOccurrence } from '@/lib/occurrenceExpansion'
import type { CalendarEvent } from '@/types'

/**
 * Replaces each recurring task master in a raw store event list with its next
 * open occurrence, and drops cancelled tasks. Non-task events pass through.
 *
 * R2.7 — Raw store events carry a recurring task as a single master sitting on
 * its anchor date. Shown as-is it would be stuck at the series' first date
 * forever, and ticking it would run `completeTask` on the master, completing the
 * WHOLE series rather than one occurrence. Substituting the next open
 * occurrence, as the Tasks list does, fixes both; `occurrenceMasterId` then
 * routes a toggle to the override path.
 */
export function resolveRecurringTasks(events: CalendarEvent[]): CalendarEvent[] {
  const overridesByMaster = new Map<string, Map<string, CalendarEvent>>()
  for (const e of events) {
    if (e.type !== 'task' || !e.recurrenceId) continue
    const key = e.recurrenceMasterId || e.uid || ''
    const group = overridesByMaster.get(key) ?? new Map<string, CalendarEvent>()
    group.set(e.recurrenceId, e)
    overridesByMaster.set(key, group)
  }
  return events.flatMap((e): CalendarEvent[] => {
    if (e.type !== 'task') return [e]
    // A cancelled override exists only to suppress one occurrence.
    if (e.taskStatus === 'CANCELLED') return []
    if (e.recurrenceId || !(e.rruleString || e.recurrence)) return [e]
    const next = nextOpenOccurrence(
      e,
      overridesByMaster.get(e.id) ?? overridesByMaster.get(e.uid || '') ?? new Map()
    )
    return next ? [materializeOccurrence(e, next)] : []
  })
}
