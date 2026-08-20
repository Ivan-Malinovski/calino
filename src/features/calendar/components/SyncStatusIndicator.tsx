import type { JSX } from 'react'
import { useState } from 'react'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { usePendingChangeCount } from '@/features/caldav/hooks/usePendingChangeCount'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { withProgress } from '@/store/progressStore'
import { showToast } from '@/lib/toast'
import styles from './SyncStatusIndicator.module.css'

/**
 * Says when the app is holding changes it hasn't managed to send.
 *
 * Until now the only trace of a failed write was a small warning icon on the
 * affected event and a toast that had long since scrolled away, so "the server
 * is down" and "everything is saved" looked much the same. The queue retries
 * itself every 30s; this reports that it exists, and offers to try now.
 */
export function SyncStatusIndicator(): JSX.Element | null {
  const pending = usePendingChangeCount()
  const isOnline = useOnlineStatus()
  const { retryAllFailedSyncs } = useCalDAV()
  const [isRetrying, setIsRetrying] = useState(false)

  // Nothing waiting and a working connection is the normal state, and the
  // normal state doesn't need saying.
  if (isOnline && pending === 0) return null

  const handleRetry = async (): Promise<void> => {
    setIsRetrying(true)
    try {
      const { succeeded, failed } = await withProgress('Retrying changes…', () =>
        retryAllFailedSyncs()
      )
      showToast(
        failed > 0
          ? `${succeeded} sent, ${failed} still waiting`
          : `${succeeded} ${succeeded === 1 ? 'change' : 'changes'} sent`
      )
    } finally {
      setIsRetrying(false)
    }
  }

  const message =
    pending === 0
      ? 'Offline — changes will send when you reconnect'
      : `${pending} ${pending === 1 ? 'change' : 'changes'} waiting${isOnline ? '' : ' — offline'}`

  return (
    <div className={styles.indicator} role="status" aria-live="polite">
      <span className={`${styles.dot} ${isOnline ? '' : styles.offline}`} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
      {pending > 0 && isOnline && (
        <button
          type="button"
          className={styles.retry}
          onClick={handleRetry}
          disabled={isRetrying}
          data-component="sync-retry"
        >
          {isRetrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  )
}
