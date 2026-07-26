import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../http', () => ({
  httpRequest: vi.fn(),
}))

import { httpRequest } from '../http'
import * as anthropicProvider from '../providers/anthropic'
import * as openaiProvider from '../providers/openai'
import * as customProvider from '../providers/custom'
import type { ProviderRequestConfig } from '../types'

const mockedHttpRequest = vi.mocked(httpRequest)

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

const anthropicCfg: ProviderRequestConfig = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'sk-ant-test',
  model: 'claude-sonnet',
}

const openaiCfg: ProviderRequestConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
}

beforeEach(() => {
  mockedHttpRequest.mockReset()
})

describe('anthropic provider', () => {
  it('listModels maps response.data[].id to ModelInfo', async () => {
    mockedHttpRequest.mockResolvedValue(
      mockResponse(200, { data: [{ id: 'claude-3-5-sonnet' }, { id: 'claude-3-opus' }] })
    )

    const models = await anthropicProvider.listModels(anthropicCfg)

    expect(models).toEqual([{ id: 'claude-3-5-sonnet' }, { id: 'claude-3-opus' }])
    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anthropic.com/v1/models',
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        }),
      })
    )
  })

  it('listModels throws a bad-key message on 401', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(401, { error: { message: 'invalid x-api-key' } }))

    await expect(anthropicProvider.listModels(anthropicCfg)).rejects.toThrow(/api key/i)
  })

  it('sendVisionMessage posts the expected body and extracts text', async () => {
    mockedHttpRequest.mockResolvedValue(
      mockResponse(200, { content: [{ type: 'text', text: 'hello world' }] })
    )

    const result = await anthropicProvider.sendVisionMessage(anthropicCfg, {
      imageBase64: 'AAAA',
      mimeType: 'image/png',
      prompt: 'describe this',
      systemPrompt: 'sys',
    })

    expect(result).toBe('hello world')
    const call = mockedHttpRequest.mock.calls[0][0]
    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call.method).toBe('POST')
    expect(call.data).toMatchObject({
      model: 'claude-sonnet',
      max_tokens: 1024,
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'text', text: 'describe this' },
          ],
        },
      ],
    })
  })

  it('sendVisionMessage throws a bad-key message on 403', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(403, { error: { message: 'forbidden' } }))

    await expect(
      anthropicProvider.sendVisionMessage(anthropicCfg, {
        imageBase64: 'AAAA',
        mimeType: 'image/png',
        prompt: 'x',
      })
    ).rejects.toThrow(/api key/i)
  })
})

describe('openai provider', () => {
  it('listModels maps response.data.data[].id and filters non-chat models', async () => {
    mockedHttpRequest.mockResolvedValue(
      mockResponse(200, {
        data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'gpt-4o-mini' }],
      })
    )

    const models = await openaiProvider.listModels(openaiCfg)

    expect(models).toEqual([{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }])
    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/models',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      })
    )
  })

  it('listModels throws a bad-key message on 401', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(401, { error: { message: 'Incorrect API key provided' } }))

    await expect(openaiProvider.listModels(openaiCfg)).rejects.toThrow(/authentication failed/i)
  })

  it('sendVisionMessage posts the expected body and extracts content', async () => {
    mockedHttpRequest.mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: 'a description' } }] })
    )

    const result = await openaiProvider.sendVisionMessage(openaiCfg, {
      imageBase64: 'AAAA',
      mimeType: 'image/jpeg',
      prompt: 'describe this',
    })

    expect(result).toBe('a description')
    const call = mockedHttpRequest.mock.calls[0][0]
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(call.data).toMatchObject({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
            { type: 'text', text: 'describe this' },
          ],
        },
      ],
    })
  })

  it('sendVisionMessage throws a bad-key message on 401', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(401, { error: { message: 'bad key' } }))

    await expect(
      openaiProvider.sendVisionMessage(openaiCfg, { imageBase64: 'AAAA', mimeType: 'image/png', prompt: 'x' })
    ).rejects.toThrow(/authentication failed/i)
  })
})

describe('custom provider', () => {
  const customCfg: ProviderRequestConfig = { ...openaiCfg, provider: 'custom' }

  it('uses the OpenAI-shaped adapter for a plain host', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(200, { data: [{ id: 'gpt-4o' }] }))

    await customProvider.listModels({ ...customCfg, baseUrl: 'https://api.xiaomimimo.com/v1' })

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.xiaomimimo.com/v1/models',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      })
    )
  })

  it('uses the Anthropic-shaped adapter when the base URL has an /anthropic path segment', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(200, { data: [{ id: 'claude-3-5-sonnet' }] }))

    await customProvider.listModels({ ...customCfg, baseUrl: 'https://api.xiaomimimo.com/anthropic/v1' })

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.xiaomimimo.com/anthropic/v1/models',
        headers: expect.objectContaining({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01' }),
      })
    )
  })

  it('uses the base URL verbatim — no version segment is added', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(200, { data: [] }))

    await customProvider.listModels({ ...customCfg, baseUrl: 'https://gw.example.com/openai/v3' })

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://gw.example.com/openai/v3/models' })
    )
  })

  it('does not double the slash when the base URL has a trailing one', async () => {
    mockedHttpRequest.mockResolvedValue(mockResponse(200, { data: [] }))

    await customProvider.listModels({ ...customCfg, baseUrl: 'https://api.example.com/v1/' })

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example.com/v1/models' })
    )
  })

  describe('isAnthropicShaped', () => {
    it('matches an /anthropic path segment case-insensitively', () => {
      expect(customProvider.isAnthropicShaped('https://host.com/anthropic')).toBe(true)
      expect(customProvider.isAnthropicShaped('https://host.com/Anthropic')).toBe(true)
      expect(customProvider.isAnthropicShaped('https://host.com/gateway/anthropic')).toBe(true)
    })

    it('does not match an unrelated host, query string, or malformed URL', () => {
      expect(customProvider.isAnthropicShaped('https://api.anthropic.com')).toBe(false)
      expect(customProvider.isAnthropicShaped('https://host.com/foo?provider=anthropic')).toBe(false)
      expect(customProvider.isAnthropicShaped('not a url')).toBe(false)
    })
  })
})
