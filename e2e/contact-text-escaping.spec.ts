/**
 * A vCard escapes `,`, `;`, `\` and newlines in its text values (RFC 6350
 * §3.4), so a contact named "Martin, Jean" is stored as `FN:Martin\, Jean`.
 * FN was shown without unescaping (`Martin\, Jean` in the list), and each save
 * escaped it once more (`Martin\\\, Jean`). N, ORG, ADR and CATEGORIES were
 * split on every delimiter, escaped or not.
 *
 * The CardDAV mock is one shared server, so the specs run serially.
 */
import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

test.describe.configure({ mode: 'serial' })

const MOCK = '/mock-carddav/__test__'
const CARD = '/mock-carddav/dav/addressbooks/user/book/martin.vcf'

const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:uid-martin',
  'FN:Martin\\, Jean',
  'N:Martin;Jean;;;',
  'ORG:ACME\\, Inc.;R&D',
  'NOTE:Met at the fair\\, booth 4',
  'CATEGORIES:R\\, D,Friends',
  'END:VCARD',
  '',
].join('\r\n')

test.describe('contacts — escaped vCard text', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}${MOCK}/reset`)
    await page.request.put(`${baseURL}${MOCK}/put?name=martin.vcf`, { data: VCARD })
    await clearState(page)
    await seedAccount(page, {
      id: 'carddav-account',
      name: 'Mock CardDAV',
      serverUrl: `${baseURL}/mock-carddav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [],
    })
  })

  test('shows a name, organization, note and tags without the escapes', async ({ page }) => {
    await page.goto('/contacts')

    await page.getByText('Martin, Jean', { exact: true }).first().click()

    await expect(page.getByRole('heading', { name: 'Martin, Jean' })).toBeVisible()
    await expect(page.getByText('ACME, Inc.', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Met at the fair, booth 4').first()).toBeVisible()
    const filter = page.getByRole('group', { name: 'Filter by tag' })
    await expect(filter.getByRole('button')).toHaveText(['All', 'Friends', 'R, D'])
    await expect(page.getByText('\\,')).toHaveCount(0)
  })

  test('saving the contact writes the same escaped values back', async ({ page, baseURL }) => {
    await page.goto('/contacts')
    await page.getByText('Martin, Jean', { exact: true }).first().click()

    await page.getByRole('button', { name: 'Edit contact' }).click()
    await page.getByRole('button', { name: /^Save$/ }).click()

    await expect
      .poll(async () => (await page.request.get(`${baseURL}${CARD}`)).text())
      .toContain('PRODID:-//Calino//')
    const stored = await (await page.request.get(`${baseURL}${CARD}`)).text()
    expect(stored).toContain('\r\nFN:Martin\\, Jean\r\n')
    expect(stored).toContain('\r\nORG:ACME\\, Inc.;R&D\r\n')
    expect(stored).toContain('\r\nCATEGORIES:R\\, D,Friends\r\n')
  })
})
