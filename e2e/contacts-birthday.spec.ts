/**
 * Regression spec for issue #84 — "Birthday/anniversary calendar events
 * created from contacts are not persisted/synced to CalDAV Backend".
 *
 * "Add to calendar" used to write to the local store only; the next sync
 * pass replaced the store with server truth and the event vanished, even
 * mid-session. The fix routes the create through the CalDAV client and
 * round-trips the `calino:contact:<id>` URL marker on VEVENT so "On
 * calendar" survives a reload, and asks which calendar to use when several
 * are writable.
 *
 * These specs assert the SERVER side (mock dump) and the marker round-trip,
 * not just the local UI, because the bug was exactly "looks fine locally,
 * gone after sync".
 *
 * The mock serves every collection to every account, so boot discovery adds
 * them all as writable — the calendar picker therefore always appears, which
 * also exercises the #84 "ask which calendar" branch. Tests that don't care
 * about the target simply pick Personal.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  clearState,
  seedAccount,
  seedContacts,
  seedStoreCalendars,
} from './fixtures/localstorage'

// A collection of this spec's own. It asserts the exact number of copies on
// the server, so it cannot share one with a spec that resets it — and
// `calendar-sync.spec.ts` resets `personal/` in its beforeEach, which under
// `fullyParallel` deleted the birthday this spec had just written.
const BIRTHDAYS = '/dav/calendars/user/birthdays/'
// This spec's own second writable calendar. It used `work/`, but
// `event-move.spec.ts` resets that collection in its beforeEach and the two
// wiped each other under `fullyParallel`. Seeded below under the name 'Work'
// so the calendar picker still reads naturally.
const WORK = '/dav/calendars/user/b-work/'
const BIRTHDAY_MARKER = (contactId: string) => `calino:contact:${contactId}`

/**
 * Snapshot the mock's stored resources under a collection prefix. The mock
 * shares a dev server with the whole suite and under parallel load that
 * server can reset a connection mid-request (ECONNRESET); a raw throw inside
 * expect.poll fails instantly instead of retrying, so absorb resets and
 * return null — poll matchers treat null as "not the target state yet".
 */
async function dump(
  page: Page,
  baseURL: string,
  prefix: string
): Promise<Record<string, string> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await page.request.get(
        `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(prefix)}`
      )
      return (await response.json()) as Record<string, string>
    } catch {
      if (attempt === 2) return null
      await page.waitForTimeout(250)
    }
  }
  return null
}

/** Any stored ICS under the prefix contains the given marker? */
function dumpHasMarker(dumpData: Record<string, string> | null, marker: string): boolean {
  return Object.values(dumpData ?? {}).some((ics) => ics.includes(marker))
}

/**
 * Seed the CalDAV account with Personal + every other collection the mock
 * serves (ids matching what boot discovery would produce), plus matching
 * store calendars — deterministic from first paint, no discovery race.
 */
async function seedAllCalendars(page: Page, baseURL: string): Promise<void> {
  const extras = [
    { name: 'Move Source', path: 'calendars/user/move-source/' },
    { name: 'Work', path: 'calendars/user/b-work/' },
    { name: 'Journal Work', path: 'calendars/user/j-work/' },
    { name: 'Journal Personal', path: 'calendars/user/j-personal/' },
  ] as const
  const account = {
    id: 'bday-acct',
    name: 'Birthday',
    serverUrl: `${baseURL}/mock-caldav/dav/`,
    username: 'test',
    password: 'test',
    calendars: [
      { id: 'cal-birthdays', name: 'Birthdays', path: 'calendars/user/birthdays/' },
      ...extras.map((c) => ({
        id: `${baseURL}/mock-caldav/dav/${c.path}`,
        name: c.name,
        path: c.path,
        isDefault: false,
      })),
    ],
  }
  await seedAccount(page, account)
  await seedStoreCalendars(
    page,
    account.calendars.map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault }))
  )
}

/** Click "Add to calendar" and choose the given target in the picker. */
async function addBirthdayTo(page: Page, calendarName: string): Promise<void> {
  await page.getByRole('button', { name: /Add to calendar/ }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: /Add birthday to/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: calendarName, exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Birthday added to calendar')).toBeVisible()
}

test.describe('contact birthday → calendar (#84)', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('adding a birthday persists it to the server and keeps it after reload', async ({
    page,
    baseURL,
  }) => {
    await seedAllCalendars(page, baseURL!)
    await seedContacts(
      page,
      [{ id: 'ab1', name: 'Work' }],
      [{ id: 'c1', displayName: 'Ada Lovelace', addressBookId: 'ab1', birthday: '1815-12-10' }]
    )

    await page.goto('/contacts')
    await page.getByRole('button', { name: 'Ada Lovelace' }).click()
    await addBirthdayTo(page, 'Birthdays')

    // Server-side proof: the VEVENT must actually land on the CalDAV mock,
    // recurring (RRULE), carrying the contact marker that "On calendar" keys on.
    await expect
      .poll(
        async () => dumpHasMarker(await dump(page, baseURL!, BIRTHDAYS), BIRTHDAY_MARKER('c1')),
        { timeout: 15_000 }
      )
      .toBe(true)
    const birthdays = (await dump(page, baseURL!, BIRTHDAYS)) ?? {}
    const landed = Object.values(birthdays).find((ics) => ics.includes(BIRTHDAY_MARKER('c1')))
    expect(landed).toContain('RRULE')

    // After a reload the app rehydrates from localStorage + syncs from the
    // server; the marker must round-trip (VEVENT URL was only parsed for
    // VJOURNAL pre-fix) so the button flips to "On calendar" instead of
    // offering a duplicate create.
    await page.reload()
    await page.goto('/contacts')
    await page.getByRole('button', { name: 'Ada Lovelace' }).click()
    await expect(page.getByRole('button', { name: /On calendar/ })).toBeVisible()

    // And exactly one copy on the server — no duplicate from the second visit.
    const afterReload = (await dump(page, baseURL!, BIRTHDAYS)) ?? {}
    const copies = Object.values(afterReload).filter((ics) => ics.includes(BIRTHDAY_MARKER('c1')))
    expect(copies).toHaveLength(1)
  })

  test('with several writable calendars, the chosen one receives the birthday', async ({
    page,
    baseURL,
  }) => {
    await seedAllCalendars(page, baseURL!)
    await seedContacts(
      page,
      [{ id: 'ab1', name: 'Work' }],
      [{ id: 'c2', displayName: 'Grace Hopper', addressBookId: 'ab1', birthday: '1906-12-09' }]
    )

    await page.goto('/contacts')
    await page.getByRole('button', { name: 'Grace Hopper' }).click()
    await addBirthdayTo(page, 'Work')

    // No silent "first calendar the server listed" — the user's choice is
    // where the VEVENT lands.
    await expect
      .poll(
        async () => dumpHasMarker(await dump(page, baseURL!, WORK), BIRTHDAY_MARKER('c2')),
        { timeout: 15_000 }
      )
      .toBe(true)
    const birthdays = (await dump(page, baseURL!, BIRTHDAYS)) ?? {}
    expect(dumpHasMarker(birthdays, BIRTHDAY_MARKER('c2'))).toBe(false)
  })

  test('undo removes the birthday from the server, not just the store', async ({
    page,
    baseURL,
  }) => {
    await seedAllCalendars(page, baseURL!)
    await seedContacts(
      page,
      [{ id: 'ab1', name: 'Work' }],
      [{ id: 'c3', displayName: 'Katherine Johnson', addressBookId: 'ab1', birthday: '1918-08-26' }]
    )

    await page.goto('/contacts')
    await page.getByRole('button', { name: 'Katherine Johnson' }).click()
    await addBirthdayTo(page, 'Birthdays')

    // Let the create PUT land before undoing — otherwise the undo's DELETE
    // can race the create and 404, leaving the resource on the server.
    await expect
      .poll(
        async () => dumpHasMarker(await dump(page, baseURL!, BIRTHDAYS), BIRTHDAY_MARKER('c3')),
        { timeout: 15_000 }
      )
      .toBe(true)

    await page.getByRole('button', { name: 'Undo' }).click()

    // Undo retracts the server copy too (the pre-fix code deleted only the
    // local store record, so a later sync would resurrect the event).
    await expect
      .poll(
        async () => !dumpHasMarker(await dump(page, baseURL!, BIRTHDAYS), BIRTHDAY_MARKER('c3')),
        { timeout: 15_000 }
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: /Add to calendar/ })).toBeVisible()
  })

  test('deleting the contact also removes its birthday from the server', async ({
    page,
    baseURL,
  }) => {
    await seedAllCalendars(page, baseURL!)
    await seedContacts(
      page,
      [{ id: 'ab1', name: 'Work' }],
      [{ id: 'c4', displayName: 'Mary Jackson', addressBookId: 'ab1', birthday: '1921-04-09' }]
    )

    await page.goto('/contacts')
    await page.getByRole('button', { name: 'Mary Jackson' }).click()
    await addBirthdayTo(page, 'Birthdays')
    await expect
      .poll(
        async () => dumpHasMarker(await dump(page, baseURL!, BIRTHDAYS), BIRTHDAY_MARKER('c4')),
        { timeout: 15_000 }
      )
      .toBe(true)

    // Delete the contact: the first click arms a 3 s confirm window (the
    // button's title flips to "Click again to confirm"; its aria-label stays
    // "Delete contact"), the second commits the delete.
    await page.getByRole('button', { name: 'Delete contact' }).click()
    await expect(page.getByTitle('Click again to confirm')).toBeVisible()
    await page.getByTitle('Click again to confirm').click()

    // The orphaned birthday VEVENT must go too — before this fix deleting a
    // contact left `calino:contact:c4` on the server forever.
    await expect
      .poll(
        async () => !dumpHasMarker(await dump(page, baseURL!, BIRTHDAYS), BIRTHDAY_MARKER('c4')),
        { timeout: 15_000 }
      )
      .toBe(true)
  })
})
