import type { AIProvider, ModelInfo, ProviderRequestConfig, VisionMessageInput } from '../types'
import * as anthropic from './anthropic'
import * as openai from './openai'
import * as custom from './custom'

export interface ProviderAdapter {
  listModels(cfg: ProviderRequestConfig): Promise<ModelInfo[]>
  sendVisionMessage(cfg: ProviderRequestConfig, input: VisionMessageInput): Promise<string>
}

const ADAPTERS: Record<AIProvider, ProviderAdapter> = {
  anthropic,
  openai,
  custom,
}

export function getProvider(provider: AIProvider): ProviderAdapter {
  const adapter = ADAPTERS[provider]
  if (!adapter) {
    throw new Error(`Unknown AI provider: ${provider}`)
  }
  return adapter
}
