import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { encryptWithMasterPassword } from '../src/lib/crypto'
import { clearState } from './fixtures/localstorage'

test('subpath deployments sign in and cache assets within their service worker scope', async ({
  page,
}) => {
  const password = 'subpath test password'
  const authorization = `Basic ${Buffer.from(`calino:${password}`).toString('base64')}`
  let encryptedFeedUrl: string
  const server = await createServer({
    base: '/cal/',
    cacheDir: 'node_modules/.vite-subpath-test',
    define: {
      __CALINO_RUNTIME_CONFIG__: 'true',
      'import.meta.env.CALINO_ENABLE_SW': '"true"',
    },
    server: { host: '127.0.0.1', port: 0, ws: false },
    plugins: [
      {
        name: 'subpath-test-config',
        configureServer(vite) {
          vite.middlewares.use('/cal/calino.config.json', (req, res) => {
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('X-Calino-Config-Mode', 'quick-start')
            if (req.headers.authorization !== authorization) {
              res.statusCode = 401
              res.setHeader('X-Calino-Config-Auth', 'basic')
              res.end()
              return
            }
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                version: 1,
                unlockWithSignIn: true,
                webcalSubscriptions: [{ name: 'Subpath calendar', url: encryptedFeedUrl }],
              })
            )
          })
        },
      },
    ],
  })

  try {
    await server.listen()
    const entry = new URL(server.resolvedUrls!.local[0])
    const feedUrl = new URL('sample-events.ics', entry).href
    encryptedFeedUrl = await encryptWithMasterPassword(feedUrl, password)

    await clearState(page)
    await page.goto(new URL('month', entry).href)
    const dialog = page.getByRole('dialog', { name: 'Connect to hosted configuration' })
    await expect(dialog).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
      .toBe(new URL('sw.js', entry).href)

    await dialog.getByLabel('Sign-in password').fill(password)
    const feed = page.waitForResponse(feedUrl)
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
    expect((await feed).ok()).toBe(true)
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new URL('month', entry).href)
    const calendars = page.locator('[data-component="calendar-section-toggle"]')
    if ((await calendars.getAttribute('aria-expanded')) !== 'true') await calendars.click()
    await expect(page.getByText('Subpath calendar', { exact: true })).toBeVisible()

    const cachedUrls = await page.evaluate(async () => {
      const names = await caches.keys()
      const entries = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))
      return entries.flat().map((request) => new URL(request.url).pathname)
    })
    expect(cachedUrls).toContain('/cal/manifest.json')
    expect(cachedUrls).not.toContain('/cal/calino.config.json')
    expect(cachedUrls.every((url) => url.startsWith('/cal/'))).toBe(true)
  } finally {
    await server.close()
  }
})
