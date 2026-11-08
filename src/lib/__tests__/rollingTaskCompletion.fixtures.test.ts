import { describe, it, expect } from 'vitest'
import { planRollingTaskCompletion } from '@/lib/rollingTaskCompletion'
import {
  materializeOccurrence,
  occurrenceInstant,
  occurrencesAfter,
  shapeOccurrence,
} from '@/lib/occurrenceExpansion'
import { parseICALData, taskToICAL } from '@/features/caldav/adapter/iCalendarAdapter'
import type { CalendarEvent, RollingTaskCompletionPlan } from '@/types'

/**
 * R2.8 — Rolling completion tested against .ics files instead of hand-built
 * CalendarEvents (PR #251 review). The `synthetic/` series cover the edge
 * cases (COUNT, EXDATE, legacy overrides) at the wire level. The `clients/`
 * captures check that Calino writes the same shape as DAVx⁵/OpenTasks,
 * Tasks.org and Apple Reminders, and can read back what they write. See
 * rolling-fixtures/README.md.
 */

const synthetic = import.meta.glob<string>('./rolling-fixtures/synthetic/*.ics', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const clientFiles = import.meta.glob<string>('./rolling-fixtures/clients/*/*/{before,after}/*.ics', {
  query: '?raw',
  import: 'default',
  eager: true,
})
interface ClientMeta {
  completedDue: string
  writesCopy: boolean
  /**
   * Fields where Calino deliberately differs from the client, with the reason.
   * Each one is still printed, so the difference stays visible.
   */
  divergent?: Partial<Record<'due' | 'count' | 'exdate', string>>
}
const clientMeta = import.meta.glob<ClientMeta>(
  './rolling-fixtures/clients/*/*/meta.json',
  { import: 'default', eager: true }
)

const now = new Date('2026-03-03T18:00:00Z')
const newUid = 'copy-uid'

/** Split one collection (one or more resources) into its master and overrides. */
function load(resources: string[]): { master: CalendarEvent; overrides: Map<string, CalendarEvent>; all: CalendarEvent[] } {
  const all = resources.flatMap((ics) => parseICALData(ics, 'cal-1'))
  const masters = all.filter((event) => event.type === 'task' && !event.recurrenceId && event.rruleString)
  if (masters.length !== 1) throw new Error(`expected one recurring master, found ${masters.length}`)
  const master = masters[0]!
  const uid = master.uid || master.id
  const overrides = new Map<string, CalendarEvent>()
  // Same indexing as the store's completeTaskOccurrenceRolling.
  for (const event of all) {
    if (event.recurrenceId && (event.uid === uid || event.recurrenceMasterId === master.id)) {
      overrides.set(event.recurrenceId, event)
    }
  }
  return { master, overrides, all }
}

/** The `start` string of the occurrence due on `date` (yyyy-mm-dd). */
function occurrenceOn(master: CalendarEvent, date: string): string {
  const anchor = occurrenceInstant(master, master.start)
  const start = new Date(master.start)
  const end = new Date(master.end)
  let scanned = 0
  for (const occ of occurrencesAfter(master, new Date(anchor.getTime() - 1))) {
    if (scanned++ > 500) break
    const shape = shapeOccurrence(occ, start, end, master.isAllDay, master.timezone)
    if (shape.occDateStr === date) return materializeOccurrence(master, shape).start
  }
  throw new Error(`no occurrence of ${master.uid} on ${date}`)
}

function plan(master: CalendarEvent, occurrenceStart: string, overrides = new Map<string, CalendarEvent>()): RollingTaskCompletionPlan | null {
  return planRollingTaskCompletion(master, occurrenceStart, overrides, { now, newUid })
}

const count = (ics: string, needle: RegExp): number => (ics.match(needle) ?? []).length
const due = (event: CalendarEvent): string | undefined => event.dueDate?.slice(0, 10)
const countOf = (event: CalendarEvent): number | undefined => {
  const match = /(?:^|;)COUNT=(\d+)/i.exec(event.rruleString ?? '')
  return match ? Number(match[1]) : undefined
}

describe('R2.8 rolling completion: synthetic .ics edge cases', () => {
  const fixture = (name: string) => {
    const ics = synthetic[`./rolling-fixtures/synthetic/${name}.ics`]
    if (!ics) throw new Error(`missing fixture ${name}`)
    return load([ics])
  }

  it('daily COUNT=3: rolls one day forward and leaves COUNT=2', () => {
    const { master } = fixture('daily-count')
    const result = plan(master, occurrenceOn(master, '2026-03-03'))
    if (result?.kind !== 'roll') throw new Error(`expected roll, got ${result?.kind}`)

    const masterIcs = taskToICAL(result.master)
    expect(count(masterIcs, /BEGIN:VTODO/g)).toBe(1)
    expect(masterIcs).toContain('COUNT=2')
    expect(masterIcs).toContain('DUE;VALUE=DATE:20260304')
    expect(masterIcs).toContain('STATUS:NEEDS-ACTION')

    const copyIcs = taskToICAL(result.completedCopy)
    expect(count(copyIcs, /BEGIN:VTODO/g)).toBe(1)
    expect(copyIcs).toContain('DUE;VALUE=DATE:20260303')
    expect(copyIcs).toContain('STATUS:COMPLETED')
    expect(copyIcs).not.toMatch(/RRULE|EXDATE|RECURRENCE-ID/)
  })

  it('daily COUNT=3: the third completion ends the series on the master', () => {
    const { master } = fixture('daily-count')
    const first = plan(master, occurrenceOn(master, '2026-03-03'))
    if (first?.kind !== 'roll') throw new Error('expected roll')
    const second = plan(first.master, occurrenceOn(first.master, '2026-03-04'))
    if (second?.kind !== 'roll') throw new Error('expected roll')
    expect(countOf(second.master)).toBe(1)
    const third = plan(second.master, occurrenceOn(second.master, '2026-03-05'))
    expect(third?.kind).toBe('final')
    if (third?.kind !== 'final') return
    expect(taskToICAL(third.master)).toContain('STATUS:COMPLETED')
  })

  it('weekly with EXDATE: skips the excluded week and keeps the EXDATE', () => {
    const { master } = fixture('weekly-exdate')
    const result = plan(master, occurrenceOn(master, '2026-03-03'))
    if (result?.kind !== 'roll') throw new Error(`expected roll, got ${result?.kind}`)
    expect(due(result.master)).toBe('2026-03-17')
    const masterIcs = taskToICAL(result.master)
    expect(masterIcs).toMatch(/EXDATE[^:\r\n]*:20260310/)
    expect(masterIcs).not.toContain('COUNT=')
  })

  it('weekly with EXDATE: an out-of-order completion adds an EXDATE and keeps the anchor', () => {
    const { master } = fixture('weekly-exdate')
    const result = plan(master, occurrenceOn(master, '2026-03-24'))
    if (result?.kind !== 'roll') throw new Error(`expected roll, got ${result?.kind}`)
    expect(due(result.master)).toBe('2026-03-03')
    const masterIcs = taskToICAL(result.master)
    expect(masterIcs).toMatch(/EXDATE[^\r\n]*20260310/)
    expect(masterIcs).toMatch(/EXDATE[^\r\n]*20260324/)
    expect(due(result.completedCopy)).toBe('2026-03-24')
  })

  it('COUNT with EXDATE: the excluded slot is consumed, so the series keeps its end date', () => {
    // COUNT=4 from 3 Mar with 10 Mar excluded leaves 3, 17 and 24 Mar. After
    // completing 3 Mar and rolling to 17 Mar, two slots are left: COUNT=2.
    const { master } = fixture('weekly-count-exdate')
    const result = plan(master, occurrenceOn(master, '2026-03-03'))
    if (result?.kind !== 'roll') throw new Error(`expected roll, got ${result?.kind}`)
    expect(due(result.master)).toBe('2026-03-17')
    expect(countOf(result.master)).toBe(2)
  })

  describe('a series that already has overrides when rolling mode is switched on', () => {
    it('folds the override for the completed occurrence into the copy', () => {
      const { master, overrides } = fixture('legacy-overrides')
      const result = plan(master, occurrenceOn(master, '2026-03-03'), overrides)
      if (result?.kind !== 'roll') throw new Error(`expected roll, got ${result?.kind}`)
      // The edit made to that occurrence before the switch survives on the copy.
      expect(result.completedCopy.title).toBe('Exercise (edited)')
      const target = [...overrides.values()].find((event) => due(event) === '2026-03-03')
      expect(result.removedOverrideIds).toContain(target?.id)
      // The folded override isn't converted a second time.
      expect(result.convertedOverrides.map(due)).not.toContain('2026-03-03')
    })

    it('treats an already-completed override as consumed when rolling past it', () => {
      // 10 Mar was completed in override mode. Completing 3 Mar rolls past it
      // to 17 Mar, consuming two of the four slots.
      const { master, overrides } = fixture('legacy-overrides')
      const result = plan(master, occurrenceOn(master, '2026-03-03'), overrides)
      if (result?.kind !== 'roll') throw new Error(`expected roll, got ${result?.kind}`)
      expect(due(result.master)).toBe('2026-03-17')
      expect(countOf(result.master)).toBe(2)
    })

    it('clears every leftover override, so the master resource is a single VTODO', () => {
      // Option (b) from the PR #251 review: the 10 March override, completed in
      // override mode, becomes its own finished task. The master's resource
      // ends up with no RECURRENCE-ID, which is what Tasks.org needs.
      const { master, overrides } = fixture('legacy-overrides')
      const result = plan(master, occurrenceOn(master, '2026-03-03'), overrides)
      if (result?.kind !== 'roll') throw new Error(`expected roll, got ${result?.kind}`)

      const allOverrideIds = new Set([...overrides.values()].map((event) => event.id))
      expect(new Set(result.removedOverrideIds)).toEqual(allOverrideIds)
      expect(result.convertedOverrides.map(due)).toEqual(['2026-03-10'])
      expect(result.convertedOverrides[0]!.completed).toBe(true)

      const masterIcs = taskToICAL(result.master)
      expect(count(masterIcs, /BEGIN:VTODO/g)).toBe(1)
      expect(masterIcs).not.toContain('RECURRENCE-ID')
      for (const converted of result.convertedOverrides) {
        const ics = taskToICAL(converted)
        expect(count(ics, /BEGIN:VTODO/g)).toBe(1)
        expect(ics).not.toMatch(/RRULE|EXDATE|RECURRENCE-ID/)
        expect(ics).toContain('STATUS:COMPLETED')
      }
    })
  })
})

/**
 * Captured client fixtures. Each `<client>/<series>` directory is checked two
 * ways: Calino reads what the client wrote, and Calino's own rolling write
 * matches the client's on the fields that matter (DUE, COUNT, EXDATE, copy).
 */
const series = new Map<string, { before: string[]; after: string[] }>()
for (const [path, ics] of Object.entries(clientFiles)) {
  const match = /clients\/([^/]+\/[^/]+)\/(before|after)\//.exec(path)
  if (!match) continue
  const entry = series.get(match[1]!) ?? { before: [], after: [] }
  entry[match[2] as 'before' | 'after'].push(ics)
  series.set(match[1]!, entry)
}

describe('R2.8 rolling completion: captured client fixtures', () => {
  if (series.size === 0) {
    it.todo('no client captures yet; see rolling-fixtures/README.md')
    return
  }

  for (const [name, { before, after }] of series) {
    const meta = clientMeta[`./rolling-fixtures/clients/${name}/meta.json`]

    describe(name, () => {
      it('has a meta.json and both states', () => {
        expect(meta, 'meta.json').toBeDefined()
        expect(before.length).toBeGreaterThan(0)
        expect(after.length).toBeGreaterThan(0)
      })
      if (!meta) return

      it("Calino reads the client's result", () => {
        const events = after.flatMap((ics) => parseICALData(ics, 'cal-1'))
        expect(events.length).toBeGreaterThan(0)
        if (meta.writesCopy) {
          const copies = events.filter((event) => !event.rruleString && event.completed)
          expect(copies.map(due)).toContain(meta.completedDue)
        }
      })

      it('Calino writes the same shape as the client', () => {
        const { master, overrides } = load(before)
        const result = plan(master, occurrenceOn(master, meta.completedDue), overrides)
        expect(result?.kind === 'roll' || result?.kind === 'final').toBe(true)
        if (result?.kind !== 'roll' && result?.kind !== 'final') return

        const theirs = after.flatMap((ics) => parseICALData(ics, 'cal-1'))
        // Clients that write a copy can mint a new UID either for the copy
        // (OpenTasks) or for the rolled master (Apple Reminders). So match
        // their master on having an RRULE, not on the UID.
        const theirMaster = theirs.find((event) => event.rruleString && !event.recurrenceId)

        if (result.kind === 'final') {
          // Some clients drop the RRULE on the last occurrence; either way the
          // series is finished.
          if (theirMaster) expect(theirMaster.completed).toBe(true)
          return
        }
        expect(theirMaster, 'client master after completion').toBeDefined()
        if (!theirMaster) return
        const exdates = (event: CalendarEvent) =>
          [...(event.excludedDates ?? [])].map((d) => d.slice(0, 10)).sort()
        const check = (field: 'due' | 'count' | 'exdate', ours: unknown, theirs: unknown) => {
          const reason = meta.divergent?.[field]
          if (reason) {
            console.info(`[${name}] ${field}: Calino=${JSON.stringify(ours)} client=${JSON.stringify(theirs)} (${reason})`)
            expect(ours, `documented divergence on ${field} no longer diverges`).not.toEqual(theirs)
            return
          }
          expect(ours, field).toEqual(theirs)
        }
        check('due', due(result.master), due(theirMaster))
        check('count', countOf(result.master), countOf(theirMaster))
        check('exdate', exdates(result.master), exdates(theirMaster))
        for (const ics of after) expect(ics).not.toContain('RECURRENCE-ID')
      })
    })
  }
})
