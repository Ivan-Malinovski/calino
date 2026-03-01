import type { JSX } from 'react'
import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSettingsStore, SYNC_INTERVAL_OPTIONS, CONFLICT_OPTIONS } from '@/store/settingsStore'
import * as accountStorage from '@/features/caldav/sync/accountStorage'
import type { CalDAVAccount } from '@/features/caldav/types'
import styles from './Settings.module.css'

export function CalDAVSettings(): JSX.Element {
  const [accounts, setAccounts] = useState<CalDAVAccount[]>([])
  const [isAddingAccount, setIsAddingAccount] = useState(false)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const { syncEnabled, syncIntervalMinutes, conflictResolution, updateSettings } =
    useSettingsStore()

  useEffect(() => {
    setAccounts(accountStorage.getAllAccounts())
  }, [])

  const handleTestConnection = async (
    serverUrl: string,
    username: string,
    password: string
  ): Promise<boolean> => {
    setIsTestingConnection(true)
    setConnectionStatus('idle')

    try {
      const response = await fetch(serverUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: `Basic ${btoa(`${username}:${password}`)}`,
          'Content-Type': 'application/xml',
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
      return success
    } catch {
      setConnectionStatus('error')
      return false
    } finally {
      setIsTestingConnection(false)
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

    const newAccount = accountStorage.saveAccount({
      name: accountName,
      serverUrl,
      username,
      credentialId: uuidv4(),
    })

    setAccounts((prev) => [...prev, newAccount])
    setIsAddingAccount(false)
    setConnectionStatus('idle')
    form.reset()
  }

  const handleDeleteAccount = (id: string): void => {
    if (
      !confirm(
        'Are you sure you want to remove this account? Calendar data will be preserved locally.'
      )
    ) {
      return
    }
    accountStorage.deleteAccount(id)
    accountStorage.deleteCalendarsByAccountId(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  const handleSyncNow = async (accountId: string): Promise<void> => {
    console.log('Manual sync triggered for account:', accountId)
    accountStorage.updateAccountLastSync(accountId)
    setAccounts(accountStorage.getAllAccounts())
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
                  ✕ Connection failed. Please check your credentials.
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
                  disabled={isTestingConnection}
                >
                  {isTestingConnection ? 'Testing...' : 'Add Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
