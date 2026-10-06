import type { JSX } from 'react'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import type { RecurrenceEditMode } from '@/types'
import styles from './RecurrenceDialog.module.css'

interface RecurrenceDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (mode: RecurrenceEditMode) => void
  /** Word the choices as "tasks" rather than "events". */
  isTask?: boolean
}

export function RecurrenceDialog({
  isOpen,
  onClose,
  onConfirm,
  isTask = false,
}: RecurrenceDialogProps): JSX.Element | null {
  const { t } = useTranslation('calendar')
  const context = isTask ? 'task' : 'event'
  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, onClose, 150)
  const modalRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalDismiss(modalRef, rendered && !closing, requestClose)

  if (!rendered) return null

  return (
    <div className={`${styles.overlay} ${closing ? styles.closing : ''}`} onClick={requestClose}>
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {t('ui.recurrence.title', { context })}
          </h2>
          <button
            className={styles.closeButton}
            onClick={requestClose}
            aria-label={t('surface.close')}
          >
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
          <p className={styles.message}>{t('surface.recurrenceApplyChanges')}</p>
          <div className={styles.buttons}>
            <button type="button" className={styles.actionButton} onClick={() => onConfirm('all')}>
              {t('ui.recurrence.all', { context })}
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onConfirm('future')}
            >
              {t('ui.recurrence.future', { context })}
            </button>
            <button type="button" className={styles.actionButton} onClick={() => onConfirm('this')}>
              {t('ui.recurrence.this', { context })}
            </button>
            <button type="button" className={styles.cancelButton} onClick={requestClose}>
              {t('actions.cancel', { ns: 'common' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
