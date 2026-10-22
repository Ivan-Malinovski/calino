import { useCallback, useState } from 'react'

/** Measurements stay local to the rendered timeline; nothing is persisted or synced. */
export function useEventContentHeights() {
  const [contentHeights, setContentHeights] = useState<ReadonlyMap<string, number>>(() => new Map())
  const reportContentHeight = useCallback((id: string, height: number) => {
    if (!(height > 0) || !Number.isFinite(height)) return
    setContentHeights((previous) =>
      previous.get(id) === height ? previous : new Map(previous).set(id, height)
    )
  }, [])
  return { contentHeights, reportContentHeight }
}
