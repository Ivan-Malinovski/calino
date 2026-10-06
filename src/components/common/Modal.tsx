import { type ReactNode, useEffect, useCallback, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import styles from './Modal.module.css'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
  /** Class for the inner content wrapper, e.g. to drop its default padding. */
  contentClassName?: string
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  className,
  contentClassName,
}: ModalProps) {
  const { t } = useTranslation('common')
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, onClose, 200)

  useFocusTrap(dialogRef, rendered && !closing)

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose()
      }
    },
    [requestClose]
  )

  useEffect(() => {
    if (rendered) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [rendered, handleEscape])

  if (!rendered) return null

  return createPortal(
    <div
      className={clsx(styles.overlay, closing && styles.closing)}
      onClick={requestClose}
      data-component="modal-backdrop"
    >
      <div
        ref={dialogRef}
        className={clsx(styles.modal, className)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        data-component="modal-card"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
      >
        {title && (
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={requestClose}
              aria-label={t('actions.close')}
            >
              ×
            </button>
          </div>
        )}
        <div className={clsx(styles.content, contentClassName)}>{children}</div>
      </div>
    </div>,
    document.body
  )
}
