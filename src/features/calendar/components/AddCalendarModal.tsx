import type { JSX } from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import styles from './AddCalendarModal.module.css'

interface AddCalendarModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AddCalendarModal({ isOpen, onClose }: AddCalendarModalProps): JSX.Element | null {
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState<string>('')
  const [isTesting, setIsTesting] = useState(false)

  const { addAccount } = useCalDAV()

  const handleTestConnection = async (
    serverUrl: string,
    username: string,
    password: string,
    proxyUrl?: string
  ): Promise<boolean> => {
    setIsTesting(true)
    setConnectionStatus('idle')
    setConnectionError('')

    try {
      let baseUrl = serverUrl
      if (serverUrl.includes('/calendars/')) {
        const match = serverUrl.match(/^https?:\/\/[^/]+/)
        if (match) {
          baseUrl = match[0] + '/dav.php'
        }
      }

      if (proxyUrl) {
        const encodedTarget = encodeURIComponent(baseUrl)
        const proxyBase = proxyUrl.replace(/\/$/, '')
        baseUrl = `${proxyBase}/${encodedTarget}`
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    const serverUrl = formData.get('serverUrl') as string
    const username = formData.get('username') as string
    const password = formData.get('password') as string
    const accountName = (formData.get('accountName') as string) || username
    const proxyUrl = (formData.get('proxyUrl') as string) || undefined

    const success = await handleTestConnection(serverUrl, username, password, proxyUrl)
    if (!success) {
      return
    }

    try {
      await addAccount(serverUrl, username, password, accountName, proxyUrl)
      handleClose()
    } catch {
      setConnectionStatus('error')
      setConnectionError('Failed to add account. Please try again.')
    }
  }

  const handleClose = (): void => {
    setConnectionStatus('idle')
    setConnectionError('')
    onClose()
  }

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  if (!isOpen) {
    return null
  }

  return createPortal(
    <div className={styles.modal} onClick={handleBackdropClick}>
      <div
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle} id="modal-title">
            Add CalDAV Calendar
          </h3>
          <button className={styles.modalClose} onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="accountName" className={styles.formLabel}>
              Account Name (optional)
            </label>
            <input
              id="accountName"
              name="accountName"
              className={styles.input}
              placeholder="My Calendar Server"
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
              required
            />
            <span className={styles.formHint}>Enter the full URL of your CalDAV server</span>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="proxyUrl" className={styles.formLabel}>
              Proxy URL (optional)
            </label>
            <input
              id="proxyUrl"
              name="proxyUrl"
              className={styles.input}
              placeholder="https://proxy.calino.io"
            />
            <span className={styles.formHint}>
              Use proxy.calino.io if your server doesn't support CORS
            </span>
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
              required
            />
          </div>
          {connectionStatus === 'success' && (
            <p className={styles.successMessage}>✓ Connection successful!</p>
          )}
          {connectionStatus === 'error' && (
            <p className={styles.errorMessage}>
              ✕{' '}
              {connectionError ||
                'Connection failed. Please check your credentials and server URL.'}
            </p>
          )}
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={isTesting}
            >
              {isTesting ? 'Testing...' : 'Add Calendar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
