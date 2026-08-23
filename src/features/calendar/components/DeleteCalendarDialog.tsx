import type { JSX } from 'react'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useCalendarStore } from '@/store/calendarStore'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import styles from './DeleteDialog.module.css'

interface DeleteCalendarDialogProps {
  isOpen: boolean
  calendarId: string | null
  calendarName: string
  onClose: () => void
  onConfirm: () => void
}

export function DeleteCalendarDialog({
  isOpen,
  calendarId,
  calendarName,
  onClose,
  onConfirm,
}: DeleteCalendarDialogProps): JSX.Element | null {
  const { t } = useTranslation(['calendar', 'common'])
  const [confirmText, setConfirmText] = useState('')
  const events = useCalendarStore((state) => state.events)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setConfirmText('')
    }
  }, [isOpen])

  const eventCount = calendarId ? events.filter((e) => e.calendarId === calendarId).length : 0

  const handleConfirm = (): void => {
    if (confirmText === calendarName) {
      onConfirm()
      handleClose()
    }
  }

  const handleClose = (): void => {
    setConfirmText('')
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

  return createPortal(
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
      >
        <div className={styles.header}>
          <h3 className={styles.title} id="delete-dialog-title">
            {t('modals.deleteCalendar.title')}
          </h3>
          <button
            className={styles.closeButton}
            onClick={handleClose}
            aria-label={t('common:actions.close')}
          >
            ✕
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.calendarName}>
            <Trans
              t={t}
              i18nKey="modals.deleteCalendar.confirmMessage"
              values={{ calendarName }}
              components={{ strong: <strong /> }}
            />
          </p>

          {eventCount > 0 && (
            <p className={styles.warning}>
              <Trans
                t={t}
                i18nKey="modals.deleteCalendar.warning"
                count={eventCount}
                components={{ strong: <strong /> }}
              />
            </p>
          )}

          <p className={styles.confirmLabel}>{t('modals.deleteCalendar.typeToConfirm')}</p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={calendarName}
            autoFocus
            className={styles.confirmInput}
          />
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={handleClose}>
            {t('common:actions.cancel')}
          </button>
          <button
            className={styles.deleteButton}
            onClick={handleConfirm}
            disabled={confirmText !== calendarName}
            style={{ opacity: confirmText !== calendarName ? 0.5 : 1 }}
          >
            {t('modals.deleteCalendar.title')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
