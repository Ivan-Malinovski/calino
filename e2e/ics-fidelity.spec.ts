import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * Editing an event must not destroy the parts of it Calino doesn't model.
 *
 * Calino maps iCalendar into a flat struct, and used to re-serialize a resource
 * from that struct on every save — so renaming an event written by Thunderbird
 * or Nextcloud silently dropped its GEO, CLASS, PRIORITY, X- properties, alarm
 * details and attendee parameters, for everyone sharing the calendar.
 *
 * The unit suite covers the serializer directly. This spec is the end-to-end
 * proof: a real edit made through the UI, asserted against the exact bytes on
 * the server. It is the test that would have caught the original bug.
 */

const COLLECTION = '/dav/calendars/user/ics-fid/'

/** Properties Calino has no field for. None may change when it saves. */
const UNMODELLED = [
  'GEO:52.52;13.405',
  'CLASS:CONFIDENTIAL',
  'PRIORITY:2',
  'RESOURCES:Projector,Whiteboard',
  'COMMENT:A comment nobody should lose',
  'CONTACT:Jane Doe',
  'RELATED-TO;RELTYPE=PARENT:parent-uid-99',
  'X-ALT-DESC;FMTTYPE=text/html:<html>rich body</html>',
  'X-MOZ-LASTACK:20260101T120000Z',
  'X-CUSTOM-FLAG:keepme',
]

function richResource(day: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // Another client's PRODID: a rebuild used to replace this with Calino's.
    'PRODID:-//Other Client//Their Product//EN',
    'BEGIN:VEVENT',
    'UID:fidelity-uid',
    `DTSTART:${day}T120000Z`,
    `DTEND:${day}T130000Z`,
    'SUMMARY:Rich remote event',
    'DESCRIPTION:Original body',
    'SEQUENCE:0',
    ...UNMODELLED,
    'ORGANIZER;CN=Boss;SENT-BY="mailto:asst@example.com":mailto:boss@example.com',
    'ATTENDEE;CN=Alice;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CUTYPE=INDIVIDUAL;MEMBER="mailto:team@example.com":mailto:alice@example.com',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Alarm text',
    // Relative to the END of the event — rebuilding rewrote this start-relative,
    // which silently moved the alarm.
    'TRIGGER;RELATED=END:-PT15M',
    'REPEAT:3',
    'DURATION:PT5M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/**
 * The stored .ics for the seeded resource.
 *
 * The mock shares a dev server with the whole suite and can reset a connection
 * mid-request under parallel load, so retry rather than fail on a blip — the
 * same reasoning as `reportCalendar` in calendar-sync.spec.ts.
 */
async function dump(page: Page, baseURL: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await page.request.get(
        `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
      )
      const stored = (await r.json()) as Record<string, string>
      const entry = Object.entries(stored).find(([path]) => path.includes('fidelity'))
      if (entry) return entry[1]
      return ''
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error('dump failed 5 times')
}

test.describe('iCalendar fidelity through the UI', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
  })

  test('renaming a remote event preserves everything Calino does not model', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'fidelity-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      // seedAccount defaults to Personal only; this spec owns its own
      // collection so a parallel spec cannot change the bytes it reads back.
      calendars: [{ name: 'ICS Fidelity', path: 'calendars/user/ics-fid/', isDefault: true }],
    })

    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    const calendarUrl = `${baseURL}/mock-caldav/dav/calendars/user/ics-fid/`
    await page.request.put(`${calendarUrl}fidelity-resource.ics`, { data: richResource(day) })

    // Fail here rather than at the sync poll if the seed itself didn't land.
    expect(await dump(page, baseURL!)).toContain('SUMMARY:Rich remote event')

    // Sync it down, so the original is captured and the event is editable.
    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const stored = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
            return (stored.state?.events ?? []).map((event: { title: string }) => event.title)
          }),
        { timeout: 15_000 }
      )
      .toContain('Rich remote event')

    const eventCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Rich remote event' })
      .first()
    await expect(eventCard).toBeVisible({ timeout: 10_000 })
    await eventCard.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()
    await page.locator('[data-component="event-title-input"]').fill('Renamed by Calino')
    await page.locator('[data-component="modal-save"]').click()

    // Wait for the edit to reach the server before reading the bytes back.
    await expect
      .poll(() => dump(page, baseURL!), { timeout: 15_000 })
      .toContain('SUMMARY:Renamed by Calino')

    const stored = await dump(page, baseURL!)

    // The edit landed...
    expect(stored).toContain('SUMMARY:Renamed by Calino')
    expect(stored).not.toContain('SUMMARY:Rich remote event')

    // ...and nothing else moved.
    for (const property of UNMODELLED) {
      expect(stored, `${property.split(/[;:]/)[0]} was lost`).toContain(property)
    }

    // The origin server's PRODID is not replaced with Calino's.
    expect(stored).toContain('PRODID:-//Other Client//Their Product//EN')

    // Scheduling parameters belonging to whoever organised the meeting.
    expect(stored).toContain('CUTYPE=INDIVIDUAL')
    expect(stored).toContain('MEMBER="mailto:team@example.com"')
    expect(stored).toContain('SENT-BY="mailto:asst@example.com"')

    // The alarm was not touched, so its end-relative trigger still means the
    // same instant and its unmodelled detail survives.
    expect(stored).toContain('TRIGGER;RELATED=END:-PT15M')
    expect(stored).toContain('REPEAT:3')
    expect(stored).toContain('DESCRIPTION:Alarm text')

    // One resource, one event — patching must not duplicate the component.
    expect(stored.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(stored.match(/UID:fidelity-uid/g)).toHaveLength(1)
  })
})
