import type { ModelInfo, ProviderRequestConfig, VisionMessageInput } from '../types'
import * as anthropicAdapter from './anthropic'
import * as openaiAdapter from './openai'

/**
 * "Custom" endpoints have no fixed API shape, so rather than asking the user
 * to pick one, we infer it from the base URL itself. Some gateways/proxies
 * (e.g. Xiaomi MIMO) expose the same backend under two paths — an
 * OpenAI-compatible one and an Anthropic-compatible one, distinguished by an
 * "/anthropic" path segment — so a base URL containing that segment is
 * treated as Anthropic-shaped; everything else defaults to OpenAI-shaped,
 * the far more common convention for custom/self-hosted endpoints.
 */
export function isAnthropicShaped(baseUrl: string): boolean {
  try {
    const { pathname } = new URL(baseUrl)
    return pathname.toLowerCase().split('/').includes('anthropic')
  } catch {
    return false
  }
}

function adapterFor(baseUrl: string): typeof openaiAdapter {
  return isAnthropicShaped(baseUrl) ? anthropicAdapter : openaiAdapter
}

export async function listModels(cfg: ProviderRequestConfig): Promise<ModelInfo[]> {
  return adapterFor(cfg.baseUrl).listModels(cfg)
}

export async function sendVisionMessage(cfg: ProviderRequestConfig, input: VisionMessageInput): Promise<string> {
  return adapterFor(cfg.baseUrl).sendVisionMessage(cfg, input)
}
