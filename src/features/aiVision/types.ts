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

export const DEFAULT_BASE_URLS: Record<AIProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  custom: '',
}
