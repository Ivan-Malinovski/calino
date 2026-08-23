import type { JSX } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useWebcalSubscriptions } from '@/features/webcal/hooks/useWebcalSubscriptions'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { EVENT_COLORS } from '@/store/settingsStore'
import { classifySyncError, syncErrorReason } from '@/features/caldav/client/errorMessages'
import styles from './AddCalendarModal.module.css'

interface SubscribeCalendarModalProps {
  isOpen: boolean
  onClose: () => void
}

const REFRESH_OPTIONS = [
  { label: 'Every 15 minutes', minutes: 15 },
  { label: 'Every 30 minutes', minutes: 30 },
  { label: 'Every hour', minutes: 60 },
  { label: 'Every 6 hours', minutes: 360 },
  { label: 'Every 24 hours', minutes: 1440 },
]

export function SubscribeCalendarModal({
  isOpen,
  onClose,
}: SubscribeCalendarModalProps): JSX.Element | null {
  const { t } = useTranslation('calendar')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState<string>(EVENT_COLORS[0])
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(60)
  const [showProxyField, setShowProxyField] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const { addSubscription } = useWebcalSubscriptions()
  const formRef = useRef<HTMLFormElement>(null)
  const isSavingRef = useRef(false)

  const resetForm = (): void => {
    setName('')
    setUrl('')
    setColor(EVENT_COLORS[0])
    setRefreshIntervalMinutes(60)
    setShowProxyField(false)
    setProxyUrl('')
    setError('')
  }

  const doClose = useCallback((): void => {
    resetForm()
    onClose()
  }, [onClose])
  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, doClose, 200)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalDismiss(dialogRef, rendered && !closing, requestClose)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (isSavingRef.current) return
    if (!url.trim()) {
      setError('Enter a calendar URL.')
      return
    }

    isSavingRef.current = true
    setIsSaving(true)
    setError('')

    try {
      await addSubscription({
        url: url.trim(),
        name: name.trim() || 'Subscribed calendar',
        color,
        refreshIntervalMinutes,
        proxyUrl: proxyUrl.trim() || undefined,
      })
      requestClose()
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't subscribe: ${syncErrorReason(classifySyncError(err.message), err.message)}`
          : 'Failed to subscribe to calendar.'
      )
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
        aria-labelledby="subscribe-modal-title"
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle} id="subscribe-modal-title">
            Subscribe to Calendar
          </h3>
          <button className={styles.modalClose} onClick={requestClose} aria-label={t('surface.close')}>
            ✕
          </button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="subscribeName" className={styles.formLabel}>
              Name (optional)
            </label>
            <input
              id="subscribeName"
              className={styles.input}
              placeholder={t('surface.subscriptionNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="subscribeUrl" className={styles.formLabel}>
              Calendar URL
            </label>
            <input
              id="subscribeUrl"
              className={styles.input}
              placeholder={t('surface.webcalUrlPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <span className={styles.formHint}>
              This calendar is read-only — events are refreshed periodically and can&apos;t be
              edited in Calino.
            </span>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="subscribeRefresh" className={styles.formLabel}>
              Refresh
            </label>
            <select
              id="subscribeRefresh"
              className={styles.input}
              value={refreshIntervalMinutes}
              onChange={(e) => setRefreshIntervalMinutes(Number(e.target.value))}
            >
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t('surface.color')}</label>
            <div className={styles.colorGrid}>
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorOption} ${color === c ? styles.colorSelected : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Select color ${c}`}
                />
              ))}
            </div>
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
              <span>{t('surface.proxyUrlOptional')}</span>
            </button>
            {showProxyField && (
              <>
                <input
                  id="subscribeProxyUrl"
                  className={styles.input}
                placeholder={t('surface.proxyUrlPlaceholder')}
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                />
                <span className={styles.proxyInfoText}>
                  Only needed if the calendar host doesn&apos;t allow cross-origin requests. Your
                  request goes through the proxy server instead of directly to the host.
                </span>
              </>
            )}
          </div>
          {error && <p className={styles.errorMessage}>{error}</p>}
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={requestClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={isSaving}
              aria-busy={isSaving}
              data-component="modal-save"
            >
              {isSaving && <span className={styles.buttonSpinner} aria-hidden="true" />}
              <span>{isSaving ? 'Subscribing…' : 'Subscribe'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
