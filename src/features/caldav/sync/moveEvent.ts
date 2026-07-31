import type { CalendarEvent } from '@/types'
import type { SyncEngine } from './syncEngine'

/**
 * Moving an event between CalDAV collections.
 *
 * CalDAV has no usable atomic move for our purposes, so a move is "write to the
 * destination, then delete the source". `SyncEngine` is bound to a single client
 * and calendar, so orchestration lives here rather than inside it — a
 * cross-account move needs one engine per side.
 */

export interface MoveContext {
  /** Engine bound to the calendar the event is moving TO. */
  targetEngine: SyncEngine
  /** Engine bound to the calendar it is moving FROM; null when the source is local-only. */
  sourceEngine: SyncEngine | null
  /** The resource to remove once the destination write succeeds. */
  sourceHref?: string
  sourceEtag?: string
}

export interface MoveResult {
  /** Href of the newly written resource in the destination collection. */
  url: string
  etag: string
  /**
   * False when the destination write succeeded but the source resource is still
   * there. The caller MUST queue a cleanup delete — otherwise the next sync
   * pulls the leftover back and the event appears in two calendars.
   */
  sourceDeleted: boolean
  /** Ids of every event written as part of this move (master + any overrides). */
  memberIds: string[]
}

/** Thrown when the source was deleted but the destination write then failed. */
export class MoveLostSourceError extends Error {
  readonly events: CalendarEvent[]
  constructor(events: CalendarEvent[], cause: unknown) {
    super(`Move lost its source resource: ${cause instanceof Error ? cause.message : cause}`)
    this.name = 'MoveLostSourceError'
    this.events = events
  }
}

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: number; statusCode?: number } | undefined)?.status
  const statusCode = (err as { statusCode?: number } | undefined)?.statusCode
  if (typeof status === 'number') return status
  if (typeof statusCode === 'number') return statusCode
  const match = /\b(\d{3})\b/.exec(err instanceof Error ? err.message : String(err ?? ''))
  return match ? Number(match[1]) : undefined
}

/** The source is already gone — for cleanup purposes that counts as success. */
function isAlreadyGone(err: unknown): boolean {
  const status = statusOf(err)
  return status === 404 || status === 410
}

/** Server refuses a second copy of this UID while the first still exists. */
function isUidConflict(err: unknown): boolean {
  const status = statusOf(err)
  return status === 403 || status === 409
}

/**
 * Move an event or an entire recurrence group to another collection.
 *
 * Order matters and is not negotiable: the destination is written FIRST. If that
 * fails the source is untouched, so a duplicate is impossible and the caller can
 * simply retry the whole move. Only once the destination is safe do we remove
 * the source, and a failure there is reported rather than thrown — losing the
 * cleanup is recoverable, losing the event is not.
 */
export async function moveEventGroup(
  events: CalendarEvent[],
  ctx: MoveContext
): Promise<MoveResult> {
  const memberIds = events.map((e) => e.id)

  let written: { url: string; etag: string }
  try {
    written = await ctx.targetEngine.putEventGroup(events)
  } catch (err) {
    // Some servers (iCloud, Google) reject a second resource with the same UID
    // while the original still exists. The only way through is to remove the
    // source first, which means a failure after this point loses the event —
    // hence the distinct error type so the caller re-creates rather than
    // re-moves.
    if (!isUidConflict(err) || !ctx.sourceEngine || !ctx.sourceHref) throw err

    await ctx.sourceEngine.deleteEvent(ctx.sourceHref, ctx.sourceEtag ?? '')
    try {
      written = await ctx.targetEngine.putEventGroup(events)
    } catch (retryErr) {
      throw new MoveLostSourceError(events, retryErr)
    }
    return { ...written, sourceDeleted: true, memberIds }
  }

  // Nothing to clean up: the event had no CalDAV resource to begin with.
  // `sourceDeleted` means "no source resource remains", so this is true.
  if (!ctx.sourceEngine || !ctx.sourceHref) {
    return { ...written, sourceDeleted: true, memberIds }
  }

  try {
    await ctx.sourceEngine.deleteEvent(ctx.sourceHref, ctx.sourceEtag ?? '')
    return { ...written, sourceDeleted: true, memberIds }
  } catch (err) {
    if (isAlreadyGone(err)) return { ...written, sourceDeleted: true, memberIds }
    // Never throw once the destination write has landed.
    return { ...written, sourceDeleted: false, memberIds }
  }
}
