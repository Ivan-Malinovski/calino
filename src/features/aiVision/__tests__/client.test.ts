import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../http', () => ({
  httpRequest: vi.fn(),
}))

import { httpRequest } from '../http'
import { testConnection } from '../client'
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

const cfg: ProviderRequestConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKey: 'sk-test',
  model: 'gpt-4o',
}

beforeEach(() => {
  mockedHttpRequest.mockReset()
})

describe('testConnection', () => {
  it('returns ok + visionCapable when listModels and the vision probe both succeed with YES', async () => {
    mockedHttpRequest
      .mockResolvedValueOnce(mockResponse(200, { data: [{ id: 'gpt-4o' }] }))
      .mockResolvedValueOnce(mockResponse(200, { choices: [{ message: { content: 'YES' } }] }))

    const result = await testConnection(cfg)

    expect(result).toEqual({ ok: true, visionCapable: true })
  })

  it('returns ok + visionCapable:false with a hint when the model replies NO', async () => {
    mockedHttpRequest
      .mockResolvedValueOnce(mockResponse(200, { data: [{ id: 'gpt-4o' }] }))
      .mockResolvedValueOnce(mockResponse(200, { choices: [{ message: { content: 'NO' } }] }))

    const result = await testConnection(cfg)

    expect(result.ok).toBe(true)
    expect(result.visionCapable).toBe(false)
    expect(result.hint).toMatch(/vision-capable/i)
  })

  it('returns ok:false when listModels fails (bad key)', async () => {
    mockedHttpRequest.mockResolvedValueOnce(mockResponse(401, { error: { message: 'bad key' } }))

    const result = await testConnection(cfg)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/authentication failed/i)
    expect(result.hint).toBeTruthy()
    // Only one call should have been made — never got to the vision probe.
    expect(mockedHttpRequest).toHaveBeenCalledTimes(1)
  })

  it('returns ok:false when the vision probe call itself fails (e.g. bad model id)', async () => {
    mockedHttpRequest
      .mockResolvedValueOnce(mockResponse(200, { data: [{ id: 'gpt-4o' }] }))
      .mockResolvedValueOnce(mockResponse(404, { error: { message: 'model not found' } }))

    const result = await testConnection(cfg)

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('never throws even on unexpected errors', async () => {
    mockedHttpRequest.mockRejectedValueOnce(new Error('network down'))

    const result = await testConnection(cfg)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/network down/)
  })
})
