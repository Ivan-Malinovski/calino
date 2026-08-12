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

type CandidateKind = NonNullable<ExtractedEventFields['kind']>

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

/**
 * Same range, read differently depending on the toggle: for a task the
 * extracted start is the due date, so it gets labelled as one.
 */
function describeDate(
  fields: ExtractedEventFields,
  timeFormat: TimeFormat,
  kind: CandidateKind
): string | null {
  if (kind !== 'task') return formatDateRange(fields, timeFormat)
  const start = formatDateRange({ ...fields, end: undefined }, timeFormat)
  return start ? `Due ${start}` : null
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

/**
 * Per-candidate Event/Task switch. Starts on whatever the model suggested,
 * but the user's choice is what actually decides which form opens next.
 * `stopPropagation` matters in the multi-candidate case, where the whole card
 * is itself a click target that toggles selection.
 */
function KindToggle({
  kind,
  onChange,
}: {
  kind: CandidateKind
  onChange: (kind: CandidateKind) => void
}): JSX.Element {
  const options: CandidateKind[] = ['event', 'task']

  return (
    <div className={styles.segmentedControl} data-component="ai-import-kind-toggle" role="group">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.segmentTab} ${kind === option ? styles.segmentTabActive : ''}`}
          aria-pressed={kind === option}
          onClick={(e) => {
            e.stopPropagation()
            onChange(option)
          }}
          data-action={`set-kind-${option}`}
        >
          {option === 'event' ? 'Event' : 'Task'}
        </button>
      ))}
    </div>
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
  kind,
  onKindChange,
  onUse,
}: {
  fields: ExtractedEventFields
  timeFormat: TimeFormat
  kind: CandidateKind
  onKindChange: (kind: CandidateKind) => void
  onUse: () => void
}): JSX.Element {
  const dateLabel = describeDate(fields, timeFormat, kind)

  return (
    <div className={styles.candidateCard} data-component="ai-import-candidate" data-kind={kind}>
      <div className={styles.candidateTitle}>
        {fields.title || (kind === 'task' ? 'Untitled task' : 'Untitled event')}
      </div>
      <CandidateDetails fields={fields} dateLabel={dateLabel} />
      <div className={styles.kindRow}>
        <KindToggle kind={kind} onChange={onKindChange} />
      </div>
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
  kind,
  onKindChange,
  onToggle,
}: {
  fields: ExtractedEventFields
  timeFormat: TimeFormat
  selected: boolean
  kind: CandidateKind
  onKindChange: (kind: CandidateKind) => void
  onToggle: () => void
}): JSX.Element {
  const dateLabel = describeDate(fields, timeFormat, kind)

  // A div rather than a <button>: the card now nests the Event/Task toggle's
  // own buttons, and a button inside a button is invalid markup that browsers
  // reparent — which broke the toggle's click target outright.
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${styles.candidateCard} ${styles.candidateCardSelectable} ${selected ? styles.candidateCardSelected : ''}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      aria-pressed={selected}
      data-component="ai-import-candidate"
      data-selected={selected}
      data-kind={kind}
    >
      <div className={styles.candidateCheckRow}>
        <span
          className={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}
          aria-hidden="true"
        >
          {selected && <CheckIcon />}
        </span>
        <div className={styles.candidateTitle}>
          {fields.title || (kind === 'task' ? 'Untitled task' : 'Untitled event')}
        </div>
      </div>
      <CandidateDetails fields={fields} dateLabel={dateLabel} />
      <div className={styles.kindRow}>
        <KindToggle kind={kind} onChange={onKindChange} />
      </div>
    </div>
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
  // Each candidate's Event/Task position, seeded from the model's suggestion.
  const [kinds, setKinds] = useState<CandidateKind[]>(() => candidates.map((c) => c.kind ?? 'event'))
  const [lastCandidates, setLastCandidates] = useState(candidates)
  if (isOpen && lastCandidates !== candidates) {
    setLastCandidates(candidates)
    setSelected(new Set(candidates.map((_, i) => i)))
    setKinds(candidates.map((c) => c.kind ?? 'event'))
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

  const setKindAt = (index: number, kind: CandidateKind): void => {
    setKinds((prev) => prev.map((value, i) => (i === index ? kind : value)))
  }

  // The toggle, not the model, is the source of truth for what gets created.
  const kindAt = (index: number): CandidateKind => kinds[index] ?? candidates[index].kind ?? 'event'
  const withKind = (index: number): ExtractedEventFields => ({
    ...candidates[index],
    kind: kindAt(index),
  })

  const selectedCount = selected.size
  const confirmSelected = (): void => {
    const chosen = candidates.map((_, i) => i).filter((i) => selected.has(i))
    if (chosen.length === 0) return
    if (chosen.length === 1) {
      onConfirm(withKind(chosen[0]))
    } else {
      onConfirmAll(chosen.map(withKind))
    }
  }

  const confirmLabel =
    selectedCount === 0
      ? 'Select items to add'
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
            {isMultiple ? 'What did we find?' : 'Confirm details'}
          </h3>
          <button className={styles.close} onClick={requestClose} aria-label="Cancel">
            ✕
          </button>
        </div>
        <p className={styles.subtitle}>
          {isMultiple
            ? 'Everything read from the photo is selected below. Tap any to leave it out, and switch anything that should be a task instead.'
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
                kind={kindAt(index)}
                onKindChange={(kind) => setKindAt(index, kind)}
                onToggle={() => toggleSelected(index)}
              />
            ) : (
              <CandidateCard
                key={index}
                fields={candidate}
                timeFormat={timeFormat}
                kind={kindAt(index)}
                onKindChange={(kind) => setKindAt(index, kind)}
                onUse={() => onConfirm(withKind(index))}
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
