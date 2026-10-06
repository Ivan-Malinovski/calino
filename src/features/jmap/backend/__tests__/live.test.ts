import { describe, expect, it } from 'vitest'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import { createJmapCalendarBackend } from '../JmapCalendarBackend'
import { eventIcs } from './fixtures'

const serverUrl = globalThis.process.env.CALINO_TEST_JMAP_URL
const username = globalThis.process.env.CALINO_TEST_JMAP_USER
const password = globalThis.process.env.CALINO_TEST_JMAP_PASS

describe.skipIf(!serverUrl || !username || !password)('live JMAP calendar backend', () => {
  it('creates, reads, patches, syncs, moves and deletes a recurring meeting', async () => {
    const backend = await createJmapCalendarBackend(
      serverUrl!,
      { id: 'live', serverUrl: serverUrl!, username: username!, password: password! },
      null
    )
    const suffix = crypto.randomUUID()
    const calendars: string[] = []
    const resources = new Set<string>()
    let cleanupFailures: number
    try {
      const source = await backend.createCalendar({
        name: `Calino backend test ${suffix}`,
        color: '#123456',
        description: 'Temporary lifecycle test',
      })
      calendars.push(source.url)
      const target = await backend.createCalendar({
        name: `Calino backend destination ${suffix}`,
        color: '#654321',
      })
      calendars.push(target.url)
      await backend.updateCalendar(source.url, { name: `Calino backend renamed ${suffix}` })
      expect(
        (await backend.fetchCalendars()).find((calendar) => calendar.url === source.url)?.name
      ).toBe(`Calino backend renamed ${suffix}`)
      const initial = await backend.syncCollection(source.url, null)
      expect(initial.tokenInvalidated).toBe(false)
      expect(initial.newSyncToken).toBeTruthy()
      const ics = eventIcs(`calino-backend-${suffix}`).replaceAll('owner@example.test', username!)
      const created = await backend.createEvent(source.url, ics, 'ignored.ics')
      resources.add(created.url)
      const fetched = (await backend.fetchResourceByHref(created.url))!
      expect(fetched.etag).toBe(created.etag)
      const parsed = parseICALData(fetched.data, 'live')
      expect(parsed[0].title).toBe('Team meeting')
      expect(fetched.data.includes('RRULE:')).toBe(true)
      expect(fetched.data.includes('EXDATE')).toBe(true)
      expect(fetched.data.includes('ATTENDEE')).toBe(true)
      expect(fetched.data.includes('BEGIN:VALARM')).toBe(true)
      const added = await backend.syncCollection(source.url, initial.newSyncToken)
      expect(added.tokenInvalidated).toBe(false)
      expect(added.changes).toContainEqual({
        href: created.url,
        etag: created.etag,
        status: 'changed',
      })
      const updated = await backend.updateEvent(
        source.url,
        created.url,
        fetched.data.replace('SUMMARY:Team meeting', 'SUMMARY:Changed meeting'),
        fetched.etag!
      )
      expect(updated.etag).not.toBe(created.etag)
      await expect(
        backend.updateEvent(source.url, created.url, ics, created.etag)
      ).rejects.toMatchObject({ status: 412 })
      const edited = await backend.syncCollection(source.url, added.newSyncToken)
      expect(edited.tokenInvalidated).toBe(false)
      expect(edited.changes).toContainEqual({
        href: updated.url,
        etag: updated.etag,
        status: 'changed',
      })
      const current = (await backend.fetchResourceByHref(updated.url))!
      const moved = await backend.updateEvent(target.url, updated.url, current.data, updated.etag)
      resources.add(moved.url)
      expect(moved.url.split('/').at(-1)).toBe(updated.url.split('/').at(-1))
      expect(await backend.fetchResourceByHref(updated.url)).toBeNull()
      const sourceChanges = await backend.syncCollection(source.url, edited.newSyncToken)
      expect(sourceChanges.changes).toContainEqual({
        href: updated.url,
        etag: null,
        status: 'removed',
      })
      const targetChanges = await backend.syncCollection(target.url, edited.newSyncToken)
      expect(targetChanges.changes).toContainEqual({
        href: moved.url,
        etag: moved.etag,
        status: 'changed',
      })
      expect((await backend.fetchEvents(target.url, '', '', true)).objects).toHaveLength(1)
      await backend.deleteEvent(moved.url, moved.etag)
      resources.delete(moved.url)
      expect(await backend.fetchResourceByHref(moved.url)).toBeNull()
      const removed = await backend.syncCollection(target.url, targetChanges.newSyncToken)
      expect(removed.changes).toContainEqual({ href: moved.url, etag: null, status: 'removed' })
      for (const url of [...calendars].reverse()) await backend.deleteCalendar(url)
      calendars.length = 0
    } finally {
      // Attempt every cleanup even after an earlier cleanup fails.
      const results = await Promise.allSettled(
        [...resources].map((url) => backend.deleteEvent(url, ''))
      )
      // Also find calendars whose create succeeded but its read-back failed.
      const discovered = (await backend.fetchCalendars().catch(() => []))
        .filter((calendar) => calendar.name.includes(suffix))
        .map((calendar) => calendar.url)
      const calendarResults = await Promise.allSettled(
        [...new Set([...calendars, ...discovered])].map((url) => backend.deleteCalendar(url))
      )
      const failed = [...results, ...calendarResults].filter(
        (result) => result.status === 'rejected'
      )
      cleanupFailures = failed.length
    }
    expect(cleanupFailures, 'All temporary resources should be removed').toBe(0)
  }, 90000)
})
