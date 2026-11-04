import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * An address book the server shares read-only — a team directory every user can
 * read — next to the user's own book. The mock (`vite-carddav-mock.ts`) answers
 * for it what Radicale does: only `<read/>` in current-user-privilege-set, and
 * 403 on any write. The app must not offer to change it: no edit, no delete, no
 * new contact, no merge, no import into it.
 *
 * The mock is one shared server, so the specs run serially.
 */
test.describe.configure({ mode: 'serial' })

const MOCK = '/mock-carddav/__test__'

function vcard(uid: string, name: string, email: string): string {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${uid}`,
    `FN:${name}`,
    `N:;${name};;;`,
    `EMAIL:${email}`,
    'END:VCARD',
    '',
  ].join('\r\n')
}

/** Paths of the cards the app wrote (PUT) to the mock, relative to its mount. */
async function writes(page: Page, baseURL: string): Promise<string[]> {
  const res = await page.request.get(`${baseURL}${MOCK}/log`)
  return ((await res.json()) as Array<{ method: string; path: string }>)
    .filter((r) => r.method === 'PUT' || r.method === 'DELETE')
    .map((r) => r.path)
}

test.describe('carddav — read-only address book', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}${MOCK}/reset`)
    await page.request.put(`${baseURL}${MOCK}/put?name=alice.vcf`, {
      data: vcard('uid-alice', 'Alice Adams', 'alice@example.com'),
    })
    await page.request.put(`${baseURL}${MOCK}/put?book=team&name=bob.vcf`, {
      data: vcard('uid-bob', 'Bob Brown', 'bob@example.com'),
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
  })

  test('a contact of the read-only book can be read but not edited or deleted', async ({
    page,
  }) => {
    await page.goto('/contacts')

    await page.getByRole('button', { name: 'Bob Brown' }).click()
    await expect(page.getByText('Team Directory (read-only)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit contact' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Delete contact' })).toBeDisabled()
    // Double-click is the inline edit; the name must stay a heading, not turn into an input.
    await page.getByRole('heading', { name: 'Bob Brown' }).dblclick()
    await expect(page.getByRole('heading', { name: 'Bob Brown' })).toBeVisible()

    await page.getByRole('button', { name: 'Alice Adams' }).click()
    await expect(page.getByRole('button', { name: 'Edit contact' })).toBeEnabled()
    await expect(page.getByText(/\(read-only\)/)).toHaveCount(0)
  })

  test('"+ New" never puts a contact into the read-only book', async ({ page, baseURL }) => {
    await page.goto('/contacts')
    await expect(page.getByRole('button', { name: 'Bob Brown' })).toBeVisible()

    // One writable book left: straight to the form, no picker offering the team book.
    await page.getByRole('button', { name: '+ New' }).click()
    await expect(page.getByText('Choose address book')).toBeHidden()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('New Contact').fill('Carol Clark')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(() => writes(page, baseURL!)).toHaveLength(1)
    expect((await writes(page, baseURL!))[0]).toMatch(/^\/dav\/addressbooks\/user\/book\//)
  })

  test('"+ New" is disabled while every address book is read-only', async ({ page, baseURL }) => {
    // Only the team book is listed: the user can read contacts but write none.
    await page.request.post(`${baseURL}${MOCK}/own-book?listed=0`)
    await page.goto('/contacts')
    await expect(page.getByRole('button', { name: 'Bob Brown' })).toBeVisible()

    const newButton = page.getByRole('button', { name: '+ New' })
    await expect(newButton).toBeDisabled()
    await expect(newButton).toHaveAttribute('title', 'No address book you can write to')

    // A writable book shows up on the next sync: "+ New" works again.
    await page.request.post(`${baseURL}${MOCK}/own-book?listed=1`)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Alice Adams' })).toBeVisible()
    await expect(newButton).toBeEnabled()
    await expect(newButton).not.toHaveAttribute('title')
    await newButton.click()
    await expect(page.getByRole('dialog').getByPlaceholder('New Contact')).toBeVisible()
  })

  test('importing a vCard file targets a writable book', async ({ page, baseURL }) => {
    await page.goto('/contacts')
    await expect(page.getByRole('button', { name: 'Bob Brown' })).toBeVisible()

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await page.getByTestId('import-contacts-input').setInputFiles({
      name: 'carol.vcf',
      mimeType: 'text/vcard',
      buffer: Buffer.from(vcard('uid-carol', 'Carol Clark', 'carol@example.com')),
    })
    await page.getByRole('dialog').getByRole('button', { name: 'Import 1 Contact' }).click()

    await expect.poll(() => writes(page, baseURL!)).toHaveLength(1)
    expect((await writes(page, baseURL!))[0]).toMatch(/^\/dav\/addressbooks\/user\/book\//)
  })

  test('a duplicate in the read-only book is not offered for merging', async ({
    page,
    baseURL,
  }) => {
    // Same email as Alice in the writable book: a high-confidence duplicate.
    await page.request.put(`${baseURL}${MOCK}/put?book=team&name=alice.vcf`, {
      data: vcard('uid-alice-team', 'Alice Adams', 'alice@example.com'),
    })
    await page.goto('/contacts')
    await expect(page.getByRole('button', { name: 'Bob Brown' })).toBeVisible()

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await page.getByRole('button', { name: 'Merge…' }).click()
    await expect(page.getByRole('dialog').getByText('No duplicates found')).toBeVisible()
  })
})
