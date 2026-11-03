import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'
import { jmapMockResponse } from './fixtures/vite-jmap-mock'

/**
 * A JMAP account feeds the attendee suggestions as a CalDAV/CardDAV one does:
 * the participants of its events, the cards of its address books, and never
 * the account's own participant identity. The shared JMAP mock has no events,
 * identities or contacts, so this spec adds the contacts capability to its
 * session and answers those methods itself.
 */

const CONTACTS = 'urn:ietf:params:jmap:contacts'
const ME = 'fixture@example.com'
const COLLEAGUE = 'alice@example.com'
const CONTACT = 'carol@example.com'

type Invocation = [string, Record<string, unknown>, string]

/** Tomorrow at 10:00, floating: inside the synced range, and a recent meeting. */
function tomorrowAtTen(): string {
  const day = new Date()
  day.setDate(day.getDate() + 1)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T10:00:00`
}

const MEETING = {
  '@type': 'Event',
  id: 'planning',
  uid: 'planning@example.com',
  calendarIds: { personal: true },
  title: 'Planning',
  start: tomorrowAtTen(),
  duration: 'PT1H',
  participants: {
    me: {
      '@type': 'Participant',
      calendarAddress: `mailto:${ME}`,
      name: 'Fixture User',
      roles: { owner: true, attendee: true },
    },
    alice: {
      '@type': 'Participant',
      calendarAddress: `mailto:${COLLEAGUE}`,
      name: 'Alice Example',
      roles: { attendee: true },
      participationStatus: 'accepted',
    },
  },
}

const CARD = {
  id: 'carol',
  addressBookIds: { contacts: true },
  '@type': 'Card',
  version: '1.0',
  name: { '@type': 'Name', full: 'Carol Example' },
  emails: { work: { '@type': 'EmailAddress', address: CONTACT } },
}

/** This spec's answer to one method call, or undefined to leave it to the mock. */
function answer([name, args, callId]: Invocation): Invocation | undefined {
  const accountId = args.accountId as string
  const ids = args.ids as string[] | null | undefined
  const pick = <T extends { id: string }>(all: T[]): T[] =>
    ids == null ? all : all.filter((item) => ids.includes(item.id))
  switch (name) {
    case 'ParticipantIdentity/get':
      return [
        name,
        {
          accountId,
          state: 'identities-1',
          list: [
            { id: 'main', calendarAddress: `mailto:${ME}`, name: 'Fixture User', isDefault: true },
          ],
        },
        callId,
      ]
    case 'CalendarEvent/query':
      return [
        name,
        {
          accountId,
          queryState: 'events-1',
          canCalculateChanges: false,
          position: 0,
          ids: [MEETING.id],
          total: 1,
        },
        callId,
      ]
    case 'CalendarEvent/get':
      return [name, { accountId, state: 'events-1', list: pick([MEETING]), notFound: [] }, callId]
    case 'AddressBook/get':
      return [
        name,
        {
          accountId,
          state: 'books-1',
          list: [
            { id: 'contacts', name: 'JMAP Contacts', myRights: { mayRead: true, mayWrite: true } },
          ],
          notFound: [],
        },
        callId,
      ]
    case 'ContactCard/query':
      return [
        name,
        { accountId, queryState: 'cards-1', position: 0, ids: [CARD.id], total: 1 },
        callId,
      ]
    case 'ContactCard/get':
      return [name, { accountId, state: 'cards-1', list: pick([CARD]), notFound: [] }, callId]
    case 'ContactCard/changes':
      return [
        name,
        {
          accountId,
          oldState: args.sinceState,
          newState: 'cards-1',
          hasMoreChanges: false,
          created: [],
          updated: [],
          destroyed: [],
        },
        callId,
      ]
    default:
      return undefined
  }
}

/** The shared mock, with contacts in its session and the methods above answered. */
async function routeJmap(page: Page): Promise<void> {
  await page.route('**/mock-jmap/**', async (route) => {
    const request = route.request()
    const body = request.postData() ?? ''
    const reply = jmapMockResponse(request.url(), request.method(), body)
    if (request.method() === 'GET') {
      const session = JSON.parse(reply.body) as {
        capabilities: Record<string, unknown>
        accounts: Record<string, { accountCapabilities: Record<string, unknown> }>
      }
      session.capabilities[CONTACTS] = {}
      for (const account of Object.values(session.accounts)) {
        account.accountCapabilities[CONTACTS] = {}
      }
      return route.fulfill({ ...reply, body: JSON.stringify(session) })
    }
    if (request.method() !== 'POST') return route.fulfill(reply)
    const { methodCalls } = JSON.parse(body) as { methodCalls: Invocation[] }
    const methodResponses = methodCalls.map((call) => {
      const own = answer(call)
      if (own) return own
      const single = jmapMockResponse(
        request.url(),
        'POST',
        JSON.stringify({ methodCalls: [call] })
      )
      return (JSON.parse(single.body) as { methodResponses: Invocation[] }).methodResponses[0]
    })
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionState: 'session-1', methodResponses }),
    })
  })
}

async function connect(page: Page): Promise<void> {
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
}

test.describe('attendee suggestions from a JMAP account', () => {
  test('offers event participants and contacts, never the account identity', async ({ page }) => {
    await routeJmap(page)
    await connect(page)

    // A fresh load: the address books of every account sync on start.
    await page.goto('/month')
    await expect(
      page.locator('[data-component="calendar-grid"]').getByText('Planning').first()
    ).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-date]').first().click()
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal.locator('[data-component="event-title-input"]').fill('Follow-up')
    await modal
      .locator('[data-component="event-calendar-select"]')
      .selectOption({ label: 'JMAP Personal' })
    await modal.locator('[data-component="event-advanced-toggle"]').click()
    const input = modal.getByLabel('Add attendee email')
    const list = page.getByRole('listbox', { name: 'Suggested attendees' })

    // Met in a JMAP event, with the name the event gives.
    await input.fill('ali')
    const colleague = list.locator(`[data-email="${COLLEAGUE}"]`)
    await expect(colleague).toBeVisible({ timeout: 15_000 })
    await expect(colleague).toContainText('Alice Example')

    // In a JMAP address book.
    await input.fill('car')
    const contact = list.locator(`[data-email="${CONTACT}"]`)
    await expect(contact).toBeVisible({ timeout: 15_000 })
    await expect(contact).toContainText('Carol Example')

    // The account's participant identity is the user: not offered.
    await input.fill('fix')
    await expect(
      page.locator(`[data-component="attendee-suggestion"][data-email="${ME}"]`)
    ).toHaveCount(0)

    await input.fill('car')
    await contact.click()
    await expect(modal.getByText(CONTACT, { exact: true })).toBeVisible()
  })
})
