import type {
  PendingChange,
  MovePendingData,
  DeleteHrefPendingData,
} from '../types'
import type { CalendarEvent } from '@/types'

/**
 * Event ids that a full sync must not overwrite from server state, because a
 * local change for them hasn't reached the server yet.
 *
 * A `PendingChange.eventId` names only the master. For a move that isn't
 * enough: the whole recurrence group was rewritten, and a `delete-href` cleanup
 * still has the stale copy sitting in the source collection. Until that cleanup
 * lands, a sync would find the leftover and happily restore the event into its
 * old calendar — the very revert #86 is about. So every member of a move is
 * guarded, not just the id the change is filed under.
 */
export function pendingGuardedEventIds(changes: PendingChange[]): Set<string> {
  const ids = new Set<string>()

  for (const change of changes) {
    if (change.eventId) ids.add(change.eventId)
    if (!change.data) continue

    try {
      if (change.type === 'move') {
        const parsed = JSON.parse(change.data) as MovePendingData
        for (const event of parsed.events ?? []) {
          const id = (event as CalendarEvent | undefined)?.id
          if (id) ids.add(id)
        }
      } else if (change.type === 'delete-href') {
        const parsed = JSON.parse(change.data) as DeleteHrefPendingData
        for (const id of parsed.memberIds ?? []) ids.add(id)
      }
    } catch {
      // A malformed payload must not break the sync — the master id is already
      // guarded above, which is the pre-existing level of protection.
    }
  }

  return ids
}
