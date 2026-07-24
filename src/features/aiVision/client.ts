import { getProvider } from './providers'
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildVisionProbePrompt,
  parseExtractedCandidates,
  parseVisionProbeReply,
  TEST_IMAGE_BASE64,
  TEST_IMAGE_MIME,
} from './prompt'
import type { ExtractedEventFields, ModelInfo, ProviderRequestConfig, TestConnectionResult } from './types'

export async function listModels(config: ProviderRequestConfig): Promise<ModelInfo[]> {
  return getProvider(config.provider).listModels(config)
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function looksLikeAuthError(message: string): boolean {
  return /401|403|authentication failed|unauthorized|forbidden/i.test(message)
}

export async function testConnection(config: ProviderRequestConfig): Promise<TestConnectionResult> {
  try {
    try {
      await listModels(config)
    } catch (err) {
      const message = messageOf(err)
      return {
        ok: false,
        error: message,
        hint: looksLikeAuthError(message) ? 'Double-check your API key and base URL.' : undefined,
      }
    }

    let reply: string
    try {
      reply = await getProvider(config.provider).sendVisionMessage(config, {
        imageBase64: TEST_IMAGE_BASE64,
        mimeType: TEST_IMAGE_MIME,
        prompt: buildVisionProbePrompt(),
        // Generous headroom: reasoning models (e.g. MIMO) spend a chunk of
        // the token budget on hidden chain-of-thought before the visible
        // answer — observed anywhere from ~50 to 250+ tokens for this probe
        // — so a tight cap here can starve the reply to empty.
        maxTokens: 2000,
      })
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }

    if (!reply.trim()) {
      return {
        ok: false,
        error: 'The model returned an empty response to the test prompt.',
        hint: 'If this is a reasoning model, it may need a higher token limit than this app allows — try a non-reasoning model if the issue persists.',
      }
    }

    if (parseVisionProbeReply(reply)) {
      return { ok: true, visionCapable: true }
    }

    return {
      ok: true,
      visionCapable: false,
      hint: 'This model responded but does not appear to support image understanding. Choose a vision-capable model.',
    }
  } catch (err) {
    return { ok: false, error: messageOf(err) }
  }
}

/**
 * Extracts one or more candidate event interpretations from a photo. Usually
 * resolves to a single-item array; resolves to multiple items when the model
 * finds the image genuinely ambiguous (e.g. several plausible dates), so the
 * caller can present a picker before anything is written into the event form.
 */
export async function extractEventFromImage(
  config: ProviderRequestConfig,
  imageBase64: string,
  mimeType: string
): Promise<ExtractedEventFields[]> {
  const raw = await getProvider(config.provider).sendVisionMessage(config, {
    imageBase64,
    mimeType,
    systemPrompt: buildExtractionSystemPrompt(),
    prompt: buildExtractionUserPrompt(),
    // Reasoning models can spend well over a thousand tokens on hidden
    // chain-of-thought before writing the actual JSON reply — keep this
    // generously above that so a busy photo doesn't get truncated to nothing.
    maxTokens: 8192,
  })
  return parseExtractedCandidates(raw)
}
