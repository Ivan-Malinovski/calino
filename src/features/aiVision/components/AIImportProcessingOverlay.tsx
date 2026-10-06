import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { AIImportProcessingStage } from '@/store/aiImportStore'
import styles from './AIImportProcessingOverlay.module.css'

const COPY_KEYS: Record<
  Exclude<AIImportProcessingStage, null>,
  { label: string; sublabel: string }
> = {
  sending: { label: 'ui.aiImport.sending', sublabel: 'ui.aiImport.sendingSub' },
  thinking: { label: 'ui.aiImport.thinking', sublabel: 'ui.aiImport.thinkingSub' },
  slow: { label: 'ui.aiImport.slow', sublabel: 'ui.aiImport.slowSub' },
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
  const { t } = useTranslation('calendar')

  if (!isOpen) return null

  const copy = COPY_KEYS[stage ?? 'thinking']

  return createPortal(
    <div
      className={styles.overlay}
      role="status"
      aria-live="polite"
      data-component="ai-import-processing-overlay"
    >
      <div className={styles.spinner} aria-hidden="true" />
      <div className={styles.label}>{t(copy.label)}</div>
      <div className={styles.sublabel}>{t(copy.sublabel)}</div>
    </div>,
    document.body
  )
}
