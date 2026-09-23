import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test('custom DAV headers are stored masked and used during account connection', async ({
  page,
}) => {
  await clearState(page)
  const seen: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/mock-caldav/') && request.method() === 'PROPFIND') {
      seen.push(request.headers()['p-access-token'] ?? '')
    }
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
  await page.getByText('Add calendar account').click()
  const dialog = page.getByRole('dialog', { name: /add caldav account/i })
  await dialog.getByLabel('Server URL').fill(`${new URL(page.url()).origin}/mock-caldav/`)
  await dialog.getByLabel('Username').fill('demo')
  await dialog.getByLabel('Password').fill('demo')
  await dialog.getByRole('button', { name: /Connection settings/ }).click()
  await dialog.getByRole('button', { name: 'Add header' }).click()
  await dialog.getByLabel('Header 1 name').fill('P-Access-Token')
  await dialog.getByRole('textbox', { name: 'Header 1 value' }).fill('example-secret')
  await expect(dialog.getByRole('textbox', { name: 'Header 1 value' })).toHaveAttribute(
    'type',
    'password'
  )
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  expect(seen).toContain('example-secret')
  const stored = await page.evaluate(() => localStorage.getItem('calino_caldav_credentials'))
  expect(stored).not.toContain('example-secret')
  await page.reload()
  await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
  await page.locator('[data-action="edit-account"]').first().click()
  const editDialog = page.getByRole('dialog', { name: /edit caldav account/i })
  await expect(editDialog.getByRole('textbox', { name: 'Header 1 value' })).toHaveValue(
    'example-secret'
  )
  await expect(editDialog.getByRole('textbox', { name: 'Header 1 value' })).toHaveAttribute(
    'type',
    'password'
  )
  await editDialog.getByRole('button', { name: 'Remove header 1' }).click()
  await editDialog.getByRole('button', { name: /save/i }).click()
  await expect(editDialog).toBeHidden({ timeout: 30_000 })
  const updated = await page.evaluate(() => localStorage.getItem('calino_caldav_credentials'))
  expect(updated).not.toContain('P-Access-Token')
})

test('setup generator encrypts custom header values in the downloaded config', async ({ page }) => {
  await page.goto('/setup')
  await page.getByLabel('Server URL').fill('https://dav.example.com/')
  await page.getByLabel('Username').fill('demo')
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: /Connection settings/ }).click()
  await page.getByRole('button', { name: 'Add header' }).click()
  await page.getByLabel('Header 1 name').fill('CF-Access-Client-Secret')
  await page.getByRole('textbox', { name: 'Header 1 value' }).fill('gateway-secret')
  await page.getByRole('button', { name: 'Add Account' }).click()
  await page.getByRole('button', { name: /Next/ }).click()
  await page.getByLabel('Master Password').fill('test-master-password')
  await page.getByLabel('Confirm Password').fill('test-master-password')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Generate Config' }).click()
  const download = await downloadPromise
  const file = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of file) chunks.push(Buffer.from(chunk))
  const content = Buffer.concat(chunks).toString('utf8')
  const config = JSON.parse(content)
  expect(content).not.toContain('gateway-secret')
  expect(config.accounts[0].headers['CF-Access-Client-Secret']).toMatchObject({
    ciphertext: expect.any(String),
  })
})
