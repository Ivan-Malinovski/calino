import type { JSX } from 'react'
import { useState } from 'react'
import { useSettingsStore, SYNC_INTERVAL_OPTIONS, CONFLICT_OPTIONS } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import styles from './Settings.module.css'

export function CalDAVSettings(): JSX.Element {
  const [isAddingAccount, setIsAddingAccount] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState<string>('')
  const [isTesting, setIsTesting] = useState(false)

  const { syncEnabled, syncIntervalMinutes, conflictResolution, updateSettings } =
    useSettingsStore()

  const { accounts, syncAccount, addAccount, removeAccount } = useCalDAV()

  const handleTestConnection = async (
    serverUrl: string,
    username: string,
    password: string
  ): Promise<boolean> => {
    setIsTesting(true)
    setConnectionStatus('idle')
    setConnectionError('')

    try {
      // First, normalize the URL - try to get base URL
      let baseUrl = serverUrl
      if (serverUrl.includes('/calendars/')) {
        // Extract base URL from calendar URL
        const match = serverUrl.match(/^https?:\/\/[^/]+/)
        if (match) {
          baseUrl = match[0] + '/dav.php'
        }
      }

      const response = await fetch(baseUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: `Basic ${btoa(`${username}:${password}`)}`,
          'Content-Type': 'application/xml',
          Depth: '0',
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <d:propfind xmlns:d="DAV:">
            <d:prop>
              <d:displayname/>
            </d:prop>
          </d:propfind>`,
      })

      const success = response.ok || response.status === 207
      setConnectionStatus(success ? 'success' : 'error')
      if (!success) {
        setConnectionError(`Server returned status ${response.status}`)
      }
      return success
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setConnectionError(
        `Connection failed: ${errorMsg}. This may be a CORS issue - the server must allow cross-origin requests.`
      )
      setConnectionStatus('error')
      return false
    } finally {
      setIsTesting(false)
    }
  }

  const handleAddAccount = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    const serverUrl = formData.get('serverUrl') as string
    const username = formData.get('username') as string
    const password = formData.get('password') as string
    const accountName = (formData.get('accountName') as string) || username

    const success = await handleTestConnection(serverUrl, username, password)
    if (!success) {
      return
    }

    try {
      await addAccount(serverUrl, username, password, accountName)
      setIsAddingAccount(false)
      setConnectionStatus('idle')
      form.reset()
    } catch {
      setConnectionStatus('error')
    }
  }

  const handleDeleteAccount = async (id: string): Promise<void> => {
    if (
      !confirm(
        'Are you sure you want to remove this account? Calendar data will be preserved locally.'
      )
    ) {
      return
    }
    await removeAccount(id)
  }

  const handleSyncNow = async (accountId: string): Promise<void> => {
    await syncAccount(accountId)
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>CalDAV Sync</h2>
      <p className={styles.sectionDescription}>
        Manage your CalDAV accounts and synchronization settings.
      </p>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Enable Sync</span>
          <span className={styles.settingLabelHint}>
            Automatically sync calendars with your server
          </span>
        </div>
        <button
          className={`${styles.toggle} ${syncEnabled ? styles.active : ''}`}
          onClick={() => updateSettings({ syncEnabled: !syncEnabled })}
          aria-pressed={syncEnabled}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Sync Interval</span>
          <span className={styles.settingLabelHint}>How often to check for calendar updates</span>
        </div>
        <select
          className={styles.select}
          value={syncIntervalMinutes}
          onChange={(e) => updateSettings({ syncIntervalMinutes: Number(e.target.value) })}
          disabled={!syncEnabled}
        >
          {SYNC_INTERVAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Conflict Resolution</span>
          <span className={styles.settingLabelHint}>
            How to handle conflicts between local and server data
          </span>
        </div>
        <select
          className={styles.select}
          value={conflictResolution}
          onChange={(e) =>
            updateSettings({
              conflictResolution: e.target.value as 'server-wins' | 'local-wins' | 'ask',
            })
          }
        >
          {CONFLICT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Connected Accounts</span>
          <span className={styles.settingLabelHint}>Manage your CalDAV server connections</span>
        </div>
        <button
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={() => setIsAddingAccount(true)}
        >
          Add Account
        </button>
      </div>

      {accounts.length > 0 && (
        <div className={styles.accountList}>
          {accounts.map((account) => (
            <div key={account.id} className={styles.accountCard}>
              <div className={styles.accountInfo}>
                <span className={styles.accountName}>{account.name}</span>
                <span className={styles.accountUrl}>{account.serverUrl}</span>
                {account.lastSyncAt && (
                  <span className={styles.syncStatus}>
                    Last synced: {new Date(account.lastSyncAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className={styles.accountActions}>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => handleSyncNow(account.id)}
                >
                  Sync Now
                </button>
                <button
                  className={`${styles.button} ${styles.buttonDanger}`}
                  onClick={() => handleDeleteAccount(account.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAddingAccount && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Add CalDAV Account</h3>
              <button
                className={styles.modalClose}
                onClick={() => {
                  setIsAddingAccount(false)
                  setConnectionStatus('idle')
                }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddAccount}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Account Name</label>
                <input
                  name="accountName"
                  className={styles.input}
                  placeholder="My Calendar Server"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Server URL</label>
                <input
                  name="serverUrl"
                  className={styles.input}
                  placeholder="https://caldav.example.com"
                  required
                />
                <span className={styles.formHint}>Enter the full URL of your CalDAV server</span>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Username</label>
                <input name="username" className={styles.input} required />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Password</label>
                <input name="password" type="password" className={styles.input} required />
              </div>
              {connectionStatus === 'success' && (
                <p style={{ color: '#34a853', fontSize: '14px', marginBottom: '16px' }}>
                  ✓ Connection successful!
                </p>
              )}
              {connectionStatus === 'error' && (
                <p style={{ color: '#ea4335', fontSize: '14px', marginBottom: '16px' }}>
                  ✕{' '}
                  {connectionError ||
                    'Connection failed. Please check your credentials and server URL.'}
                </p>
              )}
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => {
                    setIsAddingAccount(false)
                    setConnectionStatus('idle')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  disabled={isTesting}
                >
                  {isTesting ? 'Testing...' : 'Add Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
