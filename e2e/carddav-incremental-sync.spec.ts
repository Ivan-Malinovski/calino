import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount, STORAGE_KEYS } from './fixtures/localstorage'

/**
 * End-to-end coverage for CardDAV sync against a server that writes its XML
 * the way Radicale does: `DAV:` as the default namespace, CardDAV as `CR:`
 * (issue #173). The mock (`vite-carddav-mock.ts`) keeps a real RFC 6578 change
 * log, so these specs can tell an incremental sync from a full re-fetch by the
 * requests the app makes — which is the whole point of incremental sync and is
 * not visible in the UI.
 *
 * The mock is one shared server, so the specs run serially.
 */
test.describe.configure({ mode: 'serial' })

const MOCK = '/mock-carddav/__test__'

function vcard(uid: string, name: string): string {
  const [given, ...rest] = name.split(' ')
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${uid}`,
    `FN:${name}`,
    `N:${rest.join(' ')};${given};;;`,
    'END:VCARD',
    '',
  ].join('\r\n')
}

interface LoggedRequest {
  method: string
  path: string
  kind?: string
  hrefs?: number
}

class Mock {
  constructor(
    private readonly page: Page,
    private readonly base: string
  ) {}

  reset() {
    return this.page.request.post(`${this.base}${MOCK}/reset`)
  }
  put(file: string, uid: string, name: string) {
    return this.page.request.put(`${this.base}${MOCK}/put?name=${encodeURIComponent(file)}`, {
      data: vcard(uid, name),
    })
  }
  delete(file: string) {
    return this.page.request.delete(`${this.base}${MOCK}/delete?name=${encodeURIComponent(file)}`)
  }
  clearLog() {
    return this.page.request.post(`${this.base}${MOCK}/clear-log`)
  }
  shortMultiget(count: number) {
    return this.page.request.post(`${this.base}${MOCK}/short-multiget?count=${count}`)
  }
  async reports(): Promise<LoggedRequest[]> {
    const res = await this.page.request.get(`${this.base}${MOCK}/log`)
    return ((await res.json()) as LoggedRequest[]).filter((r) => r.kind)
  }
}

/** The persisted contact store, as the app wrote it. */
async function storedBook(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const state = JSON.parse(raw).state
    return {
      names: (state.contacts as Array<{ displayName: string }>).map((c) => c.displayName).sort(),
      syncToken: (state.addressBooks as Array<{ syncToken: string | null }>)[0]?.syncToken ?? null,
    }
  }, STORAGE_KEYS.contacts)
}

async function expectContacts(page: Page, names: string[]) {
  await expect.poll(async () => (await storedBook(page))?.names ?? []).toEqual([...names].sort())
}

test.describe('carddav — namespace-aware, incremental sync', () => {
  let mock: Mock

  test.beforeEach(async ({ page, baseURL }) => {
    mock = new Mock(page, baseURL!)
    await mock.reset()
    await mock.put('alice.vcf', 'uid-alice', 'Alice Adams')
    await mock.put('bob.vcf', 'uid-bob', 'Bob Brown')
    // Spaces and an accent: the href on the wire is percent-encoded, and the
    // client has to send it back that way in a multiget.
    await mock.put('josé álvarez.vcf', 'uid-jose', 'José Álvarez')
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

  test('reads contacts and stores a sync token from a default-namespace server', async ({
    page,
  }) => {
    await page.goto('/contacts')

    await expectContacts(page, ['Alice Adams', 'Bob Brown', 'José Álvarez'])
    await expect(page.getByText('José Álvarez', { exact: true }).first()).toBeVisible()
    // The token lives in the response *body*; a header lookup used to throw and
    // report every token as invalidated.
    await expect.poll(async () => (await storedBook(page))?.syncToken).toMatch(/\/sync\/\d+$/)
  })

  test('the next sync downloads only what changed and applies deletions', async ({ page }) => {
    await page.goto('/contacts')
    await expectContacts(page, ['Alice Adams', 'Bob Brown', 'José Álvarez'])
    await expect.poll(async () => (await storedBook(page))?.syncToken).not.toBeNull()

    await mock.put('bob.vcf', 'uid-bob', 'Bob Brown-Smith')
    await mock.put('carol.vcf', 'uid-carol', 'Carol Clark')
    await mock.delete('josé álvarez.vcf')
    await mock.clearLog()

    await page.reload()
    await expectContacts(page, ['Alice Adams', 'Bob Brown-Smith', 'Carol Clark'])

    const reports = await mock.reports()
    expect(reports.map((r) => r.kind)).toContain('sync-collection')
    // Two changed cards fetched by multiget — not the whole book.
    const multigets = reports.filter((r) => r.kind === 'addressbook-multiget')
    expect(multigets).toHaveLength(1)
    expect(multigets[0].hrefs).toBe(2)
    expect(reports.some((r) => r.kind === 'addressbook-query')).toBe(false)
  })

  test('an unchanged address book is not re-downloaded', async ({ page }) => {
    await page.goto('/contacts')
    await expectContacts(page, ['Alice Adams', 'Bob Brown', 'José Álvarez'])
    await expect.poll(async () => (await storedBook(page))?.syncToken).not.toBeNull()
    await mock.clearLog()

    await page.reload()
    await expectContacts(page, ['Alice Adams', 'Bob Brown', 'José Álvarez'])
    await expect(page.getByText('Alice Adams', { exact: true }).first()).toBeVisible()

    const kinds = (await mock.reports()).map((r) => r.kind)
    expect(kinds).not.toContain('addressbook-multiget')
    expect(kinds).not.toContain('addressbook-query')
  })

  test('a multiget that comes back short falls back to a full fetch and keeps every contact', async ({
    page,
  }) => {
    await page.goto('/contacts')
    await expectContacts(page, ['Alice Adams', 'Bob Brown', 'José Álvarez'])
    await expect.poll(async () => (await storedBook(page))?.syncToken).not.toBeNull()

    await mock.put('bob.vcf', 'uid-bob', 'Bob Brown-Smith')
    await mock.put('carol.vcf', 'uid-carol', 'Carol Clark')
    await mock.shortMultiget(1)
    await mock.clearLog()

    await page.reload()
    await expectContacts(page, ['Alice Adams', 'Bob Brown-Smith', 'Carol Clark', 'José Álvarez'])

    const kinds = (await mock.reports()).map((r) => r.kind)
    // The short multiget must not be taken as a complete delta: the full fetch that
    // replaced it is what carried the contact the multiget dropped.
    expect(kinds).toContain('addressbook-query')
  })
})
