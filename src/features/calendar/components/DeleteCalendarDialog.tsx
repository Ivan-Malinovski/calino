import type { JSX } from 'react'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
            Delete Calendar
          </h3>
          <button className={styles.closeButton} onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.calendarName}>
            You are about to delete the calendar <strong>“{calendarName}”</strong>.
          </p>

          {eventCount > 0 && (
            <p className={styles.warning}>
              This will permanently delete{' '}
              <strong>
                {eventCount} event{eventCount !== 1 ? 's' : ''}
              </strong>{' '}
              from both Calino and the server. This action cannot be undone.
            </p>
          )}

          <p className={styles.confirmLabel}>Type the calendar name to confirm:</p>
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
            Cancel
          </button>
          <button
            className={styles.deleteButton}
            onClick={handleConfirm}
            disabled={confirmText !== calendarName}
            style={{ opacity: confirmText !== calendarName ? 0.5 : 1 }}
          >
            Delete Calendar
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
