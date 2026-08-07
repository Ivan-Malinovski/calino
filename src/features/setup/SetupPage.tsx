import type { JSX } from 'react'
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { encryptWithMasterPassword } from '@/lib/crypto'
import { probeConnection } from '@/features/caldav/client/discovery'
import { connectionErrorMessage } from '@/features/caldav/client/errorMessages'
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

  // Wizard state
  const [step, setStep] = useState<Step>('accounts')

  // Account form state
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formProxy, setFormProxy] = useState('')
  const [showProxy, setShowProxy] = useState(false)
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
    setTestStatus('testing')
    setTestError('')
    setTestHint('')
    setShowDiagnostics(false)
    const proxyUrl = formProxy || undefined
    // Shared with the Add Calendar dialog rather than probed separately here:
    // this page had its own copy that missed the redirect fallbacks and the
    // provider-specific hints, so setup was the least helpful surface.
    const result = await probeConnection(formUrl, formUsername, formPassword, proxyUrl)
    setTestStatus(result.ok ? 'success' : 'error')
    if (result.ok) {
      setDiagnoseTarget(null)
    } else {
      setTestError(connectionErrorMessage(result.error ?? 'Connection failed.'))
      if (result.hint) setTestHint(result.hint)
      setDiagnoseTarget({
        serverUrl: formUrl,
        username: formUsername,
        password: formPassword,
        proxyUrl,
      })
    }
  }, [formUrl, formUsername, formPassword, formProxy])

  const handleAddAccount = useCallback(() => {
    if (!formUrl || !formUsername || !formPassword) return
    setAccounts((prev) => [
      ...prev,
      {
        name: formName.trim() || formUsername,
        url: formUrl.trim(),
        username: formUsername.trim(),
        password: formPassword,
        proxyUrl: formProxy.trim() || undefined,
      },
    ])
    // Reset form
    setFormName('')
    setFormUrl('')
    setFormUsername('')
    setFormPassword('')
    setFormProxy('')
    setShowProxy(false)
    setTestStatus('idle')
    setTestError('')
  }, [formName, formUrl, formUsername, formPassword, formProxy])

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
      setPasswordError('Passwords do not match.')
      return
    }
    if (masterPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.')
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
        configAccounts.push({
          name: account.name,
          url: encryptedUrl,
          username: encryptedUsername,
          password: encryptedPassword,
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
      setPasswordError(err instanceof Error ? err.message : 'Encryption failed.')
    } finally {
      setGenerating(false)
    }
  }, [accounts, webcalSubscriptions, masterPassword, masterConfirm, downloadConfig])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.logo}>📅</div>
          <h1 className={styles.title}>Calino Setup</h1>
          <p className={styles.subtitle}>
            Generate a configuration file for your self-hosted Calino instance.
          </p>
        </div>

        {/* Step indicator */}
        <div className={styles.steps}>
          <div
            className={`${styles.step} ${step === 'accounts' ? styles.stepActive : styles.stepDone}`}
          >
            <span className={styles.stepDot}>{step === 'accounts' ? '1' : '✓'}</span>
            <span>Accounts</span>
          </div>
          <div className={`${styles.stepSep} ${step !== 'accounts' ? styles.stepDone : ''}`} />
          <div
            className={`${styles.step} ${step === 'password' ? styles.stepActive : step === 'done' ? styles.stepDone : ''}`}
          >
            <span className={styles.stepDot}>{step === 'done' ? '✓' : '2'}</span>
            <span>Password</span>
          </div>
          <div className={`${styles.stepSep} ${step === 'done' ? styles.stepDone : ''}`} />
          <div className={`${styles.step} ${step === 'done' ? styles.stepActive : ''}`}>
            <span className={styles.stepDot}>3</span>
            <span>Download</span>
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
                      aria-label={`Remove ${acc.name}`}
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
                Account Name
              </label>
              <input
                id="setup-name"
                className={styles.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Personal, Work"
              />
              <div className={styles.hint}>Optional — defaults to username</div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-url">
                Server URL
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
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-username">
                Username
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
                Password
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
              />
            </div>

            <button
              type="button"
              className={styles.proxyToggle}
              onClick={() => setShowProxy(!showProxy)}
            >
              <svg
                style={{ transform: showProxy ? 'rotate(0deg)' : 'rotate(-90deg)' }}
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
              Proxy URL (optional)
            </button>

            {showProxy && (
              <div className={styles.field}>
                <input
                  className={styles.input}
                  value={formProxy}
                  onChange={(e) => setFormProxy(e.target.value)}
                  placeholder="https://proxy.example.com"
                />
                <div className={styles.hint}>
                  Requests go through this proxy. Your CalDAV credentials will be visible to the
                  proxy provider.
                </div>
              </div>
            )}

            {testStatus === 'success' && (
              <div className={styles.success}>✓ Connection successful</div>
            )}
            {testStatus === 'error' && (
              <>
                <div className={styles.error}>✕ {testError}</div>
                {testHint && <div className={styles.hint}>{testHint}</div>}
                {diagnoseTarget && !showDiagnostics && (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-action="show-diagnostics"
                    onClick={() => setShowDiagnostics(true)}
                  >
                    Run diagnostics to find out why
                  </button>
                )}
              </>
            )}
            {showDiagnostics && diagnoseTarget && (
              <DiagnosticsPanel options={diagnoseTarget} autoRun />
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                onClick={handleTest}
                disabled={!formUrl || !formUsername || !formPassword || testStatus === 'testing'}
              >
                {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleAddAccount}
                disabled={!formUrl || !formUsername || !formPassword}
              >
                Add Account
              </button>
            </div>

            <hr
              style={{
                margin: '24px 0',
                border: 'none',
                borderTop: '1px solid var(--modal-border, #e0e0e0)',
              }}
            />
            <h3 style={{ marginBottom: 12 }}>Calendar Subscriptions (.ics)</h3>

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
                      aria-label={`Remove ${sub.name}`}
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
                Name
              </label>
              <input
                id="setup-webcal-name"
                className={styles.input}
                value={webcalFormName}
                onChange={(e) => setWebcalFormName(e.target.value)}
                placeholder="e.g. Holidays"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-webcal-url">
                Calendar URL
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
                Refresh interval (minutes)
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
              Proxy URL (optional)
            </button>

            {showWebcalProxy && (
              <div className={styles.field}>
                <input
                  className={styles.input}
                  value={webcalFormProxy}
                  onChange={(e) => setWebcalFormProxy(e.target.value)}
                  placeholder="https://proxy.example.com"
                />
                <div className={styles.hint}>
                  Only needed if the calendar host doesn&apos;t allow cross-origin requests.
                </div>
              </div>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleAddWebcal}
                disabled={!webcalFormUrl || !webcalFormName}
              >
                Add Subscription
              </button>
            </div>

            {(accounts.length > 0 || webcalSubscriptions.length > 0) && (
              <div className={styles.actions} style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => setStep('password')}
                >
                  Next →
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
                Master Password
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
                placeholder="Choose a strong password"
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
              <div className={styles.hint}>
                This password will be used to unlock your calendars in Calino.
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="setup-confirm">
                Confirm Password
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
                placeholder="Type it again"
              />
            </div>

            {passwordError && <div className={styles.error}>{passwordError}</div>}

            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => setStep('accounts')}>
                ← Back
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSuccess}`}
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'Encrypting…' : 'Generate Config'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Download ────────────────────────────────────────── */}
        {step === 'done' && (
          <>
            <div className={styles.instructions}>
              <h3>Next steps</h3>
              <ol>
                <li>
                  Place <code>calino.config.json</code> in the project root
                </li>
                <li>
                  Rebuild: <code>docker compose up -d --build</code>
                </li>
                <li>Open Calino and enter your master password</li>
              </ol>
              <div className={styles.warn}>
                ⚠️ The config is baked into the JS bundle at build time. You must rebuild for
                changes to take effect.
              </div>
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
                ← Start Over
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => configJson && downloadConfig(configJson)}
              >
                Download Again
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => navigate('/')}
              >
                Done →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
