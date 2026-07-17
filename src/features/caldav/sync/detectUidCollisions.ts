import type { CalendarEvent, DuplicateUidIssue, DuplicateUidResource } from '@/types'

/** A parsed event paired with the CalDAV resource href it came from. */
export interface ParsedWithHref {
  event: CalendarEvent
  href: string
}

export interface UidCollisionResult {
  /** One issue per colliding UID, listing every resource involved. */
  issues: DuplicateUidIssue[]
  /**
   * The "loser" entries that must NOT be written to the store — storing them
   * would overwrite the kept event and cause the flip-flop rendering.
   */
  skip: Set<ParsedWithHref>
}

/**
 * Detect independent events that illegally share a UID across distinct CalDAV
 * resources (issue #22). Data that violates RFC 5545 UID-uniqueness exists in
 * the wild (bulk copies made by other clients), and because Calino keys events
 * by UID, two such events collapse into one — the survivor changes on every
 * refresh.
 *
 * A collision is a UID whose events span **two or more distinct hrefs**.
 * Recurrence overrides (events carrying a `recurrenceId`) legitimately share a
 * UID with their master and are excluded from grouping, so the valid
 * master + RECURRENCE-ID case is never flagged.
 *
 * Resolution is deterministic: within a colliding UID we keep the entry whose
 * href sorts lexicographically first and skip the rest. A stable tiebreak means
 * the same event renders regardless of the order the server returned resources
 * in — which is what stops the unstable rendering.
 */
export function detectUidCollisions(items: ParsedWithHref[]): UidCollisionResult {
  const byUid = new Map<string, ParsedWithHref[]>()
  for (const item of items) {
    // Overrides share a UID with their master by design — never a collision.
    if (item.event.recurrenceId) continue
    const uid = item.event.id
    const group = byUid.get(uid)
    if (group) {
      group.push(item)
    } else {
      byUid.set(uid, [item])
    }
  }

  const issues: DuplicateUidIssue[] = []
  const skip = new Set<ParsedWithHref>()
  const detectedAt = new Date().toISOString()

  for (const [uid, group] of byUid) {
    const distinctHrefs = new Set(group.map((g) => g.href))
    if (distinctHrefs.size < 2) continue

    // Deterministic keep: lexicographically-smallest href wins.
    const sorted = [...group].sort((a, b) => (a.href < b.href ? -1 : a.href > b.href ? 1 : 0))
    const kept = sorted[0]

    const resources: DuplicateUidResource[] = sorted.map((entry) => ({
      title: entry.event.title,
      start: entry.event.start,
      href: entry.href,
      kept: entry === kept,
    }))

    for (const entry of items) {
      const entryUid = entry.event.uid || entry.event.id
      if (entryUid === uid && entry.href !== kept.href) skip.add(entry)
    }

    issues.push({
      uid,
      calendarId: kept.event.calendarId,
      resources,
      detectedAt,
    })
  }

  return { issues, skip }
}
