import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test('connects and syncs through a cross-origin gateway requiring Pangolin-style headers', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Playwright baseURL is required')
  await clearState(page)
  const methods: string[] = []
  let preflights = 0
  const gateway = createServer(async (request, response) => {
    const origin = request.headers.origin ?? '*'
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS, PROPFIND, REPORT',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Depth, If-Match, If-None-Match, P-Access-Token-Id, P-Access-Token',
      'Access-Control-Expose-Headers': 'ETag, DAV, Location',
    }
    if (request.method === 'OPTIONS') {
      preflights++
      response.writeHead(204, cors).end()
      return
    }
    if (
      request.headers['p-access-token-id'] !== 'test-id' ||
      request.headers['p-access-token'] !== 'test-secret'
    ) {
      response.writeHead(403, cors).end('Gateway rejected missing or incorrect access headers')
      return
    }
    methods.push(request.method ?? '')
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const headers: Record<string, string> = { host: request.headers.host ?? '' }
    for (const name of ['authorization', 'content-type', 'depth', 'if-match', 'if-none-match']) {
      const value = request.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    try {
      const upstream = await fetch(`${baseURL}${request.url}`, {
        method: request.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: 'manual',
      })
      const resultHeaders: Record<string, string> = { ...cors }
      for (const name of ['content-type', 'etag', 'location', 'dav']) {
        const value = upstream.headers.get(name)
        if (value) resultHeaders[name] = value
      }
      // The Vite mock emits absolute DAV hrefs using its own Host. A real
      // reverse proxy emits its public origin, so reproduce that here.
      const publicOrigin = `http://${request.headers.host}`
      const body = Buffer.from(await upstream.arrayBuffer())
        .toString('utf8')
        .replaceAll(baseURL, publicOrigin)
      response.writeHead(upstream.status, resultHeaders)
      response.end(body)
    } catch (error) {
      response.writeHead(502, cors).end(error instanceof Error ? error.message : 'Upstream failed')
    }
  })
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve))
  const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
    await page.getByText('Add calendar account').click()
    const dialog = page.getByRole('dialog', { name: /add caldav account/i })
    await dialog.getByLabel('Server URL').fill(`${gatewayUrl}/mock-caldav/dav/`)
    await dialog.getByLabel('Username').fill('demo')
    await dialog.getByLabel('Password').fill('demo')
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(dialog.getByText(/server refused/i)).toBeVisible()
    // A 403 with no headers set points at the gateway headers and opens a first row.
    await dialog.getByRole('button', { name: /Add a header/ }).click()
    await expect(dialog.getByLabel('Header 1 name')).toBeFocused()
    await dialog.getByLabel('Header 1 name').fill('P-Access-Token-Id')
    await dialog.getByRole('textbox', { name: 'Header 1 value' }).fill('test-id')
    await dialog.getByRole('button', { name: 'Add header' }).click()
    await dialog.getByLabel('Header 2 name').fill('P-Access-Token')
    await dialog.getByRole('textbox', { name: 'Header 2 value' }).fill('test-secret')
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    expect(preflights).toBeGreaterThan(0)
    expect(methods).toContain('PROPFIND')
    expect(methods).toContain('REPORT')
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()))
  }
})
