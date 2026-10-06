import type { JSX } from 'react'
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { encryptWithMasterPassword } from '@/lib/crypto'
import { probeConnection } from '@/features/caldav/client/discovery'
import { CustomHeadersEditor } from '@/features/caldav/components/CustomHeadersEditor'
import { connectionNudgeFor } from '@/features/caldav/components/connectionNudge'
import { rowsToHeaders } from '@/features/caldav/components/headerRows'
import {
  classifySyncError,
  connectionErrorMessage,
  type SyncErrorCode,
} from '@/features/caldav/client/errorMessages'
import { isCleartextUrl, cleartextWarning } from '@/features/caldav/client/insecureUrl'
import type { DiagnosticsOptions } from '@/features/caldav/client/diagnostics'
import { DiagnosticsPanel } from '@/features/settings/components/DiagnosticsPanel'
import type { CalinoConfig, PreconfiguredAccount, PreconfiguredWebcal } from '@/lib/configLoader'
import styles from './SetupPage.module.css'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountEntry {
  name: string
  url: string
  username: string
  password: string
  proxyUrl?: string
  customHeaders: Record<string, string>
}

interface WebcalEntry {
  name: string
  url: string
  refreshIntervalMinutes: number
  proxyUrl?: string
}

type Step = 'accounts' | 'password' | 'done'

/** What the diagnostics panel needs; it supplies the rest of its options. */
type DiagnosticsTarget = Omit<DiagnosticsOptions, 'includeWriteTest' | 'onProgress'>

// ─── Password strength ───────────────────────────────────────────────────────

function getPasswordStrength(password: string): 'weak' | 'medium' | 'strong' {
  if (password.length < 8) return 'weak'
  let score = 0
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++
  if (password.length >= 12) score++
  if (score <= 2) return 'weak'
  if (score <= 3) return 'medium'
  return 'strong'
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SetupPage(): JSX.Element {
  const navigate = useNavigate()
  const { t } = useTranslation('settings')

  // Wizard state
  const [step, setStep] = useState<Step>('accounts')

  // Account form state
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formProxy, setFormProxy] = useState('')
  const [formHeaders, setFormHeaders] = useState<Array<{ name: string; value: string }>>([])
  const [headerError, setHeaderError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState<boolean | undefined>(undefined)
  const [errorCode, setErrorCode] = useState<SyncErrorCode | null>(null)
  const [nudge, setNudge] = useState<ReturnType<typeof connectionNudgeFor>>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const [testHint, setTestHint] = useState('')
  const [diagnoseTarget, setDiagnoseTarget] = useState<DiagnosticsTarget | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  // Password state
  const [masterPassword, setMasterPassword] = useState('')
  const [masterConfirm, setMasterConfirm] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // Generate state
  const [configJson, setConfigJson] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  // ── Account handlers ──────────────────────────────────────────────────────

  const handleTest = useCallback(async () => {
    if (!formUrl || !formUsername || !formPassword) return
    let customHeaders: Record<string, string>
    try {
      customHeaders = rowsToHeaders(formHeaders, formProxy)
      setHeaderError('')
    } catch (error) {
      setHeaderError(
        error instanceof Error ? error.message : i18n.t('caldav:ui.headerErrors.invalid')
      )
      return
    }
    setTestStatus('testing')
    setTestError('')
    setTestHint('')
    setErrorCode(null)
    setNudge(null)
    setShowDiagnostics(false)
    const proxyUrl = formProxy || undefined
    // Shared with the Add Calendar dialog rather than probed separately here:
    // this page had its own copy that missed the redirect fallbacks and the
    // provider-specific hints, so setup was the least helpful surface.
    const result = await probeConnection(
      formUrl,
      formUsername,
      formPassword,
      proxyUrl,
      undefined,
      customHeaders
    )
    setTestStatus(result.ok ? 'success' : 'error')
    if (result.ok) {
      setDiagnoseTarget(null)
    } else {
      setTestError(connectionErrorMessage(result.error ?? 'Connection failed.'))
      const code = result.error ? classifySyncError(result.error) : 'unknown'
      setErrorCode(code)
      setNudge(
        connectionNudgeFor(
          code,
          Boolean(proxyUrl),
          formHeaders.some((row) => row.name.trim())
        )
      )
      if (result.hint) setTestHint(result.hint)
      setDiagnoseTarget({
        serverUrl: formUrl,
        username: formUsername,
        password: formPassword,
        proxyUrl,
      })
    }
  }, [formUrl, formUsername, formPassword, formProxy, formHeaders])

  const handleAddAccount = useCallback(() => {
    if (!formUrl || !formUsername || !formPassword) return
    let customHeaders: Record<string, string>
    try {
      customHeaders = rowsToHeaders(formHeaders, formProxy)
      setHeaderError('')
    } catch (error) {
      setHeaderError(
        error instanceof Error ? error.message : i18n.t('caldav:ui.headerErrors.invalid')
      )
      return
    }
    setAccounts((prev) => [
      ...prev,
      {
        name: formName.trim() || formUsername,
        url: formUrl.trim(),
        username: formUsername.trim(),
        password: formPassword,
        proxyUrl: formProxy.trim() || undefined,
        customHeaders,
      },
    ])
    // Reset form
    setFormName('')
    setFormUrl('')
    setFormUsername('')
    setFormPassword('')
    setFormProxy('')
    setFormHeaders([])
    setSettingsOpen(undefined)
    setTestStatus('idle')
    setTestError('')
    setErrorCode(null)
    setNudge(null)
  }, [formName, formUrl, formUsername, formPassword, formProxy, formHeaders])

  const handleRemoveAccount = useCallback((index: number) => {
    setAccounts((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // ── Webcal handlers ───────────────────────────────────────────────────────

  const [webcalSubscriptions, setWebcalSubscriptions] = useState<WebcalEntry[]>([])
  const [webcalFormName, setWebcalFormName] = useState('')
  const [webcalFormUrl, setWebcalFormUrl] = useState('')
  const [webcalFormRefresh, setWebcalFormRefresh] = useState(60)
  const [webcalFormProxy, setWebcalFormProxy] = useState('')
  const [showWebcalProxy, setShowWebcalProxy] = useState(false)

  const handleAddWebcal = useCallback(() => {
    if (!webcalFormUrl || !webcalFormName) return
    setWebcalSubscriptions((prev) => [
      ...prev,
      {
        name: webcalFormName.trim(),
        url: webcalFormUrl.trim(),
        refreshIntervalMinutes: webcalFormRefresh,
        proxyUrl: webcalFormProxy.trim() || undefined,
      },
    ])
    setWebcalFormName('')
    setWebcalFormUrl('')
    setWebcalFormRefresh(60)
    setWebcalFormProxy('')
    setShowWebcalProxy(false)
  }, [webcalFormName, webcalFormUrl, webcalFormRefresh, webcalFormProxy])

  const handleRemoveWebcal = useCallback((index: number) => {
    setWebcalSubscriptions((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // ── Download ──────────────────────────────────────────────────────────────

  const downloadConfig = useCallback((json: string) => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'calino.config.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // ── Config generation ─────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (masterPassword !== masterConfirm) {
      setPasswordError(t('ui.setup.passwordsMismatch'))
      return
    }
    if (masterPassword.length < 6) {
      setPasswordError(t('ui.setup.passwordTooShort'))
      return
    }
    setPasswordError('')
    setGenerating(true)

    try {
      const configAccounts: PreconfiguredAccount[] = []

      for (const account of accounts) {
        const [encryptedUrl, encryptedUsername, encryptedPassword] = await Promise.all([
          encryptWithMasterPassword(account.url, masterPassword),
          encryptWithMasterPassword(account.username, masterPassword),
          encryptWithMasterPassword(account.password, masterPassword),
        ])
        const headers = Object.keys(account.customHeaders).length
          ? Object.fromEntries(
              await Promise.all(
                Object.entries(account.customHeaders).map(
                  async ([name, value]) =>
                    [name, await encryptWithMasterPassword(value, masterPassword)] as const
                )
              )
            )
          : undefined
        configAccounts.push({
          name: account.name,
          url: encryptedUrl,
          username: encryptedUsername,
          password: encryptedPassword,
          headers,
        })
      }

      const configWebcal: PreconfiguredWebcal[] = []
      for (const webcal of webcalSubscriptions) {
        const encryptedUrl = await encryptWithMasterPassword(webcal.url, masterPassword)
        configWebcal.push({
          name: webcal.name,
          url: encryptedUrl,
          refreshIntervalMinutes: webcal.refreshIntervalMinutes,
          proxyUrl: webcal.proxyUrl,
        })
      }

      const config: CalinoConfig = {
        version: 1,
        accounts: configAccounts,
        webcalSubscriptions: configWebcal,
      }

      const json = JSON.stringify(config, null, 2)
      setConfigJson(json)
      setStep('done')
      downloadConfig(json)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t('ui.setup.encryptionFailed'))
    } finally {
      setGenerating(false)
    }
  }, [accounts, webcalSubscriptions, masterPassword, masterConfirm, downloadConfig, t])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.logo}>📅</div>
          <h1 className={styles.title}>{t('ui.setup.title')}</h1>
          <p className={styles.subtitle}>{t('ui.setup.subtitle')}</p>
        </div>

        {/* Step indicator */}
        <div className={styles.steps}>
          <div
            className={`${styles.step} ${step === 'accounts' ? styles.stepActive : styles.stepDone}`}
          >
            <span className={styles.stepDot}>{step === 'accounts' ? '1' : '✓'}</span>
            <span>{t('ui.setup.stepAccounts')}</span>
          </div>
          <div className={`${styles.stepSep} ${step !== 'accounts' ? styles.stepDone : ''}`} />
          <div
            className={`${styles.step} ${step === 'password' ? styles.stepActive : step === 'done' ? styles.stepDone : ''}`}
          >
            <span className={styles.stepDot}>{step === 'done' ? '✓' : '2'}</span>
            <span>{t('ui.setup.stepPassword')}</span>
          </div>
          <div className={`${styles.stepSep} ${step === 'done' ? styles.stepDone : ''}`} />
          <div className={`${styles.step} ${step === 'done' ? styles.stepActive : ''}`}>
            <span className={styles.stepDot}>3</span>
            <span>{t('ui.setup.stepDownload')}</span>
          </div>
        </div>

        {/* ── Step 1: Accounts ─────────────────────────────────────────── */}
        {step === 'accounts' && (
          <>
            {accounts.length > 0 && (
              <div className={styles.accountList}>
                {accounts.map((acc, i) => (
                  <div key={i} className={styles.accountRow}>
                    <div className={styles.accountIcon}>{acc.name.charAt(0).toUpperCase()}</div>
                    <div className={styles.accountInfo}>
                      <div className={styles.accountName}>{acc.name}</div>
                      <div className={styles.accountUrl}>{acc.url}</div>
                    </div>
                    <button
                      className={styles.removeBtn}
                      onClick={() => handleRemoveAccount(i)}
                      type="button"
                      aria-label={t('ui.setup.remove', { name: acc.name })}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M4 4L12 12M12 4L4 12"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-name">
                {t('ui.setup.displayName')}{' '}
                <span className={styles.labelOptional}>{t('ui.setup.optional')}</span>
              </label>
              <input
                id="setup-name"
                className={styles.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('ui.setup.displayNamePlaceholder')}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-url">
                {t('ui.setup.serverUrl')}
              </label>
              <input
                id="setup-url"
                className={styles.input}
                value={formUrl}
                onChange={(e) => {
                  setFormUrl(e.target.value)
                  setTestStatus('idle')
                }}
                placeholder="https://caldav.example.com/dav.php"
              />
              {isCleartextUrl(formUrl) && <div className={styles.warn}>{cleartextWarning()}</div>}
            </div>

            <div className={styles.credentialsRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="setup-username">
                  {t('ui.setup.username')}
                </label>
                <input
                  id="setup-username"
                  className={styles.input}
                  value={formUsername}
                  onChange={(e) => {
                    setFormUsername(e.target.value)
                    setTestStatus('idle')
                  }}
                  autoComplete="username"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="setup-password">
                  {t('ui.setup.password')}
                </label>
                <input
                  id="setup-password"
                  type="password"
                  className={styles.input}
                  value={formPassword}
                  onChange={(e) => {
                    setFormPassword(e.target.value)
                    setTestStatus('idle')
                  }}
                  autoComplete="current-password"
                  aria-invalid={errorCode === 'auth' || undefined}
                />
              </div>
            </div>

            {testStatus === 'success' && (
              <div className={styles.success}>✓ {t('ui.setup.connectionSuccessful')}</div>
            )}
            {testStatus === 'error' && (
              <div className={styles.errorBox} role="alert" data-component="connection-error">
                <p className={styles.errorBoxMessage}>{testError}</p>
                {testHint && <p className={styles.errorBoxHint}>{testHint}</p>}
                {(nudge || (diagnoseTarget && !showDiagnostics)) && (
                  <div className={styles.errorBoxActions}>
                    {nudge && (
                      <button
                        type="button"
                        className={styles.errorBoxNudge}
                        data-action="connection-nudge"
                        onClick={() => {
                          if (nudge.target === 'headers' && !formHeaders.length) {
                            setFormHeaders([{ name: '', value: '' }])
                          }
                          setSettingsOpen(true)
                        }}
                      >
                        {nudge.action}
                      </button>
                    )}
                    {diagnoseTarget && !showDiagnostics && (
                      <button
                        type="button"
                        className={styles.errorBoxLink}
                        data-action="show-diagnostics"
                        onClick={() => setShowDiagnostics(true)}
                      >
                        {t('ui.setup.diagnose')}
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
              rows={formHeaders}
              onChange={setFormHeaders}
              proxy={{
                value: formProxy,
                onChange: setFormProxy,
                placeholder: 'https://proxy.calino.io',
              }}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              nudge={nudge?.target ?? null}
              nudgeLabel={nudge?.label}
            />
            {headerError && <div className={styles.error}>{headerError}</div>}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                onClick={handleTest}
                disabled={!formUrl || !formUsername || !formPassword || testStatus === 'testing'}
              >
                {testStatus === 'testing' ? t('ui.setup.testing') : t('ui.setup.testConnection')}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleAddAccount}
                disabled={!formUrl || !formUsername || !formPassword}
              >
                {t('ui.setup.addAccount')}
              </button>
            </div>

            <hr
              style={{
                margin: '24px 0',
                border: 'none',
                borderTop: '1px solid var(--modal-border, #e0e0e0)',
              }}
            />
            <h2
              style={{
                marginBottom: 12,
                fontSize: 15,
                fontWeight: 600,
                marginTop: 0,
              }}
            >
              {t('ui.setup.subscriptionsHeading')}
            </h2>

            {webcalSubscriptions.length > 0 && (
              <div className={styles.accountList}>
                {webcalSubscriptions.map((sub, i) => (
                  <div key={i} className={styles.accountRow}>
                    <div className={styles.accountIcon}>{sub.name.charAt(0).toUpperCase()}</div>
                    <div className={styles.accountInfo}>
                      <div className={styles.accountName}>{sub.name}</div>
                      <div className={styles.accountUrl}>{sub.url}</div>
                    </div>
                    <button
                      className={styles.removeBtn}
                      onClick={() => handleRemoveWebcal(i)}
                      type="button"
                      aria-label={t('ui.setup.remove', { name: sub.name })}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M4 4L12 12M12 4L4 12"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-webcal-name">
                {t('ui.setup.name')}
              </label>
              <input
                id="setup-webcal-name"
                className={styles.input}
                value={webcalFormName}
                onChange={(e) => setWebcalFormName(e.target.value)}
                placeholder={t('ui.setup.namePlaceholder')}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-webcal-url">
                {t('ui.setup.calendarUrl')}
              </label>
              <input
                id="setup-webcal-url"
                className={styles.input}
                value={webcalFormUrl}
                onChange={(e) => setWebcalFormUrl(e.target.value)}
                placeholder="webcal://example.com/calendar.ics"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-webcal-refresh">
                {t('ui.setup.refreshInterval')}
              </label>
              <input
                id="setup-webcal-refresh"
                type="number"
                min={5}
                className={styles.input}
                value={webcalFormRefresh}
                onChange={(e) => setWebcalFormRefresh(Number(e.target.value) || 60)}
              />
            </div>

            <button
              type="button"
              className={styles.proxyToggle}
              onClick={() => setShowWebcalProxy(!showWebcalProxy)}
            >
              <svg
                style={{ transform: showWebcalProxy ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M4 6L8 10L12 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t('ui.setup.proxyOptional')}
            </button>

            {showWebcalProxy && (
              <div className={styles.field}>
                <input
                  className={styles.input}
                  value={webcalFormProxy}
                  onChange={(e) => setWebcalFormProxy(e.target.value)}
                  placeholder="https://proxy.example.com"
                />
                <div className={styles.hint}>{t('ui.setup.proxyHint')}</div>
              </div>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleAddWebcal}
                disabled={!webcalFormUrl || !webcalFormName}
              >
                {t('ui.setup.addSubscription')}
              </button>
            </div>

            {(accounts.length > 0 || webcalSubscriptions.length > 0) && (
              <div className={styles.actions} style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => setStep('password')}
                >
                  {t('ui.setup.next')}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Step 2: Master Password ─────────────────────────────────── */}
        {step === 'password' && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-master">
                {t('ui.setup.masterPassword')}
              </label>
              <input
                id="setup-master"
                type="password"
                className={`${styles.input} ${passwordError ? styles.inputError : ''}`}
                value={masterPassword}
                onChange={(e) => {
                  setMasterPassword(e.target.value)
                  setPasswordError('')
                }}
                placeholder={t('ui.setup.masterPlaceholder')}
                autoFocus
              />
              {masterPassword.length > 0 && (
                <div className={styles.strengthBar}>
                  <div
                    className={`${styles.strengthFill} ${
                      getPasswordStrength(masterPassword) === 'weak'
                        ? styles.strengthWeak
                        : getPasswordStrength(masterPassword) === 'medium'
                          ? styles.strengthMedium
                          : styles.strengthStrong
                    }`}
                  />
                </div>
              )}
              <div className={styles.hint}>{t('ui.setup.masterHint')}</div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-confirm">
                {t('ui.setup.confirmPassword')}
              </label>
              <input
                id="setup-confirm"
                type="password"
                className={`${styles.input} ${passwordError ? styles.inputError : ''}`}
                value={masterConfirm}
                onChange={(e) => {
                  setMasterConfirm(e.target.value)
                  setPasswordError('')
                }}
                placeholder={t('ui.setup.confirmPlaceholder')}
              />
            </div>

            {passwordError && <div className={styles.error}>{passwordError}</div>}

            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => setStep('accounts')}>
                {t('ui.setup.back')}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSuccess}`}
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? t('ui.setup.encrypting') : t('ui.setup.generate')}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Download ────────────────────────────────────────── */}
        {step === 'done' && (
          <>
            <div className={styles.instructions}>
              <h2>{t('ui.setup.nextSteps')}</h2>
              <ol>
                <li>
                  <Trans t={t} i18nKey="ui.setup.step1" components={{ code: <code /> }} />
                </li>
                <li>
                  <Trans t={t} i18nKey="ui.setup.step2" components={{ code: <code /> }} />
                </li>
                <li>{t('ui.setup.step3')}</li>
              </ol>
              <div className={styles.warn}>{t('ui.setup.rebuildWarning')}</div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  setStep('accounts')
                  setConfigJson(null)
                }}
              >
                {t('ui.setup.startOver')}
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => configJson && downloadConfig(configJson)}
              >
                {t('ui.setup.downloadAgain')}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => navigate('/')}
              >
                {t('ui.setup.done')}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
