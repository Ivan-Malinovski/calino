import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { showToast } from '@/lib/toast'
import { IcsImportModal } from './IcsImportModal'
import styles from './IcsDropZone.module.css'

function isIcsFile(file: File): boolean {
  return /\.ics$/i.test(file.name) || file.type === 'text/calendar'
}

/**
 * Window-level drop target for .ics files.
 *
 * Two things keep this from trampling the app's own drag-and-drop
 * (`event-move`, `todo-drag-parent`, …):
 *   - we only claim a drag whose `dataTransfer.types` contains `Files`, so
 *     internal drags — which carry custom mime types, never files — fall
 *     straight through without `preventDefault`;
 *   - the overlay is driven by a depth counter rather than a boolean, because
 *     `dragleave` fires every time the pointer crosses a child element and a
 *     boolean makes the overlay strobe.
 */
export function IcsDropZone(): JSX.Element | null {
  const { t } = useTranslation('calendar')
  const [isDragging, setIsDragging] = useState(false)
  const [pendingIcs, setPendingIcs] = useState<{ text: string; fileName: string } | null>(null)
  const depthRef = useRef(0)

  useEffect(() => {
    const carriesFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const handleDragEnter = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depthRef.current += 1
      setIsDragging(true)
    }

    const handleDragOver = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      // Required, or the browser navigates to the dropped file instead of
      // handing it to us.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    const handleDragLeave = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setIsDragging(false)
    }

    const handleDrop = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depthRef.current = 0
      setIsDragging(false)

      const files = Array.from(e.dataTransfer?.files ?? [])
      const ics = files.find(isIcsFile)
      if (!ics) {
        // Non-calendar files aren't an error — the user just dropped the wrong
        // thing on the window. Stay quiet unless they dropped *something*.
        if (files.length > 0) showToast('That file isn’t a .ics calendar')
        return
      }

      void ics
        .text()
        .then((text) => setPendingIcs({ text, fileName: ics.name }))
        .catch(() => showToast('Could not read that file'))
    }

    // Cancels a stuck overlay if the drag ends outside the window.
    const handleDragEnd = (): void => {
      depthRef.current = 0
      setIsDragging(false)
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    window.addEventListener('dragend', handleDragEnd)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragend', handleDragEnd)
    }
  }, [])

  return (
    <>
      {isDragging &&
        createPortal(
          <div className={styles.overlay} data-component="ics-drop-overlay">
            <div className={styles.panel}>
              <span className={styles.title}>{t('surface.icsDropTitle')}</span>
              <span className={styles.hint}>{t('surface.icsDropHint')}</span>
            </div>
          </div>,
          document.body
        )}
      {/* Mounted only while a file is pending: the modal pulls in useCalDAV,
          which starts its own 30s pending-changes interval. */}
      {pendingIcs !== null && (
        <IcsImportModal
          isOpen
          icsText={pendingIcs.text}
          fileName={pendingIcs.fileName}
          onClose={() => setPendingIcs(null)}
        />
      )}
    </>
  )
}
