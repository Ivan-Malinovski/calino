import type { JSX } from 'react'
import { useState, useEffect, useRef } from 'react'
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
      setError('Calendar name is required')
      return
    }

    if (!accountId) {
      setError('No CalDAV account selected')
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
          ? `Couldn't create the calendar: ${syncErrorReason(classifySyncError(err.message), err.message)}`
          : 'Failed to create calendar.'
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
            Create Calendar
          </h3>
          <button className={styles.modalClose} onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {selectedAccount && (
            <div className={styles.formGroup}>
              <span className={styles.formHint}>Creating on: {selectedAccount.name}</span>
            </div>
          )}
          <div className={styles.formGroup}>
            <label htmlFor="calendarName" className={styles.formLabel}>
              Calendar Name
            </label>
            <input
              id="calendarName"
              name="calendarName"
              className={styles.input}
              placeholder="My Calendar"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="calendarDescription" className={styles.formLabel}>
              Description (optional)
            </label>
            <input
              id="calendarDescription"
              name="calendarDescription"
              className={styles.input}
              placeholder="Work meetings, personal events, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Color</label>
            <div className={styles.colorGrid}>
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorOption} ${color === c ? styles.colorSelected : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Select color ${c}`}
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
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={isCreating || !name.trim()}
            >
              {isCreating ? 'Creating...' : 'Create Calendar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
