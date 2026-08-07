import type { SyncErrorCode } from './errorMessages'

/**
 * Connection failure carrying the probe's provider-specific guidance, so the
 * UI can render the hint alongside the message without re-deriving it.
 *
 * Lives apart from the hook that throws it: consumers that mock `useCalDAV`
 * still need the real class for `instanceof` to work.
 *
 * The `hint` field is declared explicitly rather than as a parameter property
 * (`constructor(..., public readonly hint?: string)`) because the project's
 * tsconfig sets `erasableSyntaxOnly`, which bans parameter-property syntax
 * (TS1294). The runtime shape is unchanged.
 */
export class CalDAVConnectionError extends Error {
  readonly hint?: string
  /**
   * Set when the thrower already knows the category, so the UI classifies by
   * value instead of matching substrings against the message. Optional: most
   * failures still arrive as a plain `Error` from `fetch` or the sync engine,
   * and `classifySyncError` remains the fallback for those.
   */
  readonly code?: SyncErrorCode

  constructor(message: string, hint?: string, code?: SyncErrorCode) {
    super(message)
    this.name = 'CalDAVConnectionError'
    this.hint = hint
    this.code = code
  }
}
