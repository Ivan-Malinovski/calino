import type { JSX } from 'react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { useSettingsStore } from '@/store/settingsStore'
import { formatTime } from '@/lib/datetime'
import type { TimeFormat } from '@/types'
import type { ExtractedEventFields } from '../types'
import styles from './AIImportReviewModal.module.css'

interface AIImportReviewModalProps {
  isOpen: boolean
  candidates: ExtractedEventFields[]
  onConfirm: (fields: ExtractedEventFields) => void
  onConfirmAll: (candidates: ExtractedEventFields[]) => void
  onCancel: () => void
}

function formatDateRange(fields: ExtractedEventFields, timeFormat: TimeFormat): string | null {
  if (!fields.start) return null
  const parse = (value: string): Date | null => {
    try {
      const d = parseISO(value)
      return Number.isNaN(d.getTime()) ? null : d
    } catch {
      return null
    }
  }
  const start = parse(fields.start)
  if (!start) return fields.start

  const dateFmt = 'EEE MMM d'

  if (fields.allDay) {
    return format(start, dateFmt)
  }

  const startLabel = `${format(start, dateFmt)} · ${formatTime(start, timeFormat)}`
  const end = fields.end ? parse(fields.end) : null
  if (!end) return startLabel

  const sameDay = format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd')
  const endLabel = sameDay
    ? formatTime(end, timeFormat)
    : `${format(end, dateFmt)} · ${formatTime(end, timeFormat)}`

  return `${startLabel} – ${endLabel}`
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.2 3.2L13 4.5" />
    </svg>
  )
}

function CandidateDetails({
  fields,
  dateLabel,
}: {
  fields: ExtractedEventFields
  dateLabel: string | null
}): JSX.Element {
  return (
    <>
      {dateLabel && (
        <div className={styles.candidateMetaRow}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="14" height="13" rx="3" />
            <path d="M2 7h14M6 2v2M12 2v2" />
          </svg>
          {dateLabel}
        </div>
      )}
      {fields.location && (
        <div className={styles.candidateMetaRow}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 16s5.5-4.9 5.5-9A5.5 5.5 0 003.5 7c0 4.1 5.5 9 5.5 9z" />
            <circle cx="9" cy="7" r="2" />
          </svg>
          {fields.location}
        </div>
      )}
      {fields.description && (
        <div className={styles.candidateDescription}>{fields.description}</div>
      )}
      {fields.confidence && fields.confidence !== 'high' && (
        <span
          className={`${styles.confidenceBadge} ${fields.confidence === 'low' ? styles.confidenceLow : styles.confidenceMedium}`}
        >
          {fields.confidence} confidence
        </span>
      )}
      {!fields.title && !dateLabel && !fields.location && !fields.description && (
        <div className={styles.emptyNote}>No details could be read from this photo.</div>
      )}
    </>
  )
}

/** Single-candidate case: a plain card with an explicit "Use this" action. */
function CandidateCard({
  fields,
  timeFormat,
  onUse,
}: {
  fields: ExtractedEventFields
  timeFormat: TimeFormat
  onUse: () => void
}): JSX.Element {
  const dateLabel = formatDateRange(fields, timeFormat)

  return (
    <div className={styles.candidateCard} data-component="ai-import-candidate">
      <div className={styles.candidateTitle}>{fields.title || 'Untitled event'}</div>
      <CandidateDetails fields={fields} dateLabel={dateLabel} />
      <div className={styles.candidateActions}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={onUse}
          data-action="use-candidate"
        >
          Use this
        </button>
      </div>
    </div>
  )
}

/** Multi-candidate case: a checkable card so the user can pick any subset. */
function SelectableCandidateCard({
  fields,
  timeFormat,
  selected,
  onToggle,
}: {
  fields: ExtractedEventFields
  timeFormat: TimeFormat
  selected: boolean
  onToggle: () => void
}): JSX.Element {
  const dateLabel = formatDateRange(fields, timeFormat)

  return (
    <button
      type="button"
      className={`${styles.candidateCard} ${styles.candidateCardSelectable} ${selected ? styles.candidateCardSelected : ''}`}
      onClick={onToggle}
      aria-pressed={selected}
      data-component="ai-import-candidate"
      data-selected={selected}
    >
      <div className={styles.candidateCheckRow}>
        <span
          className={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}
          aria-hidden="true"
        >
          {selected && <CheckIcon />}
        </span>
        <div className={styles.candidateTitle}>{fields.title || 'Untitled event'}</div>
      </div>
      <CandidateDetails fields={fields} dateLabel={dateLabel} />
    </button>
  )
}

/**
 * Shown after a photo has been sent to the vision model, before anything is
 * written into the New Event form — lets the user confirm the extracted
 * details, or pick between multiple candidates when the model found the
 * photo ambiguous or the flyer advertises several distinct events.
 */
export function AIImportReviewModal({
  isOpen,
  candidates,
  onConfirm,
  onConfirmAll,
  onCancel,
}: AIImportReviewModalProps): JSX.Element | null {
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const { rendered, closing, requestClose } = useAnimatedClose(isOpen, onCancel, 200)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalDismiss(dialogRef, rendered && !closing, requestClose)

  const isMultiple = candidates.length > 1

  // Every candidate starts selected — "Add all" is the common case; the user
  // deselects the ones they don't want rather than building a selection
  // from scratch. Resets whenever a fresh batch of candidates comes in.
  // Adjusting state during render (rather than in an effect) per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [selected, setSelected] = useState<Set<number>>(() => new Set(candidates.map((_, i) => i)))
  const [lastCandidates, setLastCandidates] = useState(candidates)
  if (isOpen && lastCandidates !== candidates) {
    setLastCandidates(candidates)
    setSelected(new Set(candidates.map((_, i) => i)))
  }

  if (!rendered) return null

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) requestClose()
  }

  const toggleSelected = (index: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const selectedCount = selected.size
  const confirmSelected = (): void => {
    const chosen = candidates.filter((_, i) => selected.has(i))
    if (chosen.length === 0) return
    if (chosen.length === 1) {
      onConfirm(chosen[0])
    } else {
      onConfirmAll(chosen)
    }
  }

  const confirmLabel =
    selectedCount === 0
      ? 'Select events to add'
      : selectedCount === candidates.length
        ? `Add all ${selectedCount}`
        : `Add ${selectedCount} selected`

  return createPortal(
    <div
      className={`${styles.modal} ${closing ? styles.closing : ''}`}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-import-review-title"
        data-component="ai-import-review-modal"
      >
        <div className={styles.header}>
          <h3 className={styles.title} id="ai-import-review-title">
            {isMultiple ? 'Which events?' : 'Confirm details'}
          </h3>
          <button className={styles.close} onClick={requestClose} aria-label="Cancel">
            ✕
          </button>
        </div>
        <p className={styles.subtitle}>
          {isMultiple
            ? 'The photo matched a few different dates or events — all are selected below. Tap any to leave it out.'
            : "Here's what was read from the photo. You can still edit everything in the next step."}
        </p>
        <div className={styles.candidateList}>
          {candidates.map((candidate, index) =>
            isMultiple ? (
              <SelectableCandidateCard
                key={index}
                fields={candidate}
                timeFormat={timeFormat}
                selected={selected.has(index)}
                onToggle={() => toggleSelected(index)}
              />
            ) : (
              <CandidateCard
                key={index}
                fields={candidate}
                timeFormat={timeFormat}
                onUse={() => onConfirm(candidate)}
              />
            )
          )}
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={requestClose}
            data-action="cancel-import"
          >
            Cancel
          </button>
          {isMultiple && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={selectedCount === 0}
              onClick={confirmSelected}
              data-action="confirm-selected-candidates"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
