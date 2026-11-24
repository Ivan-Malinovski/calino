import { nextOpenOccurrence, materializeOccurrence } from '@/lib/occurrenceExpansion'
import type { CalendarEvent } from '@/types'

export function indexTaskOverrides(events: CalendarEvent[]) {
  const overridesByMaster = new Map<string, Map<string, CalendarEvent>>()
  for (const event of events) {
    if (event.type !== 'task' || !event.recurrenceId) continue
    const key = event.recurrenceMasterId || event.uid || ''
    const group = overridesByMaster.get(key) ?? new Map<string, CalendarEvent>()
    group.set(event.recurrenceId, event)
    overridesByMaster.set(key, group)
  }
  return overridesByMaster
}

export function taskOverridesFor(task: CalendarEvent, index: ReturnType<typeof indexTaskOverrides>) {
  return index.get(task.id) ?? index.get(task.uid || '') ?? new Map<string, CalendarEvent>()
}

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
  const overridesByMaster = indexTaskOverrides(events)
  return events.flatMap((e): CalendarEvent[] => {
    if (e.type !== 'task') return [e]
    // A cancelled override exists only to suppress one occurrence.
    if (e.taskStatus === 'CANCELLED') return []
    if (e.recurrenceId || !(e.rruleString || e.recurrence)) return [e]
    const next = nextOpenOccurrence(e, taskOverridesFor(e, overridesByMaster))
    return next ? [materializeOccurrence(e, next)] : []
  })
}
