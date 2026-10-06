import { httpRequest } from '../http'
import type { ModelInfo, ProviderRequestConfig, VisionMessageInput } from '../types'
import { endpointUrl } from './url'
import i18n from '@/lib/i18n'

const NON_CHAT_PREFIXES = [
  'text-embedding',
  'whisper',
  'tts',
  'dall-e',
  'omni-moderation',
  'text-moderation',
]

function authHeaders(cfg: ProviderRequestConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const err = (body as Record<string, unknown>).error
    if (err && typeof err === 'object') {
      const msg = (err as Record<string, unknown>).message
      if (typeof msg === 'string') return msg
    }
    if (typeof (body as Record<string, unknown>).message === 'string') {
      return (body as Record<string, unknown>).message as string
    }
  }
  return undefined
}

function describeError(status: number, body: unknown): string {
  if (status === 401 || status === 403) {
    return i18n.t('settings:ui.aiVision.err.auth', { status })
  }
  const message = extractErrorMessage(body)
  return message
    ? i18n.t('settings:ui.aiVision.err.failed', { status, message })
    : i18n.t('settings:ui.aiVision.err.failedNoMessage', { status })
}

async function safeJson(response: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export async function listModels(cfg: ProviderRequestConfig): Promise<ModelInfo[]> {
  const response = await httpRequest({
    url: endpointUrl(cfg.baseUrl, '/models'),
    method: 'GET',
    headers: authHeaders(cfg),
  })

  if (!response.ok) {
    const body = await safeJson(response)
    throw new Error(describeError(response.status, body))
  }

  const body = (await response.json()) as { data?: unknown }
  const data = Array.isArray(body?.data) ? body.data : []
  return data
    .map((entry: { id: string }) => ({ id: entry.id }))
    .filter((entry: ModelInfo) => !NON_CHAT_PREFIXES.some((prefix) => entry.id.startsWith(prefix)))
}

export async function sendVisionMessage(
  cfg: ProviderRequestConfig,
  input: VisionMessageInput
): Promise<string> {
  const response = await httpRequest({
    url: endpointUrl(cfg.baseUrl, '/chat/completions'),
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'content-type': 'application/json',
    },
    data: {
      model: cfg.model,
      max_tokens: input.maxTokens ?? 1024,
      messages: [
        ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` },
            },
            { type: 'text', text: input.prompt },
          ],
        },
      ],
    },
  })

  if (!response.ok) {
    const body = await safeJson(response)
    throw new Error(describeError(response.status, body))
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
  const text = body?.choices?.[0]?.message?.content
  if (typeof text !== 'string') {
    throw new Error(i18n.t('settings:ui.aiVision.err.noText'))
  }
  return text
}
