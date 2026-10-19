/**
 * Spec for issue #206 — "Tag (Group) Selector for Contacts".
 *
 * The tag filter used to exist only as a side effect of clicking a tag on a
 * contact's detail pane, so reaching a filtered view meant first finding a
 * contact that carried the tag. The list now shows a chip row with every tag
 * plus "All", driven by the same tag filter. Several tags can be active at once; a contact
 * matches when it carries any of them.
 */
import { test, expect } from '@playwright/test'
import { clearState, seedContacts } from './fixtures/localstorage'

test.describe('contacts — tag filter chips', () => {
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
          id: 'c1',
          displayName: 'Ana Petrova',
          addressBookId: 'book-personal',
          categories: ['Family'],
        },
        {
          id: 'c2',
          displayName: 'Boris Petrov',
          addressBookId: 'book-personal',
          categories: ['Family', 'Friends'],
        },
        {
          id: 'c3',
          displayName: 'Clara Cole',
          addressBookId: 'book-personal',
          categories: ['Friends'],
        },
        { id: 'c4', displayName: 'Dan Doe', addressBookId: 'book-personal' },
        { id: 'c5', displayName: 'Eve Ellis', addressBookId: 'book-work', categories: ['Clients'] },
      ]
    )
  })

  test('lists every tag and filters the list when one is picked', async ({ page }) => {
    await page.goto('/contacts')

    const filter = page.getByRole('group', { name: 'Filter by tag' })
    await expect(filter.getByRole('button')).toHaveText(['All', 'Clients', 'Family', 'Friends'])
    await expect(filter.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByText('5 contacts')).toBeVisible()

    await filter.getByRole('button', { name: 'Family' }).click()

    await expect(filter.getByRole('button', { name: /Family/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByText('2 contacts')).toBeVisible()
    await expect(page.getByText('Ana Petrova', { exact: true })).toBeVisible()
    await expect(page.getByText('Boris Petrov', { exact: true })).toBeVisible()
    await expect(page.getByText('Clara Cole', { exact: true })).toHaveCount(0)
  })

  test('several tags can be active at once and show every contact carrying any of them', async ({
    page,
  }) => {
    await page.goto('/contacts')
    const filter = page.getByRole('group', { name: 'Filter by tag' })

    await filter.getByRole('button', { name: 'Family' }).click()
    await filter.getByRole('button', { name: 'Clients' }).click()

    await expect(filter.getByRole('button', { name: /Family/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(filter.getByRole('button', { name: /Clients/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(filter.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    // Ana + Boris (Family) and Eve (Clients); Clara (Friends) stays out.
    await expect(page.getByText('3 contacts')).toBeVisible()
    await expect(page.getByText('Eve Ellis', { exact: true })).toBeVisible()
    await expect(page.getByText('Clara Cole', { exact: true })).toHaveCount(0)

    // Turning one tag off leaves the other active.
    await filter.getByRole('button', { name: /Clients/ }).click()
    await expect(page.getByText('2 contacts')).toBeVisible()

    await filter.getByRole('button', { name: 'All' }).click()
    await expect(page.getByText('5 contacts')).toBeVisible()
  })

  test('"All" and a second click on the active tag both clear the filter', async ({ page }) => {
    await page.goto('/contacts')
    const filter = page.getByRole('group', { name: 'Filter by tag' })

    await filter.getByRole('button', { name: 'Friends' }).click()
    await expect(page.getByText('2 contacts')).toBeVisible()

    await filter.getByRole('button', { name: 'All' }).click()
    await expect(page.getByText('5 contacts')).toBeVisible()

    await filter.getByRole('button', { name: 'Friends' }).click()
    await expect(page.getByText('2 contacts')).toBeVisible()
    await filter.getByRole('button', { name: /Friends/ }).click()
    await expect(page.getByText('5 contacts')).toBeVisible()
  })

  test('the tag filter narrows a search too', async ({ page }) => {
    await page.goto('/contacts')
    const filter = page.getByRole('group', { name: 'Filter by tag' })

    await filter.getByRole('button', { name: 'Family' }).click()
    await page.getByRole('textbox', { name: 'Search contacts…' }).fill('Clara')

    await expect(page.getByText('No matches')).toBeVisible()
  })

  test('tags follow the selected address book', async ({ page }) => {
    await page.goto('/contacts')
    const filter = page.getByRole('group', { name: 'Filter by tag' })

    await page.locator('select').selectOption({ label: 'Work' })

    await expect(filter.getByRole('button')).toHaveText(['All', 'Clients'])
  })
})

test.describe('contacts — tag filter chips, mouse drag', () => {
  test.beforeEach(async ({ page }) => {
    const tags = Array.from({ length: 14 }, (_, i) => `Group ${String(i + 1).padStart(2, '0')}`)
    await clearState(page)
    await seedContacts(
      page,
      [{ id: 'book-personal', name: 'Personal' }],
      [{ id: 'c1', displayName: 'Ana Petrova', addressBookId: 'book-personal', categories: tags }]
    )
  })

  test('the chip row can be dragged sideways with the mouse without toggling a tag', async ({
    page,
  }) => {
    await page.goto('/contacts')
    const row = page.locator('[data-component="contact-tag-filter"]')
    await expect(row).toBeVisible()
    const scrollLeft = (): Promise<number> => row.evaluate((el) => el.scrollLeft)
    expect(await scrollLeft()).toBe(0)

    const box = (await row.boundingBox())!
    const y = box.y + box.height / 2
    // Press on a chip, drag left, release over a chip.
    await page.mouse.move(box.x + box.width - 40, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 140, y, { steps: 8 })
    await page.mouse.up()

    expect(await scrollLeft()).toBeGreaterThan(50)
    await expect(row.locator('[aria-pressed="true"]')).toHaveText('All')
    await expect(page.getByText('1 contact', { exact: true })).toBeVisible()
  })
})
