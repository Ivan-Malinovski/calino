import type { JSX } from 'react'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import styles from './UnsavedChangesDialog.module.css'

interface UnsavedChangesDialogProps {
  isOpen: boolean
  /** Dismissed without choosing: Escape, a click outside, or "Keep editing". */
  onKeepEditing: () => void
  onDiscard: () => void
  onSave: () => void
  /** False when the form can't be saved as it stands (no title, read-only calendar). */
  canSave: boolean
}

/**
 * Asked when an event editor with unsaved changes is dismissed by a click
 * outside or Escape. Same wording and choices as the Android app's
 * "Save your changes?" prompt.
 */
export function UnsavedChangesDialog({
  isOpen,
  onKeepEditing,
  onDiscard,
  onSave,
  canSave,
}: UnsavedChangesDialogProps): JSX.Element | null {
  const { t } = useTranslation('calendar')
  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, onKeepEditing, 150)
  const modalRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalDismiss(modalRef, rendered && !closing, requestClose)

  if (!rendered) return null

  return (
    <div
      className={`${styles.overlay} ${closing ? styles.closing : ''}`}
      onClick={requestClose}
      data-component="unsaved-changes-overlay"
    >
      <div
        ref={modalRef}
        className={styles.modal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        data-component="unsaved-changes-dialog"
      >
        <div className={styles.content}>
          <h2 id={titleId} className={styles.title}>
            {t('modals.unsavedChangesDialog.title')}
          </h2>
          <p className={styles.message}>{t('modals.unsavedChangesDialog.message')}</p>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.saveButton}
              onClick={onSave}
              disabled={!canSave}
              data-component="unsaved-changes-save"
            >
              {t('modals.unsavedChangesDialog.save')}
            </button>
            <button
              type="button"
              className={styles.discardButton}
              onClick={onDiscard}
              aria-label={t('modals.unsavedChangesDialog.discardDescription')}
              data-component="unsaved-changes-discard"
            >
              {t('modals.unsavedChangesDialog.discard')}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={requestClose}
              data-component="unsaved-changes-keep-editing"
            >
              {t('modals.unsavedChangesDialog.keepEditing')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
