/**
 * Default bound for CalDAV network fan-out.
 *
 * A sync can name hundreds of changed resources, and firing every GET at once
 * buries a small self-hosted server (Radicale is single-process by default) and
 * trips browser per-host connection limits, so the requests queue anyway —
 * without a queue we control, and with every one of them counting against the
 * request timeout from the moment it was created rather than the moment it was
 * sent.
 */
export const CALDAV_FETCH_CONCURRENCY = 3

/**
 * Map `items` through `fn`, running at most `limit` calls at a time.
 *
 * Results come back in **input order** regardless of completion order: callers
 * feed these into store writes, and a sync whose event order depends on
 * network timing is a sync whose duplicate-resolution and last-write-wins
 * behaviour is non-deterministic.
 *
 * Rejection semantics match `Promise.all`: the first failure rejects, and
 * already-started work is left to settle on its own. This is used for network
 * fetches only — parsing and store writes stay serial by design.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const effectiveLimit = Math.max(1, Math.floor(limit))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(effectiveLimit, items.length) }, () => worker())
  )

  return results
}
