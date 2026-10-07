import type { JSX } from 'react'
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import styles from '@/features/calendar/components/DeleteDialog.module.css'

interface PurgeCalendarDialogProps {
  isOpen: boolean
  calendarName: string
  eventCount: number
  /** Whether the calendar lives on a CalDAV server, so the delete reaches it too. */
  isRemote: boolean
  isDeleting: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Mount it only while open: the typed name lives in state, which the parent
 * resets by unmounting.
 *
 * Last-chance prompt before every event in a calendar is deleted. Mirrors
 * DeleteCalendarDialog: the user has to type the calendar name, so a stray
 * click or Enter can't wipe a calendar.
 */
export function PurgeCalendarDialog({
  isOpen,
  calendarName,
  eventCount,
  isRemote,
  isDeleting,
  onClose,
  onConfirm,
}: PurgeCalendarDialogProps): JSX.Element | null {
  const { t } = useTranslation(['settings', 'common'])
  const [confirmText, setConfirmText] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  const canConfirm = confirmText === calendarName && !isDeleting

  const handleClose = (): void => {
    if (!isDeleting) onClose()
  }

  useModalDismiss(dialogRef, isOpen, handleClose)

  if (!isOpen) return null

  return createPortal(
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="purge-calendar-title"
        data-component="purge-calendar-dialog"
      >
        <div className={styles.header}>
          <h3 className={styles.title} id="purge-calendar-title">
            {t('data.purgeCalendar.dialog.title')}
          </h3>
          <button
            className={styles.closeButton}
            onClick={handleClose}
            aria-label={t('common:actions.close')}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.calendarName}>
            <Trans
              t={t}
              i18nKey="data.purgeCalendar.dialog.message"
              values={{ calendarName }}
              components={{ strong: <strong /> }}
            />
          </p>
          <p className={styles.warning}>
            <Trans
              t={t}
              i18nKey={
                isRemote
                  ? 'data.purgeCalendar.dialog.warningRemote'
                  : 'data.purgeCalendar.dialog.warningLocal'
              }
              count={eventCount}
              components={{ strong: <strong /> }}
            />
          </p>

          <p className={styles.confirmLabel}>{t('data.purgeCalendar.dialog.typeToConfirm')}</p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={calendarName}
            autoFocus
            className={styles.confirmInput}
            aria-label={t('data.purgeCalendar.dialog.typeToConfirm')}
            data-component="purge-calendar-confirm-input"
          />
        </div>

        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={handleClose}
            disabled={isDeleting}
            type="button"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            className={styles.deleteButton}
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{ opacity: canConfirm ? 1 : 0.5 }}
            data-component="purge-calendar-confirm"
            type="button"
          >
            {isDeleting
              ? t('data.purgeCalendar.dialog.deleting')
              : t('data.purgeCalendar.dialog.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
