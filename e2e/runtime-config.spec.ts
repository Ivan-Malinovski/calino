import { expect, test } from '@playwright/test'
import { encryptWithMasterPassword } from '../src/lib/crypto'
import { clearState } from './fixtures/localstorage'

const masterPassword = 'test runtime config unlock'

async function configFor(url: string, name: string, password: string, gateway: string) {
  const encrypt = (value: string) => encryptWithMasterPassword(value, masterPassword)
  const [server, username, secret, header] = await Promise.all([
    encrypt(url),
    encrypt('user'),
    encrypt(password),
    encrypt(gateway),
  ])
  return {
    version: 1,
    accounts: [{ name, url: server, username, password: secret, headers: { 'X-Gateway': header } }],
  }
}

test('a mounted config provisions and rotates a CalDAV account after reload', async ({
  page,
  baseURL,
}) => {
  await clearState(page)
  const url = `${baseURL}/mock-caldav/dav/`
  let current = await configFor(url, 'Mounted calendar', 'first-password', 'first-gateway')
  let loads = 0
  await page.route('**/calino.config.json', (route) => {
    loads++
    return route.fulfill({ json: current, headers: { 'Cache-Control': 'no-store' } })
  })

  const unlock = page.locator('#master-password')
  const account = (name: string) =>
    page.locator('[data-component="connected-accounts"]').getByText(name, { exact: true })
  const storedAccountIds = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('calino_caldav_accounts') ?? '[]').map(
        (entry: { id: string }) => entry.id
      )
    )

  await page.goto('/settings?tab=caldav')
  await expect(unlock).toBeVisible()
  await unlock.fill(masterPassword)
  await unlock.press('Enter')
  await expect(account('Mounted calendar')).toBeVisible()
  const ids = await storedAccountIds()
  expect(ids).toHaveLength(1)
  expect(loads).toBe(1)

  current = await configFor(url, 'Rotated calendar', 'second-password', 'second-gateway')
  const rotatedSync = page.waitForRequest(
    async (request) =>
      request.method() === 'REPORT' &&
      request.url().startsWith(url) &&
      request.headers()['x-gateway'] === 'second-gateway' &&
      (await request.headerValue('authorization')) ===
        `Basic ${Buffer.from('user:second-password').toString('base64')}`
  )
  await page.reload()
  await rotatedSync
  await expect(account('Rotated calendar')).toBeVisible()
  await expect(unlock).toBeHidden()
  expect(await storedAccountIds()).toEqual(ids)
  expect(loads).toBe(2)
})

test('a config containing only an encrypted webcal feed can be unlocked', async ({
  page,
  baseURL,
}) => {
  await clearState(page)
  const url = `${baseURL}/configured-feed.ics`
  const encryptedUrl = await encryptWithMasterPassword(url, masterPassword)
  await page.route('**/calino.config.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        webcalSubscriptions: [{ name: 'Mounted feed', url: encryptedUrl }],
      },
    })
  )
  await page.route(url, (route) =>
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
  await page.goto('/month')
  const unlock = page.locator('#master-password')
  await expect(unlock).toBeVisible()
  const feed = page.waitForResponse(url)
  await unlock.fill(masterPassword)
  await unlock.press('Enter')
  expect((await feed).ok()).toBe(true)
  await expect(unlock).toBeHidden()

  const calendars = page.locator('[data-component="calendar-section-toggle"]')
  if ((await calendars.getAttribute('aria-expanded')) !== 'true') await calendars.click()
  await expect(page.getByText('Mounted feed', { exact: true })).toBeVisible()
})

test('hosted config sign-in downloads and unlocks the config without leaving Calino', async ({
  page,
  baseURL,
}) => {
  await clearState(page)
  const config = await configFor(
    `${baseURL}/mock-caldav/dav/`,
    'Private config calendar',
    'dav-password',
    'test-gateway'
  )
  await page.route('**/calino.config.json', async (route) => {
    const authorization = await route.request().headerValue('authorization')
    if (authorization !== `Basic ${Buffer.from('fixture:download-password').toString('base64')}`) {
      return route.fulfill({ status: 401, headers: { 'X-Calino-Config-Auth': 'basic' } })
    }
    return route.fulfill({ json: config })
  })

  await page.goto('/settings?tab=caldav')
  const dialog = page.getByRole('dialog', { name: 'Connect to hosted configuration' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Username')).toBeFocused()
  await dialog.getByRole('button', { name: 'Continue without it' }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Connect to hosted configuration' }).click()
  await dialog.getByLabel('Username').fill('fixture')
  await dialog.getByLabel('Sign-in password').fill('wrong-password')
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('The username or password is incorrect.')
  await expect(dialog.getByLabel('Sign-in password')).toBeEmpty()

  await dialog.getByLabel('Sign-in password').fill('download-password')
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL('/settings?tab=caldav')

  const unlock = page.locator('#master-password')
  await expect(unlock).toBeVisible()
  await unlock.fill(masterPassword)
  await unlock.press('Enter')
  await expect(
    page
      .locator('[data-component="connected-accounts"]')
      .getByText('Private config calendar', { exact: true })
  ).toBeVisible()

  expect(
    await page.evaluate(
      () =>
        JSON.stringify(localStorage).includes('download-password') ||
        JSON.stringify(sessionStorage).includes('download-password')
    )
  ).toBe(false)
})
