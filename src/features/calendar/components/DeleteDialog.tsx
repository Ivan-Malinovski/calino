import type { JSX } from 'react'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import type { RecurrenceEditMode } from '@/types'
import styles from './DeleteDialog.module.css'

interface DeleteDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (mode: RecurrenceEditMode) => void
  /** Word the choices as "tasks" rather than "events". */
  isTask?: boolean
}

export function DeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  isTask = false,
}: DeleteDialogProps): JSX.Element | null {
  const { t } = useTranslation(['calendar', 'common'])
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
            {t('modals.deleteDialog.title', { context })}
          </h2>
          <button
            className={styles.closeButton}
            onClick={requestClose}
            aria-label={t('common:actions.close')}
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
          <p className={styles.message}>{t('modals.deleteDialog.message', { context })}</p>
          <div className={styles.buttons}>
            <button type="button" className={styles.deleteButton} onClick={() => onConfirm('all')}>
              {t('modals.deleteDialog.all', { context })}
            </button>
            <button type="button" className={styles.deleteButton} onClick={() => onConfirm('this')}>
              {t('modals.deleteDialog.thisOnly', { context })}
            </button>
            <button
              type="button"
              className={styles.deleteButton}
              onClick={() => onConfirm('future')}
            >
              {t('modals.deleteDialog.thisAndFollowing', { context })}
            </button>
            <button type="button" className={styles.cancelButton} onClick={requestClose}>
              {t('common:actions.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
