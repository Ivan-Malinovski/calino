import type { JSX } from 'react'
import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem } from '@capacitor/filesystem'
import { CapacitorShareTarget, type ShareReceivedEvent } from '@capgo/capacitor-share-target'
import { showToast } from '@/lib/toast'
import { useAIPhotoImport } from '../useAIPhotoImport'
import { downscaleImageBase64 } from '../imageUtils'
import { AIImportReviewModal } from './AIImportReviewModal'
import { AIImportProcessingOverlay } from './AIImportProcessingOverlay'

/**
 * Mounted once at the app root (alongside EventModal). Owns two things:
 *  - the Android share-intent listener, so a photo shared to Calino from
 *    another app (gallery, chat, browser) feeds the same extraction flow as
 *    the create-drawer's camera button;
 *  - the review/picker modal itself, since it must be visible regardless of
 *    whether the create-drawer happens to be open (it isn't, for a share).
 */
export function AIPhotoImportRoot(): JSX.Element | null {
  const {
    aiState,
    processingStage,
    reviewCandidates,
    processImage,
    confirmCandidate,
    confirmAllCandidates,
    cancelReview,
  } = useAIPhotoImport()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let handle: { remove: () => void } | undefined
    let cancelled = false

    const handleShare = async (event: ShareReceivedEvent): Promise<void> => {
      const imageFile = event.files?.find((f) => f.mimeType.startsWith('image/'))
      if (!imageFile) return

      if (event.files.length > 1) {
        showToast('Only the first shared photo was used — share one at a time for now.')
      }

      try {
        const { data } = await Filesystem.readFile({ path: imageFile.uri })
        if (typeof data !== 'string') throw new Error('Unexpected file data')
        const { base64, mimeType } = await downscaleImageBase64(data, imageFile.mimeType)
        await processImage(base64, mimeType)
      } catch {
        showToast('Could not read the shared photo.')
      }
    }

    CapacitorShareTarget.addListener('shareReceived', (event) => {
      void handleShare(event)
    }).then((h) => {
      if (cancelled) {
        h.remove()
      } else {
        handle = h
      }
    })

    return () => {
      cancelled = true
      handle?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <AIImportProcessingOverlay isOpen={aiState === 'processing'} stage={processingStage} />
      <AIImportReviewModal
        isOpen={reviewCandidates !== null}
        candidates={reviewCandidates ?? []}
        onConfirm={(fields) => confirmCandidate(fields)}
        onConfirmAll={(fields) => confirmAllCandidates(fields)}
        onCancel={cancelReview}
      />
    </>
  )
}
