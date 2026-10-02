import type { JSX, KeyboardEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './weekTaskControls.module.css'

interface WeekTaskQuickAddProps {
  /** Adds the task; returns false when nothing was added (draft is kept). */
  onAdd: (title: string) => boolean
  /** Opens the full task form, pre-filled with the draft title if any. */
  onOpenForm: (title?: string) => void
}

/**
 * The always-there entry for a week's tasks: a round "+" that opens a ghost
 * pill to type straight into, and a "…" that hands the draft to the task form.
 * Renders a fragment so the caller picks the wrapper.
 */
export function WeekTaskQuickAdd({ onAdd, onOpenForm }: WeekTaskQuickAddProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const closeAdd = (): void => {
    setDraft('')
    setAdding(false)
  }

  const onDraftKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (onAdd(draft)) setDraft('')
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      closeAdd()
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.addButton}
        onClick={() => (adding ? closeAdd() : setAdding(true))}
        aria-label={t('views.week.addWeekTask')}
        aria-expanded={adding}
        title={t('views.week.addWeekTask')}
        data-component="week-task-add"
      >
        +
      </button>
      {adding && (
        <>
          <input
            type="text"
            autoFocus
            className={styles.addInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKeyDown}
            onBlur={() => {
              if (!draft.trim()) setAdding(false)
            }}
            placeholder={t('views.week.quickAddPlaceholder')}
            aria-label={t('views.week.quickAddPlaceholder')}
            data-component="week-task-quick-add"
          />
          <button
            type="button"
            className={styles.addButton}
            // Keep focus in the field so its blur does not close it first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onOpenForm(draft.trim() || undefined)
              closeAdd()
            }}
            aria-label={t('views.week.addWeekTaskDetails')}
            title={t('views.week.addWeekTaskDetails')}
            data-component="week-task-add-details"
          >
            …
          </button>
        </>
      )}
    </>
  )
}
