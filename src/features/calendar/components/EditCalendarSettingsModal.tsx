import type { JSX } from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useCalendarStore } from '@/store/calendarStore'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import styles from './AddCalendarModal.module.css'

interface EditCalendarSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  calendarId: string
}

export function EditCalendarSettingsModal({
  isOpen,
  onClose,
  calendarId,
}: EditCalendarSettingsModalProps): JSX.Element | null {
  const { t } = useTranslation(['calendar', 'settings'])
  const calendars = useCalendarStore((state) => state.calendars)
  const updateCalendar = useCalendarStore((state) => state.updateCalendar)
  const dialogRef = useRef<HTMLDivElement>(null)
  
  const calendar = calendars.find((c) => c.id === calendarId)
  useModalDismiss(dialogRef, isOpen, onClose)

  if (!isOpen || !calendar) return null

  const isRolling = calendar.taskCompletionMode === 'rolling'

  return createPortal(
    <div className={styles.overlay}>
      <div
        className={styles.modal}
        ref={dialogRef}
        role="dialog"
        aria-labelledby="calendar-settings-title"
      >
        <div className={styles.header}>
          <h2 id="calendar-settings-title" className={styles.title}>
            {t('views.sidebar.calendarSettings', { defaultValue: 'Calendar Settings' })}
          </h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('common:actions.close')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.field}>
            <label className={styles.label}>
              {t('settings:tasks.rollingTaskCompletion.label', { defaultValue: 'Rolling completion for mobile sync' })}
            </label>
            <div className={styles.hint}>
              {t('settings:tasks.rollingTaskCompletion.desc', { defaultValue: 'Move a recurring task to its next date and save each completed occurrence as its own task. Required for two-way sync with DAVx⁵/OpenTasks, Tasks.org, and Apple Reminders.' })}
              {' '}
              <a href="https://github.com/Ivan-Malinovski/calino/blob/main/docs/RECURRING_TASKS.md" target="_blank" rel="noreferrer" className={styles.link}>
                {t('common:actions.learnMore', { defaultValue: 'Learn more' })}
              </a>
            </div>
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={isRolling}
                onChange={(e) => updateCalendar(calendar.id, { taskCompletionMode: e.target.checked ? 'rolling' : 'override' })}
              />
              <span>{t('settings:tasks.rollingTaskCompletion.label', { defaultValue: 'Enable rolling completion' })}</span>
            </label>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.submitBtn} onClick={onClose}>
            {t('common:actions.done', { defaultValue: 'Done' })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
