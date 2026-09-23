import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import {
  classifySyncError,
  connectionErrorMessage,
  type SyncErrorCode,
} from '@/features/caldav/client/errorMessages'
import { isCleartextUrl, CLEARTEXT_WARNING } from '@/features/caldav/client/insecureUrl'
import { DiagnosticsPanel } from '@/features/settings/components/DiagnosticsPanel'
import type { CalDAVAccount } from '@/features/caldav/types'
import { CustomHeadersEditor } from '@/features/caldav/components/CustomHeadersEditor'
import { connectionNudgeFor } from '@/features/caldav/components/connectionNudge'
import { rowsToHeaders, type HeaderRow } from '@/features/caldav/components/headerRows'
import { useProgressStore, selectActiveTask } from '@/store/progressStore'
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
  const { t } = useTranslation('calendar')
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState<string>('')
  const [connectionHint, setConnectionHint] = useState<string>('')
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorCode, setErrorCode] = useState<SyncErrorCode | null>(null)
  const [proxyDraft, setProxyDraft] = useState(account?.proxyUrl ?? '')
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([])
  const [settingsOpen, setSettingsOpen] = useState<boolean | undefined>(undefined)
  const [hasFailed, setHasFailed] = useState(false)
  // Captured at failure time, so filling in the proxy doesn't rewrite the advice mid-edit.
  const [nudge, setNudge] = useState<ReturnType<typeof connectionNudgeFor>>(null)
  /** Mirrors the (uncontrolled) URL field, only so the cleartext warning can react to it. */
  const [urlDraft, setUrlDraft] = useState(account?.serverUrl ?? '')
  // Captured on failure so "Run diagnostics" probes exactly what was attempted,
  // including the password we resolved out of the credential store in edit mode.
  const [diagnoseTarget, setDiagnoseTarget] = useState<DiagnosticsTarget | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const { addAccount, updateAccount } = useCalDAV()
  // The connect narrates its own stages (probe → calendars → per-calendar
  // import); show them here so a slow first sync doesn't look like a hang.
  const progressTask = useProgressStore(selectActiveTask)
  const isEdit = mode === 'edit' && account !== undefined
  const formRef = useRef<HTMLFormElement>(null)
  const isSavingRef = useRef(false)

  useEffect(() => {
    if (!account) return
    let active = true
    void getCredentialById(account.credentialId).then((credential) => {
      if (active)
        setHeaderRows(
          Object.entries(credential?.customHeaders ?? {}).map(([name, value]) => ({ name, value }))
        )
    })
    return () => {
      active = false
    }
  }, [account])

  const doClose = useCallback((): void => {
    setConnectionStatus('idle')
    setConnectionError('')
    setConnectionHint('')
    setDiagnoseTarget(null)
    setShowDiagnostics(false)
    setErrorCode(null)
    setNudge(null)
    setHasFailed(false)
    setSettingsOpen(undefined)
    setProxyDraft(account?.proxyUrl ?? '')
    if (!account) setHeaderRows([])
    onClose()
  }, [onClose, account])

  /** Record a failure's category and decide whether to point at Connection settings. */
  const recordFailure = (code: SyncErrorCode, proxyUrl: string | null | undefined): void => {
    setHasFailed(true)
    setErrorCode(code)
    setNudge(
      connectionNudgeFor(
        code,
        Boolean(proxyUrl),
        headerRows.some((row) => row.name.trim())
      )
    )
  }

  const clearFailure = (): void => {
    setConnectionStatus('idle')
    setConnectionError('')
    setConnectionHint('')
    setErrorCode(null)
    setNudge(null)
  }

  /** "Set up a proxy ↓" / "Add a header ↓": open the card at the relevant field. */
  const followNudge = (): void => {
    if (!nudge) return
    if (nudge.target === 'headers' && !headerRows.length) {
      setHeaderRows([{ name: '', value: '' }])
    }
    setSettingsOpen(true)
  }

  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, doClose, 200)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalDismiss(dialogRef, rendered && !closing, requestClose)

  /** Run the shared probe and map its result onto this modal's status state. */
  const handleTestConnection = async (
    serverUrl: string,
    username: string,
    password: string,
    proxyUrl?: string,
    originalUrl?: string,
    customHeaders: Record<string, string> = {}
  ): Promise<boolean> => {
    setIsTesting(true)
    clearFailure()
    setShowDiagnostics(false)

    try {
      const result = await probeConnection(
        serverUrl,
        username,
        password,
        proxyUrl,
        originalUrl,
        customHeaders
      )

      setConnectionStatus(result.ok ? 'success' : 'error')
      if (!result.ok) {
        setConnectionError(
          result.error ? connectionErrorMessage(result.error) : 'Connection failed.'
        )
        recordFailure(result.error ? classifySyncError(result.error) : 'unknown', proxyUrl)
        if (result.hint) {
          setConnectionHint(result.hint)
        }
        setDiagnoseTarget({ serverUrl, username, password, proxyUrl, originalUrl, customHeaders })
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
    let customHeaders: Record<string, string>
    try {
      customHeaders = rowsToHeaders(headerRows, proxyUrl)
    } catch (error) {
      setConnectionStatus('error')
      setConnectionError((error as Error).message)
      return
    }

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
      serverUrl,
      customHeaders
    )
  }

  /** Surface a failed add/edit, preferring the probe's hint over a guess. */
  const showFailure = (
    error: unknown,
    serverUrl: string,
    proxyUrl: string | undefined,
    fallback: string
  ): void => {
    setConnectionStatus('error')
    recordFailure(
      error instanceof Error
        ? ((error instanceof CalDAVConnectionError ? error.code : undefined) ??
            classifySyncError(error.message))
        : 'unknown',
      proxyUrl
    )
    setConnectionError(
      error instanceof Error
        ? connectionErrorMessage(
            error.message,
            error instanceof CalDAVConnectionError ? error.code : undefined
          )
        : fallback
    )
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
    let customHeaders: Record<string, string>
    try {
      customHeaders = rowsToHeaders(headerRows, proxyUrl)
    } catch (error) {
      setConnectionStatus('error')
      setConnectionError((error as Error).message)
      return
    }

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
    clearFailure()

    try {
      if (isEdit) {
        await updateAccount(account.id, {
          name: accountName,
          serverUrl,
          username,
          password: password || undefined,
          proxyUrl: proxyUrl ?? null,
          customHeaders,
        })
      } else {
        // No pre-flight test: addAccount probes as its first step, so testing
        // here would just double the round-trips before anything is saved.
        // Expand known provider URLs (e.g. Fastmail base → principal URL).
        const expanded = expandProviderUrl(serverUrl, username)
        await addAccount(
          expanded || serverUrl,
          username,
          password,
          accountName,
          proxyUrl,
          customHeaders
        )
      }
      requestClose()
    } catch (error) {
      showFailure(
        error,
        serverUrl,
        proxyUrl,
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
        customHeaders,
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
            {isEdit ? t('surface.editCaldavAccountTitle') : t('surface.addCaldavCalendarTitle')}
          </h3>
          <button
            className={styles.modalClose}
            onClick={requestClose}
            aria-label={t('surface.close')}
          >
            ✕
          </button>
        </div>
        <form ref={formRef} key={account?.id ?? 'add'} onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="accountName" className={styles.formLabel}>
              Display name <span className={styles.formLabelOptional}>(optional)</span>
            </label>
            <input
              id="accountName"
              name="accountName"
              className={styles.input}
              placeholder={t('surface.calendarServerPlaceholder')}
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
              placeholder={t('surface.caldavUrlPlaceholder')}
              defaultValue={account?.serverUrl}
              onChange={(e) => setUrlDraft(e.target.value)}
              required
            />
            {isCleartextUrl(urlDraft) && <div className={styles.formWarn}>{CLEARTEXT_WARNING}</div>}
          </div>
          <div className={styles.credentialsRow}>
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
                className={`${styles.input} ${errorCode === 'auth' ? styles.inputInvalid : ''}`}
                aria-invalid={errorCode === 'auth' || undefined}
                aria-describedby={errorCode === 'auth' ? 'connection-error' : undefined}
                required={!isEdit}
              />
              {isEdit && <span className={styles.formHint}>{t('surface.passwordHint')}</span>}
            </div>
          </div>
          {connectionStatus === 'success' && (
            <p className={styles.successMessage}>{t('surface.connectionSuccessful')}</p>
          )}
          {connectionStatus === 'error' && (
            <div className={styles.errorBox} role="alert" data-component="connection-error">
              <p className={styles.errorBoxMessage} id="connection-error">
                {connectionError}
              </p>
              {connectionHint && <p className={styles.errorBoxHint}>{connectionHint}</p>}
              {(nudge || (diagnoseTarget && !showDiagnostics)) && (
                <div className={styles.errorBoxActions}>
                  {nudge && (
                    <button
                      type="button"
                      className={styles.errorBoxNudge}
                      onClick={followNudge}
                      data-action="connection-nudge"
                    >
                      {nudge.action}
                    </button>
                  )}
                  {diagnoseTarget && !showDiagnostics && (
                    <button
                      type="button"
                      className={styles.diagnoseLink}
                      onClick={() => setShowDiagnostics(true)}
                      data-action="show-diagnostics"
                    >
                      Diagnose the connection
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {showDiagnostics && diagnoseTarget && (
            <DiagnosticsPanel options={diagnoseTarget} autoRun />
          )}
          <CustomHeadersEditor
            rows={headerRows}
            onChange={setHeaderRows}
            proxy={{
              value: proxyDraft,
              onChange: setProxyDraft,
              placeholder: t('surface.proxyUrlPlaceholder'),
            }}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            nudge={nudge?.target ?? null}
            nudgeLabel={nudge?.label}
          />
          {isSaving && progressTask && (
            <div className={styles.progress} role="status" aria-live="polite">
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label={progressTask.label}
                aria-valuemin={progressTask.total ? 0 : undefined}
                aria-valuemax={progressTask.total ? 100 : undefined}
                aria-valuenow={
                  progressTask.total
                    ? Math.round(((progressTask.done ?? 0) / progressTask.total) * 100)
                    : undefined
                }
              >
                {progressTask.total ? (
                  <div
                    className={styles.progressBar}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(((progressTask.done ?? 0) / progressTask.total) * 100)
                      )}%`,
                    }}
                  />
                ) : (
                  <div className={styles.progressIndeterminate} />
                )}
              </div>
              <span className={styles.progressLabel}>{progressTask.label}</span>
            </div>
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
              <span>
                {isSaving
                  ? isEdit
                    ? 'Saving…'
                    : 'Connecting…'
                  : isEdit
                    ? 'Save Changes'
                    : hasFailed
                      ? 'Try again'
                      : 'Connect'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
