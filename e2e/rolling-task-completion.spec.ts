import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount, STORAGE_KEYS } from './fixtures/localstorage'

// R2.8 — Rolling recurring-task completion (issue #244).
//
// With the opt-in mode on, ticking one occurrence must write TWO single-VTODO
// resources: the master re-anchored onto its next occurrence, and the finished
// occurrence as its own completed task under a new UID. That is the shape
// DAVx⁵/OpenTasks, Tasks.org's CalDAV and Apple Reminders can round-trip; a
// RECURRENCE-ID override is not. Dates are fixed: 2026-03-03 is a Tuesday, so
// FREQ=WEEKLY;BYDAY=TU falls on the 3rd, 10th, 17th, 24th and 31st.

const CALENDAR = {
  id: 'default',
  name: 'Offline calendar',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
  taskCompletionMode: 'rolling',
}

const MASTER = {
  id: 'gym',
  uid: 'gym',
  calendarId: 'default',
  title: 'Exercise',
  type: 'task',
  start: '2026-03-03T00:00:00',
  end: '2026-03-03T23:59:59',
  dueDate: '2026-03-03',
  isAllDay: true,
  rruleString: 'FREQ=WEEKLY;BYDAY=TU',
  recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2] },
  completed: false,
  taskStatus: 'NEEDS-ACTION',
}

interface StoredTask {
  id: string
  uid?: string
  type?: string
  title: string
  start: string
  dueDate?: string
  completed?: boolean
  taskStatus?: string
  rruleString?: string
  recurrenceId?: string
  excludedDates?: string[]
}

async function seed(
  page: Page,
  events: unknown[],
  { rolling = true }: { rolling?: boolean } = {}
): Promise<void> {
  await clearState(page)
  await page.addInitScript(
    ({ calendar, events, rolling, keys }) => {
      // Once per session, so a reload keeps what the app saved since.
      if (sessionStorage.getItem('__rolling_seeded')) return
      sessionStorage.setItem('__rolling_seeded', '1')
      localStorage.setItem(
        keys.calendar,
        JSON.stringify({ state: { calendars: [{ ...calendar, taskCompletionMode: rolling ? "rolling" : "override" }], events }, version: 1 })
      )
      // Merge onto what `clearState` seeded (onboarding, cookie consent, event
      // limit) — replacing the blob would put the first-run modal back in front
      // of every click.
      const raw = localStorage.getItem(keys.settings)
      const saved = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      saved.state = {
        ...(saved.state ?? {}),
        language: 'en',
        
      }
      localStorage.setItem(keys.settings, JSON.stringify(saved))
    },
    { calendar: CALENDAR, events, rolling, keys: STORAGE_KEYS }
  )
}

async function storedTasks(page: Page): Promise<StoredTask[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const events: StoredTask[] = JSON.parse(raw).state.events
    return events.filter((event) => event.type === 'task')
  }, STORAGE_KEYS.calendar)
}

test('ticks a repeat off by rolling the master and saving a separate completed task', async ({
  page,
}) => {
  await seed(page, [MASTER])
  await page.goto('/tasks')

  const row = page.locator('[data-component="task-row"]').filter({ hasText: 'Exercise' }).first()
  await expect(row).toBeVisible()
  await row.getByLabel('Mark as complete').click()

  // The series is still outstanding, on its next date — no override was written.
  await expect(page.locator('[data-component="task-recurring-badge"]')).toBeVisible()

  const tasks = await storedTasks(page)
  const master = tasks.find((task) => !task.recurrenceId && task.rruleString)!
  const copy = tasks.find((task) => !task.recurrenceId && !task.rruleString)

  expect(master.completed).toBeFalsy()
  expect(master.start).toBe('2026-03-10T00:00:00')
  expect(master.dueDate).toBe('2026-03-10')

  expect(copy).toBeTruthy()
  expect(copy.id).not.toBe('gym')
  expect(copy.uid).toBe(copy.id)
  expect(copy.title).toBe('Exercise')
  expect(copy.dueDate).toBe('2026-03-03')
  expect(copy.completed).toBe(true)
  expect(copy.taskStatus).toBe('COMPLETED')
  // A standalone finished task: no RECURRENCE-ID binding it to the series.
  expect(copy.recurrenceId).toBeUndefined()
  expect(tasks.filter((task) => task.recurrenceId)).toHaveLength(0)
})

test('a double-tap on one occurrence records it once', async ({ page }) => {
  await seed(page, [MASTER])
  await page.goto('/tasks')

  const row = page.locator('[data-component="task-row"]').filter({ hasText: 'Exercise' }).first()
  await expect(row).toBeVisible()

  // Two clicks in the same task, before React can re-render the row: the second
  // one still carries the old occurrence, which the master has already rolled
  // past. It must not write a second copy — that is how rapid clicking used to
  // duplicate a completed repeat.
  await row.locator('[data-component="task-checkbox"]').evaluate((checkbox) => {
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect
    .poll(async () => (await storedTasks(page)).filter((task) => !task.rruleString).length)
    .toBe(1)

  const tasks = await storedTasks(page)
  const master = tasks.find((task) => task.rruleString)!
  expect(master.start).toBe('2026-03-10T00:00:00')
  expect(tasks.filter((task) => !task.rruleString)).toHaveLength(1)
})

test('lists the finished repeat under Done at the date it was due', async ({ page }) => {
  await seed(page, [MASTER])
  await page.goto('/tasks')

  await page
    .locator('[data-component="task-row"]')
    .filter({ hasText: 'Exercise' })
    .first()
    .getByLabel('Mark as complete')
    .click()

  await page
    .locator('[data-component="todo-segmented"]')
    .getByRole('button', { name: 'Done' })
    .click()

  const doneRows = page.locator('[data-component="task-row"]').filter({ hasText: 'Exercise' })
  await expect(doneRows).toHaveCount(1)
  await expect(doneRows.first()).toHaveAttribute('data-component', 'task-row')
})

/**
 * The first three Tuesdays of the month the month view opens on. The grid only
 * ever shows the month containing "today", and the URL's `date` parameter is
 * not honoured by this view, so the seeded series has to be anchored relative
 * to the current month for its cells to be on screen at all.
 */
function tuesdaysThisMonth(): [string, string, string] {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  first.setDate(1 + ((2 - first.getDay() + 7) % 7))
  const day = (offset: number): string => {
    const date = new Date(first)
    date.setDate(first.getDate() + offset * 7)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`
  }
  return [day(0), day(1), day(2)]
}

test('leaves earlier repeats open when a later one is ticked in month view', async ({ page }) => {
  const [first, second, third] = tuesdaysThisMonth()
  await seed(page, [
    {
      ...MASTER,
      start: `${first}T00:00:00`,
      end: `${first}T23:59:59`,
      dueDate: first,
    },
  ])
  await page.goto('/month')

  const cell = page.locator(`main [data-date="${third}"]`)
  await expect(cell).toBeVisible()
  await cell.getByLabel('Toggle completion').first().click()

  const tasks = await storedTasks(page)
  const master = tasks.find((task) => !task.recurrenceId && task.rruleString)!
  const copy = tasks.find((task) => !task.recurrenceId && !task.rruleString)!

  // The anchor did not move; only that one date was excluded.
  expect(master.start).toBe(`${first}T00:00:00`)
  expect(master.dueDate).toBe(first)
  expect(master.excludedDates).toEqual([third])
  expect(copy.dueDate).toBe(third)
  expect(copy.completed).toBe(true)

  // The earlier occurrences are still on the grid.
  await expect(page.locator(`main [data-date="${first}"]`).getByText('Exercise')).toBeVisible()
  await expect(page.locator(`main [data-date="${second}"]`).getByText('Exercise')).toBeVisible()
})

test('completes the task itself when the series has no next occurrence', async ({ page }) => {
  await seed(page, [
    {
      ...MASTER,
      rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=1',
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2], count: 1 },
    },
  ])
  await page.goto('/tasks')

  await page
    .locator('[data-component="task-row"]')
    .filter({ hasText: 'Exercise' })
    .first()
    .getByLabel('Mark as complete')
    .click()

  const tasks = await storedTasks(page)
  // No copy: the master carries the completion, so nothing is duplicated.
  expect(tasks).toHaveLength(1)
  expect(tasks[0].id).toBe('gym')
  expect(tasks[0].completed).toBe(true)
  expect(tasks[0].taskStatus).toBe('COMPLETED')
})

test('keeps the RECURRENCE-ID override shape when the mode is off', async ({ page }) => {
  await seed(page, [MASTER], { rolling: false })
  await page.goto('/tasks')

  await page
    .locator('[data-component="task-row"]')
    .filter({ hasText: 'Exercise' })
    .first()
    .getByLabel('Mark as complete')
    .click()

  const tasks = await storedTasks(page)
  const master = tasks.find((task) => !task.recurrenceId)!
  const override = tasks.find((task) => task.recurrenceId)

  // The default: master untouched (still anchored on 3 March), completion
  // recorded as a detached instance sharing its UID.
  expect(master.start).toBe('2026-03-03T00:00:00')
  expect(master.completed).toBeFalsy()
  expect(override).toBeTruthy()
  expect(override!.uid).toBe('gym')
  expect(override!.recurrenceId).toBe('2026-03-03T00:00:00')
})

/**
 * The wire shape on a real collection: the rolled master and the finished
 * repeat must arrive as two separate calendar object resources, each holding a
 * single VTODO. One resource with two components is exactly what Tasks.org
 * aborts on, so asserting it here is the point of the test — the offline tests
 * above only prove what the app stores.
 */
test.describe('synced rolling completion', () => {
  const COLLECTION = '/dav/calendars/user/rolling/'

  function masterIcs(): string {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Other Client//EN',
      'BEGIN:VTODO',
      'UID:rolling-master',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;VALUE=DATE:20260303',
      'DUE;VALUE=DATE:20260303',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'SUMMARY:Exercise',
      'STATUS:NEEDS-ACTION',
      'END:VTODO',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
  }

  async function dump(page: Page, baseURL: string): Promise<Record<string, string>> {
    const response = await page.request.get(
      `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
    )
    return (await response.json()) as Record<string, string>
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
    await clearState(page)
    await seedAccount(page, {
      id: 'rolling-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [
        {
          id: 'rolling-cal',
          name: 'Rolling',
          path: 'calendars/user/rolling/',
          isDefault: true,
          supportedComponents: ['VEVENT', 'VTODO'],
        },
      ],
    })
    await page.addInitScript(
      ({ settingsKey, calendarKey }) => {
        const raw = localStorage.getItem(settingsKey)
        const saved = raw ? JSON.parse(raw) : { state: {}, version: 0 }
        saved.state = { ...(saved.state ?? {}), language: 'en' }
        localStorage.setItem(settingsKey, JSON.stringify(saved))
        // Rolling mode is per calendar now. The app only creates a store entry
        // for a CalDAV calendar that has none, so seeding one with the same id
        // is how this collection starts out in rolling mode.
        if (sessionStorage.getItem('__rolling_cal_seeded')) return
        sessionStorage.setItem('__rolling_cal_seeded', '1')
        const store = JSON.parse(localStorage.getItem(calendarKey) ?? '{"state":{},"version":1}')
        store.state = {
          ...(store.state ?? {}),
          calendars: [
            {
              id: 'rolling-cal',
              name: 'Rolling',
              color: '#06B6D4',
              isVisible: true,
              isDefault: true,
              accountId: 'rolling-account',
              showTasksInViews: true,
              supportedComponents: ['VEVENT', 'VTODO'],
              taskCompletionMode: 'rolling',
            },
          ],
        }
        localStorage.setItem(calendarKey, JSON.stringify(store))
      },
      { settingsKey: STORAGE_KEYS.settings, calendarKey: STORAGE_KEYS.calendar }
    )
  })

  test('puts the master and the completed copy on the server as two resources', async ({
    page,
    baseURL,
  }) => {
    await page.request.put(`${baseURL}/mock-caldav${COLLECTION}rolling-master.ics`, {
      data: masterIcs(),
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    await expect(page.locator('[data-component="sync-all-calendars"]')).toBeEnabled({
      timeout: 10_000,
    })

    await page.goto('/tasks')
    await page
      .locator('[data-component="task-row"]')
      .filter({ hasText: 'Exercise' })
      .first()
      .getByLabel('Mark as complete')
      .click()

    await expect
      .poll(async () => Object.keys(await dump(page, baseURL!)).length, { timeout: 15_000 })
      .toBe(2)

    const resources = await dump(page, baseURL!)
    const bodies = Object.values(resources)
    for (const body of bodies) {
      expect(body.match(/BEGIN:VTODO/g)).toHaveLength(1)
      expect(body).not.toContain('RECURRENCE-ID')
      expect(body).not.toContain('EXDATE')
    }

    const master = bodies.find((body) => body.includes('UID:rolling-master'))!
    expect(master).toContain('DUE;VALUE=DATE:20260310')
    expect(master).toContain('STATUS:NEEDS-ACTION')
    expect(master).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU')

    const copy = bodies.find((body) => !body.includes('UID:rolling-master'))!
    expect(copy).toContain('STATUS:COMPLETED')
    expect(copy).toContain('PERCENT-COMPLETE:100')
    expect(copy).toContain('SUMMARY:Exercise')
    expect(copy).toContain('DUE;VALUE=DATE:20260303')
    expect(copy).not.toContain('RRULE')
    // A new UID, not the series' — that is what makes it a separate task.
    expect(copy).toMatch(/UID:(?!rolling-master)\S+/)
  })
})


/**
 * The PRODID hint only ever asks. It asks right after a repeat is completed in
 * the default override shape, once per list per session, and the mode changes
 * only on "Use rolling completion".
 */
test.describe('Rolling completion prompt', () => {
  const TASKS_ORG_MASTER = { ...MASTER, clientProdid: '+//IDN tasks.org//android-151202//EN' }

  async function completeFirstExercise(page: Page): Promise<void> {
    const row = page.locator('[data-component="task-row"]').filter({ hasText: 'Exercise' }).first()
    await expect(row).toBeVisible()
    await row.getByLabel('Mark as complete').click()
  }

  async function storedCalendar(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).state.calendars[0], STORAGE_KEYS.calendar)
  }

  test('asks after completing a repeat in a Tasks.org list, and switches on accept', async ({
    page,
  }) => {
    await seed(page, [TASKS_ORG_MASTER], { rolling: false })
    await page.goto('/tasks')

    // Nothing is asked before the user completes anything.
    const prompt = page.locator('[data-sonner-toast]', { hasText: 'edited by Tasks.org' })
    await expect(page.locator('[data-component="task-row"]').first()).toBeVisible()
    await expect(prompt).toHaveCount(0)

    await completeFirstExercise(page)
    await expect(prompt).toHaveCount(1)
    // Still the default shape until the user says otherwise.
    expect((await storedCalendar(page)).taskCompletionMode).toBe('override')

    await prompt.getByRole('button', { name: 'Use rolling completion' }).click()
    await expect.poll(async () => (await storedCalendar(page)).taskCompletionMode).toBe('rolling')
  })

  test('"Not now" is remembered for the list', async ({ page }) => {
    await seed(page, [TASKS_ORG_MASTER], { rolling: false })
    await page.goto('/tasks')

    const prompt = page.locator('[data-sonner-toast]', { hasText: 'edited by Tasks.org' })
    await completeFirstExercise(page)
    await expect(prompt).toHaveCount(1)
    await prompt.getByRole('button', { name: 'Not now' }).click()

    await expect.poll(async () => (await storedCalendar(page)).rollingPromptDismissed).toBe(true)
    expect((await storedCalendar(page)).taskCompletionMode).toBe('override')

    // A new session completing the next repeat is not asked again.
    await page.reload()
    await completeFirstExercise(page)
    await page.waitForTimeout(1000)
    await expect(prompt).toHaveCount(0)
  })
})
