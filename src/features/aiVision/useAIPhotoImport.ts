import { useNavigate } from 'react-router'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { useCalendarStore } from '@/store/calendarStore'
import { useAIVisionSettingsStore } from '@/store/aiVisionSettingsStore'
import { useAIImportStore } from '@/store/aiImportStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { showToast } from '@/lib/toast'
import i18n from '@/lib/i18n'
import { extractEventFromImage } from './client'
import type { ExtractedEventFields } from './types'

/** True if a candidate carries anything actually worth reviewing. */
function hasUsableFields(fields: ExtractedEventFields): boolean {
  return Boolean(fields.title || fields.start || fields.location || fields.description)
}

/**
 * Turns a thrown extraction error into user-facing copy. Distinguishes an
 * invalid/expired API key (actionable — link to Settings) and a network
 * failure (transient — worth retrying) from everything else, rather than
 * showing one generic "something went wrong" message for all of them.
 */
function describeExtractionError(err: unknown): { message: string; isAuthError: boolean } {
  const raw = err instanceof Error ? err.message : String(err)
  if (/\b(401|403)\b|authentication|unauthorized|forbidden|invalid.*api.?key/i.test(raw)) {
    return { message: i18n.t('errors:toast.aiImport.keyInvalid'), isAuthError: true }
  }
  if (/network|fetch|timeout|offline|failed to fetch|ECONNREFUSED/i.test(raw)) {
    return {
      message: i18n.t('errors:toast.aiImport.unreachable'),
      isAuthError: false,
    }
  }
  return { message: i18n.t('errors:toast.aiImport.unreadable'), isAuthError: false }
}

/**
 * Shared orchestration for the AI-photo-import flow, used by both the
 * create-drawer's camera button and the Android share-intent listener
 * (useShareIntentListener). State lives in aiImportStore so it's shared
 * across whichever entry point kicked off an extraction — the review modal
 * is rendered once at the app root, not owned by either caller.
 */
export function useAIPhotoImport(): {
  aiState: ReturnType<typeof useAIImportStore.getState>['aiState']
  processingStage: ReturnType<typeof useAIImportStore.getState>['processingStage']
  reviewCandidates: ExtractedEventFields[] | null
  importFromCamera: (onDone?: () => void) => Promise<void>
  processImage: (base64: string, mimeType: string, onDone?: () => void) => Promise<void>
  confirmCandidate: (fields: ExtractedEventFields, onDone?: () => void) => void
  confirmAllCandidates: (fields: ExtractedEventFields[], onDone?: () => void) => void
  cancelReview: () => void
} {
  const navigate = useNavigate()
  const aiState = useAIImportStore((s) => s.aiState)
  const processingStage = useAIImportStore((s) => s.processingStage)
  const reviewCandidates = useAIImportStore((s) => s.reviewCandidates)
  const setAiState = useAIImportStore((s) => s.setAiState)
  const setProcessingStage = useAIImportStore((s) => s.setProcessingStage)
  const setReviewCandidates = useAIImportStore((s) => s.setReviewCandidates)

  const promptForApiKey = (onDone?: () => void): void => {
    showToast(i18n.t('errors:toast.aiImport.setupNeeded'), {
      linkText: i18n.t('errors:toast.aiImport.openSettings'),
      onLinkClick: () => {
        onDone?.()
        navigate('/settings?tab=aiVision')
      },
    })
  }

  const processImage = async (
    base64: string,
    mimeType: string,
    onDone?: () => void
  ): Promise<void> => {
    if (!useAIVisionSettingsStore.getState().hasApiKey()) {
      promptForApiKey(onDone)
      return
    }

    const apiKey = await useAIVisionSettingsStore.getState().getApiKey()
    if (!apiKey) {
      promptForApiKey(onDone)
      return
    }

    setAiState('processing')
    setProcessingStage('sending')
    // Time-based approximation of "sending" vs. "waiting for the model" — a
    // single request/response call gives no real upload-progress signal, but
    // a downscaled photo (under ~1MB) should be on the wire well within this
    // window, so the switch still roughly tracks reality.
    const thinkingTimer = setTimeout(() => setProcessingStage('thinking'), 1500)
    const slowTimer = setTimeout(() => setProcessingStage('slow'), 9000)

    try {
      const { provider, baseUrl, model } = useAIVisionSettingsStore.getState()
      const candidates = await extractEventFromImage(
        { provider, baseUrl, apiKey, model },
        base64,
        mimeType
      )

      if (!candidates.some(hasUsableFields)) {
        hapticIfEnabled('light')
        showToast(i18n.t('errors:toast.aiImport.noDetails'), {
          duration: 6000,
          linkText: i18n.t('errors:toast.aiImport.addManually'),
          onLinkClick: () => useCalendarStore.getState().openModal(),
        })
        onDone?.()
        return
      }

      hapticIfEnabled('light')
      setReviewCandidates(candidates)
      onDone?.()
    } catch (err) {
      const { message, isAuthError } = describeExtractionError(err)
      showToast(i18n.t('errors:toast.aiImport.blankFallback', { message }), {
        duration: 6000,
        linkText: isAuthError ? i18n.t('errors:toast.aiImport.openSettings') : undefined,
        onLinkClick: isAuthError ? () => navigate('/settings?tab=aiVision') : undefined,
      })
      useCalendarStore.getState().openModal()
      onDone?.()
    } finally {
      clearTimeout(thinkingTimer)
      clearTimeout(slowTimer)
      setAiState('idle')
      setProcessingStage(null)
    }
  }

  const importFromCamera = async (onDone?: () => void): Promise<void> => {
    if (!useAIVisionSettingsStore.getState().hasApiKey()) {
      promptForApiKey(onDone)
      return
    }

    setAiState('capturing')
    let photo: Awaited<ReturnType<typeof Camera.getPhoto>>
    try {
      photo = await Camera.getPhoto({
        source: CameraSource.Prompt,
        resultType: CameraResultType.Base64,
        width: 1600,
        quality: 80,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : ''
      setAiState('idle')
      if (message.includes('cancel')) return
      if (message.includes('permission')) {
        showToast(i18n.t('errors:toast.aiImport.cameraDenied'))
        return
      }
      showToast(i18n.t('errors:toast.aiImport.cameraUnavailable'))
      return
    }

    if (!photo.base64String) {
      setAiState('idle')
      showToast(i18n.t('errors:toast.aiImport.cameraUnavailable'))
      return
    }

    await processImage(photo.base64String, `image/${photo.format}`, onDone)
  }

  const confirmCandidate = (fields: ExtractedEventFields, onDone?: () => void): void => {
    setReviewCandidates(null)
    useCalendarStore.getState().setPendingEventPrefill(fields)
    useCalendarStore
      .getState()
      .openModal(fields.start, fields.end, undefined, fields.kind ?? 'event')
    hapticIfEnabled('light')
    onDone?.()
  }

  const confirmAllCandidates = (fields: ExtractedEventFields[], onDone?: () => void): void => {
    setReviewCandidates(null)
    useCalendarStore.getState().startImportQueue(fields)
    hapticIfEnabled('light')
    if (fields.length > 1) {
      const allTasks = fields.every((f) => f.kind === 'task')
      const allEvents = fields.every((f) => (f.kind ?? 'event') === 'event')
      const noun = allTasks ? 'task' : allEvents ? 'event' : 'item'
      showToast(i18n.t('errors:toast.aiImport.reviewEach', { context: noun, total: fields.length }))
    }
    onDone?.()
  }

  const cancelReview = (): void => setReviewCandidates(null)

  return {
    aiState,
    processingStage,
    reviewCandidates,
    importFromCamera,
    processImage,
    confirmCandidate,
    confirmAllCandidates,
    cancelReview,
  }
}
