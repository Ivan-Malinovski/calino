/**
 * Units and limits shared by the reminder pickers that accept custom values:
 * the event form's "+ Add" dropdown and the Settings → Calendar "Default
 * Reminder" row.
 *
 * Reminders are stored (and round-tripped to CalDAV) as whole minutes before
 * the event, so every custom value collapses to minutes; the units here only
 * shape the input and its label.
 */

export const REMINDER_UNITS = [
  { id: 'minutes', factor: 1 },
  { id: 'hours', factor: 60 },
  { id: 'days', factor: 1440 },
  { id: 'weeks', factor: 10080 },
] as const

export type ReminderUnit = (typeof REMINDER_UNITS)[number]['id']

/** Hard ceiling: 4 weeks — the largest offset that still round-trips as `-P4W`. */
export const MAX_REMINDER_MINUTES = 4 * 10080

/**
 * Convert a custom-input value+unit into stored minutes, or `null` when the
 * input is not a whole number in range. `null` means "keep the Add/save
 * control disabled", never "treat as zero".
 */
export function parseReminderInput(value: string | number, unit: ReminderUnit): number | null {
  // `Number('')` is 0, which would read an untouched input as "at time of
  // event" — an empty string is invalid, not zero.
  if (typeof value === 'string' && value.trim() === '') return null
  const raw = typeof value === 'string' ? Number(value) : value
  if (!Number.isInteger(raw) || raw < 0 || raw > MAX_REMINDER_MINUTES) return null
  const minutes = raw * (REMINDER_UNITS.find((u) => u.id === unit)?.factor ?? 1)
  if (minutes > MAX_REMINDER_MINUTES) return null
  return minutes
}

/**
 * Decompose stored minutes for display in a custom input: the largest unit
 * that divides evenly, falling back to plain minutes (e.g. 240 → "4 hours",
 * 90 → "90 minutes"). Zero stays in minutes — "0 weeks" is unreadable.
 */
export function splitReminderMinutes(minutes: number): { value: number; unit: ReminderUnit } {
  if (minutes === 0) return { value: 0, unit: 'minutes' }
  for (const { id, factor } of [...REMINDER_UNITS].reverse()) {
    if (minutes % factor === 0) return { value: minutes / factor, unit: id }
  }
  return { value: minutes, unit: 'minutes' }
}
