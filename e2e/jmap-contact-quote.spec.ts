/**
 * A double quote in a contact value is an ordinary character. Creating a
 * contact on a JMAP account serializes it to a vCard and converts that to a
 * JSContact card; the converter used to treat the quote as opening a quoted
 * run, which hid the `;` after it: `ORG:12" Records;Sales` stored one
 * organization named `12" Records;Sales` with no unit.
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'
import { jmapMockResponse, type JmapContactStore } from './fixtures/vite-jmap-mock'

test('a contact with a double quote in its organization keeps its department', async ({ page }) => {
  // Calino only switches contacts on once the server already holds one.
  const contacts: JmapContactStore = new Map([
    [
      'seed',
      {
        id: 'seed',
        '@type': 'Card',
        version: '1.0',
        addressBookIds: { contacts: true },
        name: { '@type': 'Name', full: 'Existing Person' },
      },
    ],
  ])
  await page.route('**/mock-jmap/**', (route) => {
    const request = route.request()
    return route.fulfill(
      jmapMockResponse(request.url(), request.method(), request.postData() ?? '', contacts)
    )
  })
  await clearState(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
  await page.locator('[data-action="add-account"]').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Display name').fill('JMAP fixture')
  await dialog.getByLabel('Server URL').fill(`${new URL(page.url()).origin}/mock-jmap`)
  await dialog.getByLabel('Username').fill('fixture-user')
  await dialog.getByLabel('Password').fill('fixture-password')
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  await page.goto('/contacts')
  await expect(page.getByText('Existing Person', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '+ New' }).click()
  const form = page.getByRole('dialog')
  await form.getByPlaceholder('Given name').fill('Pat')
  await form.getByPlaceholder('Family name').fill('O"Neil')
  await form.getByPlaceholder('Organization').fill('12" Records')
  await form.getByPlaceholder('Department').fill('Sales')
  await form.getByRole('button', { name: /^Save$/ }).click()

  await expect.poll(() => contacts.size).toBe(2)
  const card = contacts.get('card-2') as unknown as {
    name: { components: { kind: string; value: string }[] }
    organizations: Record<string, { name: string; units?: { name: string }[] }>
  }
  expect(card.name.components).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'surname', value: 'O"Neil' }),
      expect.objectContaining({ kind: 'given', value: 'Pat' }),
    ])
  )
  expect(Object.values(card.organizations)).toEqual([
    expect.objectContaining({
      name: '12" Records',
      units: [expect.objectContaining({ name: 'Sales' })],
    }),
  ])

  // The list shows the organization alone; the bug showed `12" Records;Sales`.
  await expect(page.getByText('12" Records', { exact: true }).first()).toBeVisible()
})
