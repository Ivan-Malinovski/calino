import { httpRequest } from '../http'
import type { ModelInfo, ProviderRequestConfig, VisionMessageInput } from '../types'
import { endpointUrl } from './url'

const ANTHROPIC_VERSION = '2023-06-01'

function authHeaders(cfg: ProviderRequestConfig): Record<string, string> {
  return {
    'x-api-key': cfg.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

async function describeError(status: number, body: unknown): Promise<string> {
  if (status === 401 || status === 403) {
    return 'Authentication failed — check that your Anthropic API key is correct.'
  }
  const message = extractErrorMessage(body)
  return message
    ? `Anthropic request failed (${status}): ${message}`
    : `Anthropic request failed with status ${status}`
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

export async function listModels(cfg: ProviderRequestConfig): Promise<ModelInfo[]> {
  const response = await httpRequest({
    url: endpointUrl(cfg.baseUrl, '/models'),
    method: 'GET',
    headers: authHeaders(cfg),
  })

  if (!response.ok) {
    const body = await safeJson(response)
    throw new Error(await describeError(response.status, body))
  }

  const body = (await response.json()) as { data?: unknown }
  const data = Array.isArray(body?.data) ? body.data : []
  return data.map((entry: { id: string }) => ({ id: entry.id }))
}

export async function sendVisionMessage(
  cfg: ProviderRequestConfig,
  input: VisionMessageInput
): Promise<string> {
  const response = await httpRequest({
    url: endpointUrl(cfg.baseUrl, '/messages'),
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'content-type': 'application/json',
    },
    data: {
      model: cfg.model,
      max_tokens: input.maxTokens ?? 1024,
      ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mimeType,
                data: input.imageBase64,
              },
            },
            { type: 'text', text: input.prompt },
          ],
        },
      ],
    },
  })

  if (!response.ok) {
    const body = await safeJson(response)
    throw new Error(await describeError(response.status, body))
  }

  const body = (await response.json()) as { content?: Array<{ text?: unknown }> }
  const text = body?.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new Error('Anthropic response did not contain any text content')
  }
  return text
}

async function safeJson(response: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}
