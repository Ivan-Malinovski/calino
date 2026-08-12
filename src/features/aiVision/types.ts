import type { EncryptedData } from '@/lib/crypto'

export type AIProvider = 'anthropic' | 'openai' | 'custom'

export interface AIVisionSettings {
  provider: AIProvider
  baseUrl: string
  model: string
  apiKeyEncrypted: EncryptedData | null
  lastVerified: { at: number; ok: boolean; visionCapable?: boolean } | null
}

/** Resolved config handed to provider adapters — API key already decrypted. */
export interface ProviderRequestConfig {
  provider: AIProvider
  baseUrl: string
  apiKey: string
  model: string
}

export interface ModelInfo {
  id: string
  label?: string
}

export interface TestConnectionResult {
  ok: boolean
  visionCapable?: boolean
  error?: string
  hint?: string
}

export interface ExtractedEventFields {
  title?: string
  location?: string
  description?: string
  /** ISO 8601 local datetime, e.g. "2026-07-25T18:00" */
  start?: string
  /** ISO 8601 local datetime */
  end?: string
  allDay?: boolean
  confidence?: 'low' | 'medium' | 'high'
  /**
   * What the model thinks this is. Absent (or unrecognised) means "event" —
   * the review modal's toggle is what ultimately decides, this is only its
   * starting position.
   */
  kind?: 'event' | 'task'
}

export interface VisionMessageInput {
  imageBase64: string
  mimeType: string
  systemPrompt?: string
  prompt: string
  maxTokens?: number
}

export class AIVisionExtractionError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AIVisionExtractionError'
    this.cause = cause
  }
}

/**
 * Full API roots, version segment included — adapters append only the endpoint
 * path (`/models`, `/messages`, …) and never rewrite what they are given.
 */
export const DEFAULT_BASE_URLS: Record<AIProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  custom: '',
}
