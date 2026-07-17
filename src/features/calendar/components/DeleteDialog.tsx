import type { JSX } from 'react'
import { useRef } from 'react'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import styles from './DeleteDialog.module.css'

type RecurrenceEditMode = 'all' | 'future' | 'this'

interface DeleteDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (mode: RecurrenceEditMode) => void
}

export function DeleteDialog({
  isOpen,
  onClose,
  onConfirm,
}: DeleteDialogProps): JSX.Element | null {
  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, onClose, 150)
  const modalRef = useRef<HTMLDivElement>(null)
  useModalDismiss(modalRef, rendered && !closing, requestClose)

  if (!rendered) return null

  return (
    <div
      className={`${styles.overlay} ${closing ? styles.closing : ''}`}
      onClick={requestClose}
    >
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Delete recurring event</h2>
          <button className={styles.closeButton} onClick={requestClose} aria-label="Close">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className={styles.content}>
          <p className={styles.message}>How would you like to delete this event?</p>
          <div className={styles.buttons}>
            <button type="button" className={styles.deleteButton} onClick={() => onConfirm('all')}>
              All events
            </button>
            <button type="button" className={styles.deleteButton} onClick={() => onConfirm('this')}>
              This event only
            </button>
            <button type="button" className={styles.deleteButton} onClick={() => onConfirm('future')}>
              This and following events
            </button>
            <button type="button" className={styles.cancelButton} onClick={requestClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
