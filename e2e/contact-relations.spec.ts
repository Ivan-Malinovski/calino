/**
 * Regression spec for issue #87 — "Contact relations: uuids not resolving to contacts".
 *
 * The relation input hints that a UUID may be entered. Doing so writes a
 * correct `urn:uuid:<uid>` to the address book, but nothing ever resolved that
 * reference back to the contact it points at: RELATED rendered the raw string
 * and MEMBER rendered the string with a case-sensitive `urn:uuid:` strip.
 *
 * These specs assert that a reference renders as the target contact's NAME and
 * navigates to it. One of them deliberately points across address books: UIDs
 * are globally unique (RFC 6350 §6.7.6) and the contact store is flat, so a
 * cross-book reference must resolve. The issue reporter assumed this was
 * impossible — it isn't, and scoping the lookup to one book would break it.
 */
import { test, expect } from '@playwright/test'
import { clearState, seedContacts } from './fixtures/localstorage'

const ALICE = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const BOB = '9c858901-8a57-4791-81fe-4c455b099bc9'
const CAROL = 'b9d0a3f2-1c4e-4a7b-8f31-2e6d5c8a9b04'

test.describe('contact relations — uuid references resolve', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedContacts(
      page,
      [
        { id: 'book-personal', name: 'Personal' },
        { id: 'book-work', name: 'Work' },
      ],
      [
        {
          id: ALICE,
          displayName: 'Alice Adams',
          addressBookId: 'book-personal',
          // Uppercase scheme on purpose: the old UI hinted `URN:uuid:`, and the
          // previous MEMBER strip was case-sensitive.
          related: [{ value: `URN:UUID:${BOB}`, type: 'co-worker' }],
        },
        { id: BOB, displayName: 'Bob Brown', addressBookId: 'book-work' },
        { id: CAROL, displayName: 'Carol Clark', addressBookId: 'book-personal' },
      ]
    )
  })

  test('a relation pointing at a contact in another address book renders as that name', async ({
    page,
  }) => {
    await page.goto('/contacts')

    await page.getByText('Alice Adams', { exact: true }).first().click()

    const link = page.locator('[data-component="contact-relation-link"]')
    await expect(link).toHaveCount(1)
    // The bug: this showed the raw `URN:UUID:9c858901-…` string.
    await expect(link).toContainText('Bob Brown')
    await expect(link).not.toContainText(BOB)
    // Bob lives in a different address book, so that is surfaced as context.
    await expect(link).toContainText('Work')
  })

  test('clicking a resolved relation navigates to that contact', async ({ page }) => {
    await page.goto('/contacts')
    await page.getByText('Alice Adams', { exact: true }).first().click()

    await page.locator('[data-component="contact-relation-link"]').click()

    // Bob's detail pane is now shown. He has no relations of his own.
    await expect(page.getByRole('heading', { name: 'Bob Brown' })).toBeVisible()
    await expect(page.locator('[data-component="contact-relation-link"]')).toHaveCount(0)
  })

  test('a relation added via the picker is stored as a uuid and renders as a name', async ({
    page,
  }) => {
    await page.goto('/contacts')
    await page.getByText('Carol Clark', { exact: true }).first().click()

    await page.getByRole('button', { name: 'Edit contact' }).click()
    await page.getByRole('button', { name: '+ Add related contact' }).click()

    const picker = page.locator('[data-component="related-contact-picker"]')
    await picker.click()
    await picker.fill('Alice')
    await page.locator('[data-component="contact-picker-option"]').first().click()

    await page.getByRole('button', { name: /^Save$/ }).click()

    // Stored as a canonical uuid reference…
    const stored = await page.evaluate((uid) => {
      const raw = localStorage.getItem('calino-contacts')
      const parsed = raw ? JSON.parse(raw) : null
      const carol = parsed?.state?.contacts?.find((c: { id: string }) => c.id === uid)
      return carol?.related?.[0]?.value ?? null
    }, CAROL)
    expect(stored).toBe(`urn:uuid:${ALICE}`)

    // …and displayed as a name, not a uuid.
    const link = page.locator('[data-component="contact-relation-link"]')
    await expect(link).toContainText('Alice Adams')
    await expect(link).not.toContainText(ALICE)
  })
})
