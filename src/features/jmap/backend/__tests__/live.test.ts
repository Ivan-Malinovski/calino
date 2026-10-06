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

  it('reports a created event as a busy period through Principal/getAvailability', async () => {
    const backend = await createJmapCalendarBackend(
      serverUrl!,
      { id: 'live', serverUrl: serverUrl!, username: username!, password: password! },
      null
    )
    const suffix = crypto.randomUUID()
    const calendar = await backend.createCalendar({
      name: `Calino free/busy test ${suffix}`,
      color: '#123456',
    })
    try {
      expect(await backend.supportsScheduling()).toBe(true)
      const start = new Date(Date.now() + 2 * 86_400_000)
      start.setUTCHours(10, 0, 0, 0)
      const end = new Date(start.getTime() + 3_600_000)
      const stamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d+/g, '')
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Calino//live test//EN',
        'BEGIN:VEVENT',
        `UID:freebusy-${suffix}@calino.test`,
        `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(end)}`,
        'SUMMARY:Busy block',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
      await backend.createEvent(calendar.url, ics, 'ignored.ics')
      const window = [new Date(start.getTime() - 3_600_000), new Date(end.getTime() + 3_600_000)]
      const periods = await backend.queryFreeBusy(calendar.url, window[0], window[1])
      expect(periods).not.toBeNull()
      expect(periods!.some((p) => p.start <= start && p.end >= end && p.type === 'BUSY')).toBe(true)
      const byEmail = await backend.queryAttendeeFreeBusy(
        '',
        username!,
        [username!],
        window[0],
        window[1]
      )
      expect(byEmail?.get(username!.toLowerCase())?.length ?? 0).toBeGreaterThan(0)
    } finally {
      await backend.deleteCalendar(calendar.url)
    }
  }, 60000)
})
