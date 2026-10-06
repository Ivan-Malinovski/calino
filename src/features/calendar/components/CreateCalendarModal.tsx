import type { JSX } from 'react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { EVENT_COLORS } from '@/store/settingsStore'
import { classifySyncError, syncErrorReason } from '@/features/caldav/client/errorMessages'
import styles from './AddCalendarModal.module.css'

interface CreateCalendarModalProps {
  isOpen: boolean
  onClose: () => void
  accountId?: string | null
}

export function CreateCalendarModal({
  isOpen,
  onClose,
  accountId,
}: CreateCalendarModalProps): JSX.Element | null {
  const { t } = useTranslation('calendar')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(EVENT_COLORS[0])
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const { accounts, createCalendar } = useCalDAV()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName('')
      setDescription('')
      setColor(EVENT_COLORS[0])
      setError('')
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()

    if (!name.trim()) {
      setError(t('ui.calModal.nameRequired'))
      return
    }

    if (!accountId) {
      setError(t('ui.calModal.noAccount'))
      return
    }

    setIsCreating(true)
    setError('')

    try {
      await createCalendar(accountId, {
        name: name.trim(),
        description: description.trim() || undefined,
        color,
      })
      handleClose()
    } catch (err) {
      setError(
        err instanceof Error
          ? t('ui.calModal.createFailedReason', {
              reason: syncErrorReason(classifySyncError(err.message), err.message),
            })
          : t('ui.calModal.createFailed')
      )
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = (): void => {
    setName('')
    setDescription('')
    setColor(EVENT_COLORS[0])
    setError('')
    onClose()
  }

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  useModalDismiss(dialogRef, isOpen, handleClose)

  if (!isOpen) {
    return null
  }

  const selectedAccount = accounts.find((a) => a.id === accountId)

  return createPortal(
    <div className={styles.modal} onClick={handleBackdropClick}>
      <div
        ref={dialogRef}
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle} id="modal-title">
            {t('ui.calModal.createTitle')}
          </h3>
          <button
            className={styles.modalClose}
            onClick={handleClose}
            aria-label={t('surface.close')}
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {selectedAccount && (
            <div className={styles.formGroup}>
              <span className={styles.formHint}>
                {t('ui.calModal.creatingOn', { name: selectedAccount.name })}
              </span>
            </div>
          )}
          <div className={styles.formGroup}>
            <label htmlFor="calendarName" className={styles.formLabel}>
              {t('ui.calModal.calendarName')}
            </label>
            <input
              id="calendarName"
              name="calendarName"
              className={styles.input}
              placeholder={t('surface.calendarNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="calendarDescription" className={styles.formLabel}>
              {t('ui.calModal.descriptionOptional')}
            </label>
            <input
              id="calendarDescription"
              name="calendarDescription"
              className={styles.input}
              placeholder={t('surface.calendarDescriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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
                  aria-label={t('ui.calModal.selectColor', { color: c })}
                />
              ))}
            </div>
          </div>
          {error && <p className={styles.errorMessage}>{error}</p>}
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleClose}
            >
              {t('actions.cancel', { ns: 'common' })}
            </button>
            <button
              type="submit"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={isCreating || !name.trim()}
            >
              {isCreating ? t('ui.calModal.creating') : t('ui.calModal.createTitle')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
