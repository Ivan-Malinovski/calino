import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * `fake-indexeddb` is not a dependency of this repo and this change is not the
 * place to add one, so Dexie itself is mocked with a Map-backed table that
 * implements exactly the surface rawIcsStore uses: put/get/delete plus the
 * `where(index).equals(v)/.below(v).delete()` queries.
 */
interface Row {
  href: string
  calendarId: string
  ics: string
  etag?: string
  updatedAt: number
}

const rows = new Map<string, Row>()

class FakeTable {
  put(row: Row): Promise<void> {
    rows.set(row.href, row)
    return Promise.resolve()
  }
  get(href: string): Promise<Row | undefined> {
    return Promise.resolve(rows.get(href))
  }
  delete(href: string): Promise<void> {
    rows.delete(href)
    return Promise.resolve()
  }
  where(index: keyof Row) {
    const matching = (predicate: (row: Row) => boolean) => ({
      delete: (): Promise<void> => {
        for (const [key, row] of [...rows]) if (predicate(row)) rows.delete(key)
        return Promise.resolve()
      },
    })
    return {
      equals: (value: unknown) => matching((row) => row[index] === value),
      below: (value: number) => matching((row) => (row[index] as number) < value),
    }
  }
}

vi.mock('dexie', () => {
  class FakeDexie {
    // A plain field rather than a parameter property: `erasableSyntaxOnly`
    // rejects TS-only constructor syntax.
    name: string
    constructor(name: string) {
      this.name = name
    }
    version(): { stores: (schema: Record<string, string>) => void } {
      return {
        stores: (schema: Record<string, string>) => {
          for (const table of Object.keys(schema)) {
            ;(this as unknown as Record<string, FakeTable>)[table] = new FakeTable()
          }
        },
      }
    }
  }
  return { default: FakeDexie }
})

const {
  putRawIcs,
  getRawIcs,
  deleteRawIcs,
  deleteRawIcsForCalendar,
  pruneRawIcs,
  RAW_ICS_MAX_AGE_MS,
} = await import('@/lib/rawIcsStore')

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\nEND:VCALENDAR'

describe('rawIcsStore', () => {
  beforeEach(() => {
    rows.clear()
    vi.useRealTimers()
  })

  it('stores and retrieves the raw ICS with its etag', async () => {
    await putRawIcs('/cal/a.ics', 'cal-1', ICS, 'etag-1')
    expect(await getRawIcs('/cal/a.ics')).toEqual({ ics: ICS, etag: 'etag-1' })
  })

  it('returns undefined for a resource it has never seen', async () => {
    expect(await getRawIcs('/cal/missing.ics')).toBeUndefined()
  })

  it('omits the etag when none was given', async () => {
    await putRawIcs('/cal/a.ics', 'cal-1', ICS)
    expect(await getRawIcs('/cal/a.ics')).toEqual({ ics: ICS, etag: undefined })
  })

  it('deletes a resource', async () => {
    await putRawIcs('/cal/a.ics', 'cal-1', ICS)
    await deleteRawIcs('/cal/a.ics')
    expect(await getRawIcs('/cal/a.ics')).toBeUndefined()
  })

  it('overwrites the previous blob and refreshes updatedAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await putRawIcs('/cal/a.ics', 'cal-1', ICS, 'etag-1')
    const first = rows.get('/cal/a.ics')!.updatedAt

    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'))
    await putRawIcs('/cal/a.ics', 'cal-1', 'UPDATED', 'etag-2')

    expect(rows.size).toBe(1)
    expect(await getRawIcs('/cal/a.ics')).toEqual({ ics: 'UPDATED', etag: 'etag-2' })
    expect(rows.get('/cal/a.ics')!.updatedAt).toBeGreaterThan(first)
  })

  it('deletes only the given calendar’s blobs', async () => {
    await putRawIcs('/cal1/a.ics', 'cal-1', ICS)
    await putRawIcs('/cal1/b.ics', 'cal-1', ICS)
    await putRawIcs('/cal2/c.ics', 'cal-2', ICS)

    await deleteRawIcsForCalendar('cal-1')

    expect(await getRawIcs('/cal1/a.ics')).toBeUndefined()
    expect(await getRawIcs('/cal1/b.ics')).toBeUndefined()
    expect(await getRawIcs('/cal2/c.ics')).toBeDefined()
  })

  it('prunes blobs older than the cutoff and keeps newer ones', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await putRawIcs('/cal/old.ics', 'cal-1', ICS)

    vi.setSystemTime(new Date('2026-01-10T00:00:00Z'))
    await putRawIcs('/cal/new.ics', 'cal-1', ICS)

    // Cutoff sits between the two writes.
    await pruneRawIcs(5 * 24 * 60 * 60 * 1000)

    expect(await getRawIcs('/cal/old.ics')).toBeUndefined()
    expect(await getRawIcs('/cal/new.ics')).toBeDefined()
  })

  it('defaults to a 90 day age cutoff', async () => {
    expect(RAW_ICS_MAX_AGE_MS).toBe(90 * 24 * 60 * 60 * 1000)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await putRawIcs('/cal/a.ics', 'cal-1', ICS)

    vi.setSystemTime(new Date('2026-03-15T00:00:00Z')) // 73 days later
    await pruneRawIcs()
    expect(await getRawIcs('/cal/a.ics')).toBeDefined()

    vi.setSystemTime(new Date('2026-05-01T00:00:00Z')) // 120 days later
    await pruneRawIcs()
    expect(await getRawIcs('/cal/a.ics')).toBeUndefined()
  })
})
