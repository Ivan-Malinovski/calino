import { create } from 'zustand'
import type { ExtractedEventFields } from '@/features/aiVision/types'

export type AIImportState = 'idle' | 'capturing' | 'processing'

/**
 * Finer-grained phase within the 'processing' state, shown on the full-screen
 * overlay so the wait doesn't read as "nothing is happening". There's no real
 * upload/response instrumentation to key this off (a single request/response
 * call via CapacitorHttp) — the phases are time-based approximations, see the
 * timers in useAIPhotoImport.processImage.
 */
export type AIImportProcessingStage = 'sending' | 'thinking' | 'slow' | null

interface AIImportStore {
  aiState: AIImportState
  processingStage: AIImportProcessingStage
  reviewCandidates: ExtractedEventFields[] | null
  setAiState: (state: AIImportState) => void
  setProcessingStage: (stage: AIImportProcessingStage) => void
  setReviewCandidates: (candidates: ExtractedEventFields[] | null) => void
}

/**
 * Deliberately separate from calendarStore: this is transient photo-import UI
 * state (spinner + review picker), not calendar data. Lives at store level
 * rather than component state so both the create-drawer camera button and
 * the Android share-intent listener (mounted once at the app root, see
 * useAIPhotoImport.ts) can drive the same review modal.
 */
export const useAIImportStore = create<AIImportStore>()((set) => ({
  aiState: 'idle',
  processingStage: null,
  reviewCandidates: null,
  setAiState: (state) => set({ aiState: state }),
  setProcessingStage: (stage) => set({ processingStage: stage }),
  setReviewCandidates: (candidates) => set({ reviewCandidates: candidates }),
}))
