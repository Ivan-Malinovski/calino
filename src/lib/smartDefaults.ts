// Smart-defaults learning: derive a stable keyword from an event title and
// aggregate observed durations / calendars per keyword so that repeated event
// types (e.g. "Gym", "Standup", "Lunch") can pre-fill the calendar and length
// the user usually picks.

export interface KeywordStat {
  count: number
  /** durationMinutes → number of times observed */
  durations: Record<number, number>
  /** calendarId → number of times observed */
  calendars: Record<string, number>
}

export interface SmartSuggestion {
  durationMinutes?: number
  calendarId?: string
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'my',
  'our',
  'and',
  'with',
  'for',
  'to',
  'of',
  'at',
  'on',
  'in',
  'new',
])

/**
 * Reduce a title to a single learning key: the first meaningful word,
 * lowercased and stripped of punctuation. Returns null when there's nothing
 * usable to learn from.
 */
export function keywordFromTitle(title: string): string | null {
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

  for (const word of words) {
    if (word.length >= 3 && !STOP_WORDS.has(word)) return word
  }
  // Fall back to the first token if nothing "meaningful" was found.
  return words[0] ?? null
}

function mostFrequent(counts: Record<string, number>): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

/** Merge a new observation into an existing (or empty) keyword stat. */
export function recordObservation(
  stat: KeywordStat | undefined,
  durationMinutes: number | undefined,
  calendarId: string
): KeywordStat {
  const next: KeywordStat = stat
    ? { count: stat.count, durations: { ...stat.durations }, calendars: { ...stat.calendars } }
    : { count: 0, durations: {}, calendars: {} }

  next.count += 1
  if (durationMinutes !== undefined && durationMinutes > 0) {
    next.durations[durationMinutes] = (next.durations[durationMinutes] ?? 0) + 1
  }
  next.calendars[calendarId] = (next.calendars[calendarId] ?? 0) + 1
  return next
}

/**
 * Produce a suggestion from a keyword stat. Requires at least two observations
 * before suggesting anything, so a single one-off event doesn't start steering
 * defaults.
 */
export function suggestFromStat(stat: KeywordStat | undefined): SmartSuggestion {
  if (!stat || stat.count < 2) return {}

  const suggestion: SmartSuggestion = {}

  const bestDuration = mostFrequent(
    Object.fromEntries(Object.entries(stat.durations).map(([k, v]) => [k, v]))
  )
  if (bestDuration !== null) {
    const minutes = Number(bestDuration)
    if (Number.isFinite(minutes) && minutes > 0) suggestion.durationMinutes = minutes
  }

  const bestCalendar = mostFrequent(stat.calendars)
  if (bestCalendar) suggestion.calendarId = bestCalendar

  return suggestion
}
