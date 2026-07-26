import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { AIImportProcessingStage } from '@/store/aiImportStore'
import styles from './AIImportProcessingOverlay.module.css'

const COPY: Record<Exclude<AIImportProcessingStage, null>, { label: string; sublabel: string }> = {
  sending: { label: 'Sending photo…', sublabel: 'Uploading to the AI model' },
  thinking: { label: 'Reading your photo…', sublabel: 'Waiting for a response from the AI model' },
  slow: { label: 'Still working…', sublabel: 'Larger or busier requests can take a little longer' },
}

/**
 * Full-screen, non-dismissable overlay shown while a photo is being sent to
 * the vision model. Replaces the old button-only spinner, which gave no
 * feedback for share-intent imports (no drawer open to show it in) and read
 * as "nothing is happening, tap anywhere" during camera imports. `stage`
 * steps through a time-based approximation of progress (see
 * useAIPhotoImport.processImage) so the wait doesn't feel frozen.
 */
export function AIImportProcessingOverlay({
  isOpen,
  stage,
}: {
  isOpen: boolean
  stage: AIImportProcessingStage
}): JSX.Element | null {
  if (!isOpen) return null

  const { label, sublabel } = COPY[stage ?? 'thinking']

  return createPortal(
    <div
      className={styles.overlay}
      role="status"
      aria-live="polite"
      data-component="ai-import-processing-overlay"
    >
      <div className={styles.spinner} aria-hidden="true" />
      <div className={styles.label}>{label}</div>
      <div className={styles.sublabel}>{sublabel}</div>
    </div>,
    document.body
  )
}
