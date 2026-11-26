import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

test('vCard import preserves parameterized and quoted-printable names through sync and reload', async ({
  page,
  baseURL,
}) => {
  await page.request.post(`${baseURL}/mock-carddav/__test__/reset`)
  await clearState(page)
  await seedAccount(page, {
    id: 'contact-import-account',
    name: 'Contact import',
    serverUrl: `${baseURL}/mock-carddav/dav/`,
    username: 'user',
    password: 'pass',
    calendars: [],
  })
  await page.goto('/contacts')
  await expect(page.getByRole('button', { name: '+ New' })).toBeEnabled()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Data', exact: true }).click()

  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:uid-parameterized-name',
    'FN;CHARSET=utf-8:Jane Doe',
    'N;CHARSET=utf-8:Doe;Jane;;;',
    'ORG;LANGUAGE=en-us:ACME',
    'END:VCARD',
    'BEGIN:VCARD',
    'VERSION:2.1',
    'UID:uid-quoted-printable-name',
    'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=BCrgen M=C3=BCller',
    'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen;;;',
    'END:VCARD',
    '',
  ].join('\r\n')
  await page.locator('input[type="file"][accept=".vcf,text/vcard"]').setInputFiles({
    name: 'parameterized-names.vcf',
    mimeType: 'text/vcard',
    buffer: Buffer.from(vcard),
  })
  const dialog = page.getByRole('dialog', { name: 'Import Contacts' })
  await expect(dialog.getByText('Jane Doe', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Jürgen Müller', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Import 2 Contacts' }).click()
  await expect(dialog).toBeHidden()

  for (const [uid, name, structuredName] of [
    ['uid-parameterized-name', 'Jane Doe', 'Doe;Jane;;;'],
    ['uid-quoted-printable-name', 'Jürgen Müller', 'Müller;Jürgen;;;'],
  ]) {
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${baseURL}/mock-carddav/dav/addressbooks/user/book/${uid}.vcf`
        )
        return response.text()
      })
      .toContain(`FN:${name}\r\n`)
    const saved = await page.request.get(
      `${baseURL}/mock-carddav/dav/addressbooks/user/book/${uid}.vcf`
    )
    expect(await saved.text()).toContain(`N:${structuredName}\r\n`)
  }

  await page.goto('/contacts')
  await page.reload()
  await page.getByRole('button', { name: 'Jane Doe' }).click()
  await expect(page.getByRole('heading', { name: 'Jane Doe' })).toBeVisible()
  await expect(page.getByText('ACME', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Jürgen Müller' }).click()
  await expect(page.getByRole('heading', { name: 'Jürgen Müller' })).toBeVisible()
})
