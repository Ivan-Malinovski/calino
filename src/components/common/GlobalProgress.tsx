import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useProgressStore, selectActiveTask } from '@/store/progressStore'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import styles from './GlobalProgress.module.css'

/**
 * Quick operations shouldn't flash a bar — most saves finish well inside this,
 * and a one-frame blink reads as a glitch rather than as feedback.
 */
const APPEAR_DELAY_MS = 400

/**
 * Exit is deliberately much quicker than a modal's: the work is already done,
 * so the pill should get out of the way rather than linger.
 */
const EXIT_MS = 140

/**
 * Top-of-screen progress for whatever the user is currently waiting on.
 *
 * Determinate when the task reports a total (adding an account walks its
 * calendars), a sweep otherwise (a single save has no meaningful fraction).
 */
export function GlobalProgress(): JSX.Element | null {
  const task = useProgressStore(selectActiveTask)
  // Which task has outlived the appear delay. Keyed by id rather than a bare
  // boolean so a new task starts its own delay instead of inheriting one.
  const [readyId, setReadyId] = useState<string | null>(null)

  useEffect(() => {
    if (!task || readyId === task.id) return
    const remaining = APPEAR_DELAY_MS - (Date.now() - task.startedAt)
    const timer = setTimeout(() => setReadyId(task.id), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [task, readyId])

  const showing = task !== null && readyId === task.id
  const noop = useCallback(() => {}, [])
  const { rendered, closing } = useAnimatedClose(showing, noop, EXIT_MS)

  // What the pill says. Held in state rather than read straight off the task,
  // because the task is already gone by the time the exit animation runs and
  // animating out a blank pill would look like a glitch. Assigning during
  // render is the "derived from props" idiom: React re-renders immediately
  // without committing the intermediate result.
  const [label, setLabel] = useState('')
  const [percent, setPercent] = useState(0)
  const [determinate, setDeterminate] = useState(false)

  if (task) {
    const total = task.total ?? 0
    const next = total > 0 ? Math.min(100, Math.round(((task.done ?? 0) / total) * 100)) : 0
    if (task.label !== label) setLabel(task.label)
    if (next !== percent) setPercent(next)
    if ((total > 0) !== determinate) setDeterminate(total > 0)
  }

  if (!rendered || !label) return null

  // Whatever it got to, it finished — exiting mid-bar would read as a failure.
  const shownPercent = closing && determinate ? 100 : percent

  return (
    <div
      className={`${styles.host} ${closing ? styles.closing : ''}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? shownPercent : undefined}
      >
        {determinate ? (
          <div className={styles.bar} style={{ width: `${shownPercent}%` }} />
        ) : (
          <div className={styles.indeterminate} />
        )}
      </div>
      <div className={styles.label}>{label}</div>
    </div>
  )
}
