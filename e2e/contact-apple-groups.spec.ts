import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

test('shows Apple grouped contact fields and preserves their labels on save', async ({
  page,
  baseURL,
}) => {
  const mock = `${baseURL}/mock-carddav/__test__`
  const cardUrl = `${baseURL}/mock-carddav/dav/addressbooks/user/book/apple.vcf`
  await page.request.post(`${mock}/reset`)
  await page.request.put(`${mock}/put?name=apple.vcf`, {
    data: [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:uid-apple',
      'FN:Jamie Appleseed',
      'N:Appleseed;Jamie;;;',
      'item1.EMAIL:school@example.com',
      'item1.X-ABLabel:School',
      'item2.TEL:+15555550111',
      'item2.X-ABLabel:_$!<Mobile>!$_',
      'item3.ADR;TYPE=HOME:;;1 Infinite Loop;Cupertino;CA;95014;United States',
      'item3.X-ABADR:us',
      'item4.URL:https\\://example.com',
      'END:VCARD',
      '',
    ].join('\r\n'),
  })
  await clearState(page)
  await seedAccount(page, {
    id: 'carddav-account',
    name: 'Mock CardDAV',
    serverUrl: `${baseURL}/mock-carddav/dav/`,
    username: 'user',
    password: 'pass',
    calendars: [],
  })

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Jamie Appleseed' }).click()
  await expect(page.getByRole('link', { name: 'school@example.com' })).toBeVisible()
  await expect(page.getByRole('link', { name: '+15555550111' })).toBeVisible()
  await expect(page.getByText(/1 Infinite Loop/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'https://example.com' })).toBeVisible()

  await page.getByRole('button', { name: 'Edit contact' }).click()
  await page.locator('input[type="email"]').first().fill('updated-school@example.com')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  const readCard = async () =>
    (await (await page.request.get(cardUrl)).text()).replace(/\r\n[ \t]/g, '')
  await expect.poll(readCard).toMatch(/^item1\.EMAIL[^:]*:updated-school@example\.com\r?$/m)
  const saved = await readCard()
  expect(saved).toContain('item1.X-ABLabel:School')
  expect(saved).toMatch(/^item2\.TEL[^:]*:\+15555550111\r?$/m)
  expect(saved).toMatch(/^item3\.ADR[^:]*:;;1 Infinite Loop;/m)
  expect(saved).toContain('item3.X-ABADR:us')
  expect(saved).toMatch(/^item4\.URL[^:]*:https:\/\/example\.com\r?$/m)
  expect(saved.match(/updated-school@example\.com/g)).toHaveLength(1)
})
