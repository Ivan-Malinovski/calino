import { expect, test } from '@playwright/test'

test.describe('setup page', () => {
  test('scrolls when the wizard is taller than the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 })
    await page.goto('/setup')

    const setupPage = page.getByRole('main')
    const addSubscription = page.getByRole('button', { name: 'Add Subscription' })

    await expect(setupPage).toBeVisible()
    await expect(addSubscription).not.toBeInViewport()

    await addSubscription.scrollIntoViewIfNeeded()

    await expect(addSubscription).toBeInViewport()
    expect(await setupPage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  })
})

test('Docker quick start exports one file and connects with just the sign-in password', async ({
  page,
  baseURL,
}) => {
  const password = 'demo-quick-start-password'
  const feed = `${baseURL}/quick-start-feed.ics?token=private-feed-token`
  const name = 'Quick-start $calendar'
  await page.route(feed, (route) =>
    route.fulfill({
      contentType: 'text/calendar',
      body: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Calino//Test//EN',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    })
  )

  await page.goto('/setup')
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Calendar URL').fill(feed)
  await page.getByRole('button', { name: 'Add Subscription' }).click()
  await page.getByRole('button', { name: /Next/ }).click()
  await page.getByLabel('Master Password').fill(password)
  await page.getByLabel('Confirm Password').fill(password)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Compose file' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('compose.yaml')
  const chunks: Buffer[] = []
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk))
  const compose = Buffer.concat(chunks).toString('utf8')
  expect(compose).toContain('CALINO_CONFIG_AUTH_HASH: "$$argon2id')
  expect(compose).toContain('target: /calino/calino.config.json')
  expect(compose).not.toContain(password)
  expect(compose).not.toContain('private-feed-token')
  expect(compose).toContain('Quick-start $$calendar')
  const inlineConfig = compose.split('content: |-\n')[1]
  const config = JSON.parse(inlineConfig.replaceAll('$$', () => '$'))
  expect(config).toMatchObject({
    unlockWithSignIn: true,
    webcalSubscriptions: [{ name }],
  })
  await expect(page.getByText('docker compose up -d', { exact: true })).toBeVisible()

  await page.route('**/calino.config.json', async (route) => {
    const headers = { 'X-Calino-Config-Mode': 'quick-start' }
    const authorization = await route.request().headerValue('authorization')
    if (authorization === `Basic ${Buffer.from(`calino:${password}`).toString('base64')}`) {
      return route.fulfill({ json: config, headers })
    }
    return route.fulfill({ status: 401, headers: { ...headers, 'X-Calino-Config-Auth': 'basic' } })
  })

  await page.goto('/month')
  const signIn = page.getByRole('dialog', { name: 'Connect to hosted configuration' })
  await expect(signIn.getByLabel('Username')).toHaveCount(0)
  await signIn.getByLabel('Sign-in password').fill(password)
  const subscribed = page.waitForResponse(feed)
  await signIn.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await subscribed).ok()).toBe(true)
  await expect(signIn).toBeHidden()
  await expect(page.locator('#master-password')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('calino.masterPassword'))).toBeNull()
})
