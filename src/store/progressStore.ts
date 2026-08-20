import { create } from 'zustand'

export interface ProgressTask {
  id: string
  /** Short present-tense label, e.g. "Saving event" or "Importing events". */
  label: string
  /** Set both to render a determinate bar; leave undefined for indeterminate. */
  done?: number
  total?: number
  startedAt: number
}

interface ProgressState {
  tasks: ProgressTask[]
  begin: (label: string, init?: { done?: number; total?: number }) => string
  update: (id: string, patch: { label?: string; done?: number; total?: number }) => void
  end: (id: string) => void
}

/**
 * Tracks in-flight work that the user is waiting on, so long operations read as
 * "still going" rather than "frozen".
 *
 * Non-persisted and deliberately global: a save started in a modal can outlive
 * the modal, and a background sync has no modal at all. `GlobalProgress` renders
 * whatever is here.
 */
export const useProgressStore = create<ProgressState>((set) => ({
  tasks: [],
  begin: (label, init) => {
    const id = crypto.randomUUID()
    set((state) => ({
      tasks: [...state.tasks, { id, label, ...init, startedAt: Date.now() }],
    }))
    return id
  },
  update: (id, patch) =>
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    })),
  end: (id) => set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
}))

/** The task the UI speaks for: the oldest one, i.e. what the user waits on. */
export function selectActiveTask(state: ProgressState): ProgressTask | null {
  return state.tasks[0] ?? null
}

/**
 * Run `fn` with a progress task attached for its whole lifetime. The task is
 * always removed, including when `fn` throws.
 *
 * Pass `owned` when `fn` is a bulk loop over individually-tracked writes: the
 * loop then speaks for all of them, and the per-write tasks stay quiet instead
 * of each flashing the pill for one item.
 */
export async function withProgress<T>(
  label: string,
  fn: (report: (patch: { label?: string; done?: number; total?: number }) => void) => Promise<T>,
  options?: { owned?: boolean }
): Promise<T> {
  const { begin, update, end } = useProgressStore.getState()
  const id = begin(label)
  if (options?.owned) ownedDepth++
  try {
    return await fn((patch) => update(id, patch))
  } finally {
    if (options?.owned) ownedDepth--
    end(id)
  }
}

/**
 * Depth rather than a boolean so nested bulk loops unwind correctly. Module
 * state instead of a store field because it gates writes, not rendering, and
 * changing it must not re-render every progress subscriber.
 */
let ownedDepth = 0

/**
 * True while a bulk operation is reporting its own progress. Individual writes
 * should skip their own task and let the enclosing loop narrate.
 */
export function isProgressOwned(): boolean {
  return ownedDepth > 0
}
