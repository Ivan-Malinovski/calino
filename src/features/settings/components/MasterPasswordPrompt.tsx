import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router'
import { useConfigStore } from '../../../store/configStore'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import styles from './MasterPasswordPrompt.module.css'

const MAX_ATTEMPTS = 5
const BLOCK_DURATION_MS = 60_000
const ATTEMPTS_KEY = 'calino.masterPassword.attempts'
const BLOCKED_KEY = 'calino.masterPassword.blockedUntil'

function getAttempts(): number {
  try {
    return parseInt(localStorage.getItem(ATTEMPTS_KEY) ?? '0', 10) || 0
  } catch {
    return 0
  }
}

function setAttempts(n: number): void {
  try {
    localStorage.setItem(ATTEMPTS_KEY, String(n))
  } catch {
    /* unavailable */
  }
}

function getBlockedUntil(): number {
  try {
    return parseInt(localStorage.getItem(BLOCKED_KEY) ?? '0', 10) || 0
  } catch {
    return 0
  }
}

function setBlockedUntil(ts: number): void {
  try {
    localStorage.setItem(BLOCKED_KEY, String(ts))
  } catch {
    /* unavailable */
  }
}

export function MasterPasswordPrompt() {
  const location = useLocation()
  const { hasPreconfiguredAccounts, isUnlocked, unlock } = useConfigStore()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Initialise the blocked state synchronously from storage so we don't trigger
  // an extra render (and a set-state-in-effect warning) right after mount.
  const [blocked, setBlocked] = useState(() => getBlockedUntil() > Date.now())
  const [remainingSeconds, setRemainingSeconds] = useState(() => {
    const blockedUntil = getBlockedUntil()
    return blockedUntil > Date.now() ? Math.ceil((blockedUntil - Date.now()) / 1000) : 0
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Countdown timer
  useEffect(() => {
    if (!blocked) return
    const interval = setInterval(() => {
      const blockedUntil = getBlockedUntil()
      const remaining = Math.ceil((blockedUntil - Date.now()) / 1000)
      if (remaining <= 0) {
        setBlocked(false)
        setRemainingSeconds(0)
        setAttempts(0)
        clearInterval(interval)
        inputRef.current?.focus()
      } else {
        setRemainingSeconds(remaining)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [blocked])

  const handleSubmit = useCallback(async () => {
    if (!password.trim() || loading || blocked) return

    setLoading(true)
    setError('')

    const success = await unlock(password)

    if (!success) {
      const newAttempts = getAttempts() + 1
      setAttempts(newAttempts)

      if (newAttempts >= MAX_ATTEMPTS) {
        const blockedUntil = Date.now() + BLOCK_DURATION_MS
        setBlockedUntil(blockedUntil)
        setBlocked(true)
        setRemainingSeconds(Math.ceil(BLOCK_DURATION_MS / 1000))
        setError(`Too many attempts. Try again in 1 minute.`)
      } else {
        setError(
          `Wrong password. ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} remaining.`
        )
      }

      setPassword('')
      setLoading(false)
      inputRef.current?.focus()
    } else {
      // Success — reset attempts
      setAttempts(0)
      setBlockedUntil(0)
    }
  }, [password, loading, unlock, blocked])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        // Can't dismiss — must unlock to use app
      }
    },
    [handleSubmit]
  )

  // Don't show if no preconfigured accounts, already unlocked, or on /setup
  const isOpen = hasPreconfiguredAccounts && !isUnlocked && location.pathname !== '/setup'

  // This gate is deliberately non-dismissable (Escape is a no-op above), so it
  // uses the focus trap directly rather than useModalDismiss. Without it, Tab
  // walks straight out of the prompt into an app the user hasn't unlocked.
  useFocusTrap(overlayRef, isOpen)

  if (!isOpen) {
    return null
  }

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Unlock CalDAV accounts"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.icon}>🔐</div>
          <h2 className={styles.title}>Unlock CalDAV Accounts</h2>
          <p className={styles.subtitle}>
            Enter your master password to connect to preconfigured accounts.
          </p>
        </div>

        <div className={styles.inputGroup}>
          <label className={styles.label} htmlFor="master-password">
            Master Password
          </label>
          <input
            ref={inputRef}
            id="master-password"
            type="password"
            className={`${styles.input} ${error ? styles.error : ''}`}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
            }}
            onKeyDown={handleKeyDown}
            placeholder="Enter master password"
            autoComplete="current-password"
            disabled={loading || blocked}
          />
          {error && <div className={styles.errorText}>{error}</div>}
        </div>

        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.submit}`}
            onClick={handleSubmit}
            disabled={!password.trim() || loading || blocked}
          >
            {loading ? (
              <span className={styles.spinner} />
            ) : blocked ? (
              `Wait ${remainingSeconds}s`
            ) : (
              'Unlock'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
