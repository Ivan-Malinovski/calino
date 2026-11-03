import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'
import { jmapMockResponse } from './fixtures/vite-jmap-mock'

/**
 * An event with attendees needs an organizer on JMAP too: a server only sends
 * invitations for a meeting it can tie to one of the account's participant
 * identities. Calino names the account's default identity as the owner of the
 * meeting; the shared JMAP mock has no identities of its own, so this spec
 * answers `ParticipantIdentity/get` and records the `CalendarEvent/set` itself.
 */

const ATTENDEE = 'guest@example.com'

interface JmapCall {
  methodCalls: [string, Record<string, unknown>, string][]
}

/** Route the mock's API, with `identities` answered and event writes recorded. */
async function routeJmap(
  page: Page,
  identities: Record<string, unknown>[] | 'unsupported'
): Promise<Record<string, unknown>[]> {
  const created: Record<string, unknown>[] = []
  await page.route('**/mock-jmap/api', async (route) => {
    const request = route.request()
    const body = request.postData() ?? ''
    const { methodCalls } = JSON.parse(body) as JmapCall
    const [name, args, callId] = methodCalls[0]
    if (methodCalls.length === 1 && name === 'ParticipantIdentity/get') {
      const response =
        identities === 'unsupported'
          ? ['error', { type: 'unknownMethod' }, callId]
          : [name, { accountId: args.accountId, state: 'identities-1', list: identities }, callId]
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionState: 'session-1', methodResponses: [response] }),
      })
    }
    if (methodCalls.length === 1 && name === 'CalendarEvent/set') {
      const entries = Object.entries((args.create ?? {}) as Record<string, Record<string, unknown>>)
      for (const [, event] of entries) created.push(event)
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionState: 'session-1',
          methodResponses: [
            [
              name,
              {
                accountId: args.accountId,
                oldState: 'events-1',
                newState: 'events-2',
                created: Object.fromEntries(entries.map(([key], i) => [key, { id: `new-${i}` }])),
              },
              callId,
            ],
          ],
        }),
      })
    }
    return route.fulfill(jmapMockResponse(request.url(), request.method(), body))
  })
  return created
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

async function createInvitation(page: Page, title: string): Promise<void> {
  await page.goto('/month')
  await page.locator('[data-date]').first().click()
  const modal = page.locator('[data-component="modal-card"]')
  await expect(modal).toBeVisible()
  await modal.locator('[data-component="event-title-input"]').fill(title)
  await modal
    .locator('[data-component="event-calendar-select"]')
    .selectOption({ label: 'JMAP Personal' })
  await modal.locator('[data-component="event-advanced-toggle"]').click()
  const attendeeInput = modal.getByLabel('Add attendee email')
  await attendeeInput.fill(ATTENDEE)
  await attendeeInput.press('Enter')
  await modal.locator('[data-component="modal-save"]').click()
  await expect(modal).toBeHidden({ timeout: 10_000 })
}

function participantsOf(event: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (event.participants ?? {}) as Record<string, Record<string, unknown>>
}

test.describe('organizer of a JMAP event with attendees', () => {
  test('names the default participant identity as the owner', async ({ page }) => {
    const created = await routeJmap(page, [
      { id: 'alias', calendarAddress: 'mailto:alias@example.com', name: 'Alias' },
      {
        id: 'main',
        calendarAddress: 'mailto:fixture@example.com',
        name: 'Fixture User',
        isDefault: true,
      },
    ])
    await connect(page)
    await createInvitation(page, 'Planning meeting')

    await expect.poll(() => created.length, { timeout: 15_000 }).toBe(1)
    const owners = Object.values(participantsOf(created[0])).filter(
      (p) => (p.roles as Record<string, unknown> | undefined)?.owner === true
    )
    expect(owners).toHaveLength(1)
    expect(JSON.stringify(owners[0])).toContain('fixture@example.com')
    expect(owners[0].name).toBe('Fixture User')
    expect(JSON.stringify(participantsOf(created[0]))).toContain(ATTENDEE)
  })

  test('leaves the meeting without an owner when the server has no identity', async ({ page }) => {
    const created = await routeJmap(page, 'unsupported')
    await connect(page)
    await createInvitation(page, 'Identity-less meeting')

    await expect.poll(() => created.length, { timeout: 15_000 }).toBe(1)
    const roles = Object.values(participantsOf(created[0])).map((p) => p.roles)
    expect(JSON.stringify(roles)).not.toContain('owner')
    expect(JSON.stringify(participantsOf(created[0]))).toContain(ATTENDEE)
  })
})
