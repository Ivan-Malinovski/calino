import type { JSX } from 'react'
import styles from './EventModal.module.css'

type RecurrenceEditMode = 'all' | 'future' | 'this'

interface RecurrenceDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (mode: RecurrenceEditMode) => void
}

export function RecurrenceDialog({
  isOpen,
  onClose,
  onConfirm,
}: RecurrenceDialogProps): JSX.Element | null {
  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Update recurring event</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className={styles.form}>
          <p style={{ padding: '16px', color: '#666' }}>
            How would you like to apply these changes?
          </p>
          <div className={styles.field} style={{ padding: '0 16px 16px' }}>
            <button
              type="button"
              className={styles.saveButton}
              style={{ width: '100%', marginBottom: '8px' }}
              onClick={() => onConfirm('all')}
            >
              All events
            </button>
            <button
              type="button"
              className={styles.saveButton}
              style={{ width: '100%', marginBottom: '8px' }}
              onClick={() => onConfirm('this')}
            >
              This event only
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              style={{ width: '100%' }}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
