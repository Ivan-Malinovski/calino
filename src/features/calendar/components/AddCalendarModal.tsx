import type { JSX } from 'react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { CalDAVConnectionError } from '@/features/caldav/client/errors'
import {
  probeConnection,
  suggestCalDAVUrl,
  expandProviderUrl,
} from '@/features/caldav/client/discovery'
import { getCredentialById } from '@/features/caldav/client/credentials'
import type { DiagnosticsOptions } from '@/features/caldav/client/diagnostics'
import { DiagnosticsPanel } from '@/features/settings/components/DiagnosticsPanel'
import type { CalDAVAccount } from '@/features/caldav/types'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import styles from './AddCalendarModal.module.css'

type DiagnosticsTarget = Omit<DiagnosticsOptions, 'includeWriteTest' | 'onProgress'>

interface AddCalendarModalProps {
  isOpen: boolean
  onClose: () => void
  /** 'edit' prefills the form and keeps the current password when left blank. */
  mode?: 'add' | 'edit'
  /** The account being edited. Required when mode is 'edit'. */
  account?: CalDAVAccount
}

export function AddCalendarModal({
  isOpen,
  onClose,
  mode = 'add',
  account,
}: AddCalendarModalProps): JSX.Element | null {
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState<string>('')
  const [connectionHint, setConnectionHint] = useState<string>('')
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showProxyField, setShowProxyField] = useState(Boolean(account?.proxyUrl))
  // Captured on failure so "Run diagnostics" probes exactly what was attempted,
  // including the password we resolved out of the credential store in edit mode.
  const [diagnoseTarget, setDiagnoseTarget] = useState<DiagnosticsTarget | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const { addAccount, updateAccount } = useCalDAV()
  const isEdit = mode === 'edit' && account !== undefined
  const formRef = useRef<HTMLFormElement>(null)
  const isSavingRef = useRef(false)

  const doClose = useCallback((): void => {
    setConnectionStatus('idle')
    setConnectionError('')
    setConnectionHint('')
    setDiagnoseTarget(null)
    setShowDiagnostics(false)
    onClose()
  }, [onClose])
  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, doClose, 200)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalDismiss(dialogRef, rendered && !closing, requestClose)

  /** Run the shared probe and map its result onto this modal's status state. */
  const handleTestConnection = async (
    serverUrl: string,
    username: string,
    password: string,
    proxyUrl?: string,
    originalUrl?: string
  ): Promise<boolean> => {
    setIsTesting(true)
    setConnectionStatus('idle')
    setConnectionError('')
    setConnectionHint('')
    setShowDiagnostics(false)

    try {
      const result = await probeConnection(serverUrl, username, password, proxyUrl, originalUrl)

      setConnectionStatus(result.ok ? 'success' : 'error')
      if (!result.ok) {
        setConnectionError(result.error ?? 'Connection failed')
        if (result.hint) {
          setConnectionHint(result.hint)
        }
        setDiagnoseTarget({ serverUrl, username, password, proxyUrl, originalUrl })
      } else {
        setDiagnoseTarget(null)
      }
      return result.ok
    } finally {
      setIsTesting(false)
    }
  }

  /**
   * Read the form. In edit mode a blank password means "keep the current one",
   * so we resolve it to undefined rather than an empty string.
   */
  const readForm = (
    form: HTMLFormElement
  ): {
    serverUrl: string
    username: string
    password: string
    accountName: string
    proxyUrl: string | undefined
  } => {
    const formData = new FormData(form)
    const username = formData.get('username') as string
    return {
      serverUrl: formData.get('serverUrl') as string,
      username,
      password: formData.get('password') as string,
      accountName: (formData.get('accountName') as string) || username,
      proxyUrl: (formData.get('proxyUrl') as string) || undefined,
    }
  }

  /** Test button (edit mode) — probes the values currently in the form, saves nothing. */
  const handleTestClick = async (): Promise<void> => {
    if (!formRef.current) return
    const { serverUrl, username, password, proxyUrl } = readForm(formRef.current)

    // A blank password means "keep the current one", so test with the stored one.
    let effectivePassword = password
    if (!effectivePassword && account) {
      const credential = await getCredentialById(account.credentialId)
      effectivePassword = credential?.password ?? ''
    }
    if (!effectivePassword) {
      setConnectionStatus('error')
      setConnectionError('Enter a password to test the connection.')
      return
    }

    const expanded = expandProviderUrl(serverUrl, username)
    await handleTestConnection(
      expanded || serverUrl,
      username,
      effectivePassword,
      proxyUrl,
      serverUrl
    )
  }

  /** Surface a failed add/edit, preferring the probe's hint over a guess. */
  const showFailure = (error: unknown, serverUrl: string, fallback: string): void => {
    setConnectionStatus('error')
    setConnectionError(error instanceof Error ? error.message : fallback)
    const hint =
      (error instanceof CalDAVConnectionError ? error.hint : undefined) ??
      suggestCalDAVUrl(serverUrl) ??
      undefined
    if (hint) {
      setConnectionHint(hint)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()

    // Synchronous re-entrancy guard. React state lands a tick too late to stop
    // a double-tap from firing two submits, which would add the account twice.
    if (isSavingRef.current) return

    const { serverUrl, username, password, accountName, proxyUrl } = readForm(e.currentTarget)

    if (isEdit) {
      // Re-pointing the account at a different principal invalidates the
      // calendars stored under it, so they get re-fetched and reconciled.
      const principalChanged = serverUrl !== account.serverUrl || username !== account.username
      if (
        principalChanged &&
        !confirm(
          'Changing the server URL or username will re-sync the calendars for this account. Continue?'
        )
      ) {
        return
      }
    }

    isSavingRef.current = true
    setIsSaving(true)
    setConnectionStatus('idle')
    setConnectionError('')
    setConnectionHint('')

    try {
      if (isEdit) {
        await updateAccount(account.id, {
          name: accountName,
          serverUrl,
          username,
          password: password || undefined,
          proxyUrl: proxyUrl ?? null,
        })
      } else {
        // No pre-flight test: addAccount probes as its first step, so testing
        // here would just double the round-trips before anything is saved.
        // Expand known provider URLs (e.g. Fastmail base → principal URL).
        const expanded = expandProviderUrl(serverUrl, username)
        await addAccount(expanded || serverUrl, username, password, accountName, proxyUrl)
      }
      requestClose()
    } catch (error) {
      showFailure(
        error,
        serverUrl,
        isEdit
          ? 'Failed to update account. Please try again.'
          : 'Failed to add account. Please try again.'
      )
      // A blank password in edit mode means "keep the current one", so
      // diagnostics has to test the stored credential, not the empty field.
      let effectivePassword = password
      if (!effectivePassword && account) {
        effectivePassword = (await getCredentialById(account.credentialId))?.password ?? ''
      }
      setDiagnoseTarget({
        serverUrl: expandProviderUrl(serverUrl, username) || serverUrl,
        username,
        password: effectivePassword,
        proxyUrl: proxyUrl ?? null,
        originalUrl: serverUrl,
      })
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) {
      requestClose()
    }
  }

  if (!rendered) {
    return null
  }

  return createPortal(
    <div
      className={`${styles.modal} ${closing ? styles.closing : ''}`}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle} id="modal-title">
            {isEdit ? 'Edit CalDAV Account' : 'Add CalDAV Calendar'}
          </h3>
          <button className={styles.modalClose} onClick={requestClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form ref={formRef} key={account?.id ?? 'add'} onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="accountName" className={styles.formLabel}>
              Account Name (optional)
            </label>
            <input
              id="accountName"
              name="accountName"
              className={styles.input}
              placeholder="My Calendar Server"
              defaultValue={account?.name}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="serverUrl" className={styles.formLabel}>
              Server URL
            </label>
            <input
              id="serverUrl"
              name="serverUrl"
              className={styles.input}
              placeholder="https://caldav.example.com"
              defaultValue={account?.serverUrl}
              required
            />
            <span className={styles.formHint}>Enter the full URL of your CalDAV server</span>
          </div>
          <div className={styles.formGroup}>
            <button
              type="button"
              className={styles.chevronLabel}
              onClick={() => setShowProxyField(!showProxyField)}
            >
              <svg
                aria-hidden="true"
                className={styles.chevronIcon}
                style={{ transform: showProxyField ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 6L8 10L12 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Proxy URL (optional)</span>
            </button>
            {showProxyField && (
              <>
                <input
                  id="proxyUrl"
                  name="proxyUrl"
                  className={styles.input}
                  placeholder="https://proxy.calino.io"
                  defaultValue={account?.proxyUrl ?? undefined}
                />
                <span className={styles.proxyInfoText}>
                  Using a proxy means your requests go through another server. Your CalDAV server,
                  requests, authorization credentials, and calendar data might be visible to the
                  proxy provider, since the connection is decrypted there. It's recommended to
                  either enable CORS headers on your CalDAV server or run your own proxy.
                </span>
              </>
            )}
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="username" className={styles.formLabel}>
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              className={styles.input}
              defaultValue={account?.username}
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="password" className={styles.formLabel}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className={styles.input}
              required={!isEdit}
            />
            {isEdit && (
              <span className={styles.formHint}>Leave blank to keep your current password</span>
            )}
          </div>
          {connectionStatus === 'success' && (
            <p className={styles.successMessage}>✓ Connection successful!</p>
          )}
          {connectionStatus === 'error' && <p className={styles.errorMessage}>{connectionError}</p>}
          {connectionHint && <div className={styles.hintMessage}>{connectionHint}</div>}
          {connectionStatus === 'error' && diagnoseTarget && !showDiagnostics && (
            <button
              type="button"
              className={styles.diagnoseLink}
              onClick={() => setShowDiagnostics(true)}
              data-action="show-diagnostics"
            >
              Run diagnostics to find out why
            </button>
          )}
          {showDiagnostics && diagnoseTarget && (
            <DiagnosticsPanel options={diagnoseTarget} autoRun />
          )}
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={requestClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            {isEdit && (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={handleTestClick}
                disabled={isTesting || isSaving}
                data-action="test-connection"
              >
                {isTesting ? 'Testing…' : 'Test'}
              </button>
            )}
            <button
              type="submit"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={isTesting || isSaving}
              aria-busy={isSaving}
              data-component="modal-save"
            >
              {isSaving && <span className={styles.buttonSpinner} aria-hidden="true" />}
              <span>{isSaving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Calendar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
