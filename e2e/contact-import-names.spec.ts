import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

test('vCard import preserves parameterized names and quoted-printable contact details through sync and reload', async ({
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
    'ADR;HOME;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;;M=C3=BCnchner Stra=C3=9Fe=3B Hinterhaus;K=C3=B6ln;;50667;Deutschland',
    'NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Gr=C3=BC=C3=9Fe aus K=C3=B6ln, den =',
    'Code am Tor eingeben',
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
    const savedCard = (await saved.text()).replace(/\r\n[ \t]/g, '')
    expect(savedCard).toContain(`N:${structuredName}\r\n`)
    if (uid === 'uid-quoted-printable-name') {
      expect(savedCard).toMatch(/ADR[^:]*:;;Münchner Straße\\; Hinterhaus;Köln;;50667;Deutschland/)
      expect(savedCard).toContain('NOTE:Grüße aus Köln\\, den Code am Tor eingeben')
    }
  }

  await page.goto('/contacts')
  await page.reload()
  await page.getByRole('button', { name: 'Jane Doe' }).click()
  await expect(page.getByRole('heading', { name: 'Jane Doe' })).toBeVisible()
  await expect(page.getByText('ACME', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Jürgen Müller' }).click()
  await expect(page.getByRole('heading', { name: 'Jürgen Müller' })).toBeVisible()
})
