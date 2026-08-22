import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount, seedJournal, STORAGE_KEYS } from './fixtures/localstorage'

/**
 * Journal view regressions:
 *  - #85 entries show the year, so 'All' mode is readable across years
 *  - #88 hiding a calendar hides its entries, like events and tasks
 *  - #89 a new entry can be filed into a chosen calendar, and an existing
 *    entry can be moved between calendars
 */
// The journal opens in 'month' mode, scoped to the current month, so the
// seeded entries have to live in it or the list starts empty.
const today = new Date()
const day = (n: number): string =>
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`
const expectedMonthYear = today
  .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  .toUpperCase()

// Collections owned by the journal-move test alone: event-move owns
// move-source/ and work/, and the other specs share personal/.
const J_WORK = '/dav/calendars/user/j-work/'
const J_PERSONAL = '/dav/calendars/user/j-personal/'

/**
 * File the open compose form into a calendar. The picker is a row of chips
 * rather than a <select>, so this clicks the one carrying the calendar id and
 * waits for it to report itself checked.
 */
async function pickJournalCalendar(page: Page, calendarId: string): Promise<void> {
  const chip = page.locator(
    `[data-component="journal-calendar-chip"][data-calendar-id="${calendarId}"]`
  )
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(chip).toHaveAttribute('aria-checked', 'true')
}

/**
 * Snapshot the mock's stored resources under a collection prefix. Returns
 * null on a transient connection reset (the shared dev server can drop a
 * request under parallel load) so expect.poll retries instead of dying.
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

/** The sidebar's calendar list starts collapsed, so reveal it before toggling. */
async function hideCalendar(page: Page, calendarId: string): Promise<void> {
  const section = page.locator('[data-component="calendar-section-toggle"]')
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page
    .locator(`[data-component="calendar-visibility-toggle"][data-calendar-id="${calendarId}"]`)
    .uncheck()
}

/** Click the header sync button and wait for the round-trip to settle. */
async function syncAll(page: Page): Promise<void> {
  await page.locator('[data-component="sync-all-calendars"]').click()
  await expect(
    page.getByText(/All calendars synced\.|Calendars are already syncing\.|Sync failed/).first()
  ).toBeVisible({ timeout: 15_000 })
}

/** VJOURNAL seeded directly onto the mock server, dated in the current month. */
const MOVE_VJOURNAL = (title: string, description: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n` +
  `BEGIN:VJOURNAL\r\nUID:j-move-uid\r\nDTSTART;VALUE=DATE:${day(15).replaceAll('-', '')}\r\n` +
  `SUMMARY:${title}\r\nDESCRIPTION:${description}\r\n` +
  `END:VJOURNAL\r\nEND:VCALENDAR\r\n`

/** Account + resets for the move tests. The j-* collections are baked into
 * the mock fixture (see vite-caldav-mock.ts) and owned by this spec. */
async function seedMoveAccount(page: Page, baseURL: string): Promise<void> {
  await seedAccount(page, {
    id: 'journal-move-account',
    name: 'Journal Mock',
    serverUrl: `${baseURL}/mock-caldav/dav/`,
    username: 'user',
    password: 'pass',
    calendars: [
      { id: 'j-work', name: 'Journal Work', path: 'calendars/user/j-work/', isDefault: true },
      { id: 'j-personal', name: 'Journal Personal', path: 'calendars/user/j-personal/' },
    ],
  })
  for (const prefix of [J_WORK, J_PERSONAL]) {
    await page.request.post(
      `${baseURL}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(prefix)}`
    )
  }
}

/**
 * Store calendars (so the picker sees them, including the Offline calendar —
 * part of real store state) + journalEnabled (the view is hidden until it
 * flips on). Optional local-only entry for the promote test. seedJournal
 * can't be reused: it overwrites the calendars, dropping the account link.
 */
async function seedJournalMoveStore(
  page: Page,
  localEntry?: { id: string; title: string; body: string; date: string }
): Promise<void> {
  await page.addInitScript(
    ({
      calendarKey,
      settingsKey,
      localEntry,
    }: {
      calendarKey: string
      settingsKey: string
      localEntry?: { id: string; title: string; body: string; date: string }
    }) => {
      try {
        if (sessionStorage.getItem('__calino_test_journal_move')) return
        sessionStorage.setItem('__calino_test_journal_move', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
        const now = new Date().toISOString()
        parsed.state = {
          ...(parsed.state ?? {}),
          calendars: [
            {
              id: 'j-work',
              name: 'Journal Work',
              color: '#4285F4',
              isVisible: true,
              isDefault: true,
              showTasksInViews: true,
              supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
            },
            {
              id: 'j-personal',
              name: 'Journal Personal',
              color: '#E8710A',
              isVisible: true,
              showTasksInViews: true,
              supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
            },
            {
              id: 'default',
              name: 'Offline calendar',
              color: '#9CA3AF',
              isVisible: true,
              showTasksInViews: true,
            },
          ],
          events: localEntry
            ? [
                {
                  id: localEntry.id,
                  calendarId: 'default',
                  title: localEntry.title,
                  description: localEntry.body,
                  start: localEntry.date,
                  end: localEntry.date,
                  isAllDay: true,
                  type: 'journal',
                  created: now,
                  lastModified: now,
                },
              ]
            : [],
        }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
        const settingsRaw = localStorage.getItem(settingsKey)
        const settings = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
        settings.state = { ...(settings.state ?? {}), journalEnabled: true }
        localStorage.setItem(settingsKey, JSON.stringify(settings))
      } catch {
        /* noop */
      }
    },
    { calendarKey: STORAGE_KEYS.calendar, settingsKey: STORAGE_KEYS.settings, localEntry }
  )
}

test.describe('Journal view', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedJournal(page, {
      calendars: [
        { id: 'work', name: 'Work' },
        { id: 'personal', name: 'Personal' },
      ],
      entries: [
        {
          id: 'work-entry',
          title: 'Shipped the thing',
          body: 'Deploy went out clean.',
          date: day(15),
          calendarId: 'work',
        },
        {
          id: 'personal-entry',
          title: 'Long walk',
          body: 'Down by the river.',
          date: day(16),
          calendarId: 'personal',
        },
      ],
    })
  })

  test('entry dates include the month and year', async ({ page }) => {
    await page.goto('/journal')
    await page.locator('[data-component="journal-mode-all"]').click()

    const entry = page.locator(`article[data-date="${day(15)}"]`)
    await expect(entry).toContainText('15')
    await expect(entry).toContainText(expectedMonthYear)
  })

  test('hiding a calendar hides its journal entries', async ({ page }) => {
    await page.goto('/journal')

    await expect(page.getByText('Shipped the thing')).toBeVisible()
    await expect(
      page.locator('[data-component="journal-entry-row"]').filter({ hasText: 'Long walk' })
    ).toBeVisible()

    await hideCalendar(page, 'personal')

    await expect(page.getByText('Long walk')).toBeHidden()
    await expect(page.getByText('Shipped the thing')).toBeVisible()
  })

  test('an empty month shows the list without an editor placeholder', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    await expect(page.getByText('Nothing written yet')).toBeVisible()
    await expect(page.locator('[data-component="journal-editor"]')).toHaveCount(0)
    await expect(page.locator('[data-component="journal-editor-empty"]')).toHaveCount(0)

    await expect(page.locator('[data-component="journal-editor"]')).toHaveCount(0)
  })

  test('a new entry can be filed into a chosen calendar', async ({ page }) => {
    await page.goto('/journal')
    await page.locator('[data-component="journal-new-entry"]').click()

    await expect(page.locator('[data-component="journal-calendar-chip"]')).toHaveText([
      'Work',
      'Personal',
    ])
    await pickJournalCalendar(page, 'personal')

    const titleField = page.getByPlaceholder('Title (optional)')
    const bodyField = page.getByPlaceholder('Write something…')
    await titleField.fill('Filed elsewhere')
    // Under parallel load the app can transiently misroute an input event to
    // the previous field (a React 19 controlled-input race seen in traces:
    // the body fill's text lands in the title, leaving the body empty and the
    // save aborted). Wait for the title to land, then re-fill the body until
    // it sticks.
    await expect(titleField).toHaveValue('Filed elsewhere')
    await expect
      .poll(async () => {
        const value = await bodyField.inputValue().catch(() => '')
        if (value === 'Should land in Personal.') return true
        await bodyField.fill('Should land in Personal.')
        return false
      })
      .toBe(true)

    await expect(page.locator('[data-component="journal-save-status"]')).toContainText(
      /Saved|saved locally/,
      { timeout: 15_000 }
    )

    await expect(page.getByText('Filed elsewhere')).toBeVisible()

    // Hiding the chosen calendar must take the new entry with it — proof it
    // was stored against 'personal' rather than the default calendar.
    await hideCalendar(page, 'personal')
    await expect(page.getByText('Filed elsewhere')).toBeHidden()
  })

  test('uses a split editor and selects entries with one click', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.goto('/journal')

    await expect(page.locator('[data-component="journal-entry-list"]')).toBeVisible()
    await expect(page.locator('[data-component="journal-editor"]')).toBeHidden()
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
      .click()
    await expect(page.locator('[data-component="journal-editor"]')).toBeVisible()
    await expect(page.locator('[data-component="journal-editor"] h1')).toHaveText('Long walk')
    await expect(page.locator('[data-component="journal-read-view"]')).toBeVisible()
    const editorHeader = await page
      .locator('[data-component="journal-editor-header"]')
      .boundingBox()
    const readSurface = await page.locator('[data-component="journal-read-view"]').boundingBox()
    expect(editorHeader).not.toBeNull()
    expect(readSurface).not.toBeNull()
    expect(readSurface!.y - (editorHeader!.y + editorHeader!.height)).toBeLessThan(36)
  })

  test('toggles the editor by clicking the selected entry', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.goto('/journal')

    const activeRow = page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
    await expect(activeRow).not.toHaveAttribute('aria-current', 'true')
    await activeRow.click()
    await expect(activeRow).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[data-component="journal-editor"]')).toBeVisible()
    await activeRow.click()
    await expect(page.locator('[data-component="journal-editor"]')).toBeHidden()
  })

  test('journal entries can toggle the editor with the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.goto('/journal')

    const row = page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-component="journal-editor"]')).toBeVisible()
    await page.keyboard.press('Space')
    await expect(page.locator('[data-component="journal-editor"]')).toBeHidden()
  })

  test('editor shell follows the available viewport height', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 800 })
    await page.goto('/journal')
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
      .click()
    const editor = page.locator('[data-component="journal-editor"]')
    const footer = page.locator('[data-component="journal-editor-footer"]')
    const smallEditor = await editor.boundingBox()
    const smallFooter = await footer.boundingBox()
    expect(smallEditor).not.toBeNull()
    expect(smallFooter).not.toBeNull()

    await page.setViewportSize({ width: 1800, height: 1100 })
    await expect(editor).toBeVisible()
    const largeEditor = await editor.boundingBox()
    const largeFooter = await footer.boundingBox()
    expect(largeEditor).not.toBeNull()
    expect(largeFooter).not.toBeNull()
    expect(largeEditor!.height - smallEditor!.height).toBeGreaterThan(200)
    expect(
      largeFooter!.y + largeFooter!.height - (smallFooter!.y + smallFooter!.height)
    ).toBeGreaterThan(200)
  })

  test('autosaves drafts, tags, and Markdown read mode', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.goto('/journal')
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Shipped the thing' })
      .click()
    await page.getByRole('button', { name: 'Write' }).click()

    const body = page.locator('[data-component="journal-body-input"]')
    await body.fill('# A heading\n\n**Bold text** and [a link](https://example.com)')
    await expect(page.locator('[data-component="journal-save-status"]')).toContainText(
      'Unsaved changes'
    )
    await expect(page.locator('[data-component="journal-save-status"]')).toContainText('Saved', {
      timeout: 5_000,
    })
    await page.reload()
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Shipped the thing' })
      .click()
    await page.getByRole('button', { name: 'Write' }).click()
    await expect(page.locator('[data-component="journal-body-input"]')).toHaveValue(/A heading/)

    const writeSurface = await page.locator('[data-component="journal-body-input"]').boundingBox()

    await page.getByLabel('Add tag').fill(' Personal ')
    await page.getByLabel('Add tag').press('Enter')
    await expect(page.locator('[data-component="journal-tags"]')).toContainText('personal')
    await page.getByRole('button', { name: 'Remove tag personal' }).click()
    await expect(page.locator('[data-component="journal-tags"]')).not.toContainText('personal')

    await page.getByRole('button', { name: 'Read' }).click()
    const readView = page.locator('[data-component="journal-read-view"]')
    await expect(readView.getByRole('heading', { name: 'A heading' })).toBeVisible()
    const readSurface = await readView.boundingBox()
    expect(writeSurface).not.toBeNull()
    expect(readSurface).not.toBeNull()
    expect(readSurface!.x).toBeCloseTo(writeSurface!.x, 0)
    expect(readSurface!.width).toBeCloseTo(writeSurface!.width, 0)
    await expect(readView.getByRole('link', { name: 'a link' })).toHaveAttribute('target', '_blank')
    await readView.dblclick({ position: { x: 20, y: 20 } })
    await expect(page.locator('[data-component="journal-body-input"]')).toBeVisible()

    await page.getByRole('button', { name: 'Read' }).click()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('heading', { name: 'Long walk', exact: true })).toBeVisible()
  })

  test('date editing can be dismissed without changing the entry', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.goto('/journal')
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
      .click()
    await page.getByTitle('Click to change date').click()
    await expect(page.locator('input[type="date"]')).toBeVisible()
    await page.locator('input[type="date"]').press('Escape')
    await expect(page.locator('input[type="date"]')).toBeHidden()
    await expect(page.getByTitle('Click to change date')).toBeVisible()
  })

  test('wraps Markdown shortcuts without losing the selected text', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.goto('/journal')
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
      .click()
    await page.getByRole('button', { name: 'Write' }).click()
    const body = page.locator('[data-component="journal-body-input"]')
    await body.fill('format this')
    await body.selectText()
    await body.press('Control+b')
    await expect(body).toHaveValue('**format this**')
    await body.press('Control+i')
    await expect(body).toHaveValue('***format this***')
  })

  test('opens the editor as a narrow overlay and dismisses it with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto('/journal')
    await expect(page.locator('[data-component="journal-editor"]')).toBeHidden()
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
      .click()
    const editor = page.locator('[data-component="journal-editor"]')
    const backButton = page.getByRole('button', { name: '← All entries' })
    const deleteButton = editor.getByRole('button', { name: 'Delete entry' })
    await expect(backButton).toBeVisible()
    await expect(editor.locator('[data-component="journal-read-view"]')).toBeVisible()
    const backBox = await backButton.boundingBox()
    const deleteBox = await deleteButton.boundingBox()
    expect(backBox).not.toBeNull()
    expect(deleteBox).not.toBeNull()
    expect(Math.abs(backBox!.y - deleteBox!.y)).toBeLessThan(8)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-component="journal-editor"]')).toBeHidden()
  })

  test('fills the smallest mobile viewport when the editor is open', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await page.goto('/journal')
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Long walk' })
      .click()

    const editor = await page.locator('[data-component="journal-editor"]').boundingBox()
    expect(editor).not.toBeNull()
    expect(editor!.y + editor!.height).toBeGreaterThan(692)
    await expect(page.locator('[data-component="journal-editor-footer"]')).toBeVisible()
    await expect(page.locator('[data-component="floating-nav-pill"]')).toBeHidden()
  })

  test('keeps the mobile journal list close to its toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto('/journal')
    const toolbar = await page.locator('[data-component="journal-toolbar"]').boundingBox()
    const listHeader = await page.locator('[data-component="journal-list-header"]').boundingBox()
    expect(toolbar).not.toBeNull()
    expect(listHeader).not.toBeNull()
    expect(listHeader!.y - (toolbar!.y + toolbar!.height)).toBeLessThan(24)
  })

  test('only shows list fades at the edges that can scroll', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 320 })
    await page.goto('/journal')

    const list = page.locator('[data-component="journal-list-scroll"]')
    await expect(list).toHaveAttribute('data-fade-top', 'false')
    await expect(list).toHaveAttribute('data-fade-bottom', 'true')
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(list).toHaveAttribute('data-fade-top', 'true')
    await expect(list).toHaveAttribute('data-fade-bottom', 'false')
  })

  test('heals selection when switching from All to a filtered Month scope', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.addInitScript(
      ({ calendarKey }: { calendarKey: string }) => {
        const raw = localStorage.getItem(calendarKey)
        if (!raw) return
        const parsed = JSON.parse(raw)
        parsed.state.events.push({
          id: 'old-journal-entry',
          calendarId: 'work',
          title: 'Older thought',
          description: 'From another month.',
          start: '2020-01-02',
          end: '2020-01-02',
          isAllDay: true,
          type: 'journal',
        })
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      },
      { calendarKey: STORAGE_KEYS.calendar }
    )
    await page.goto('/journal')
    await page.locator('[data-component="journal-mode-all"]').click()
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Older thought' })
      .click()
    await page.locator('[data-component="journal-mode-month"]').click()
    await expect(
      page.locator('[data-component="journal-entry-row"]').filter({ hasText: 'Older thought' })
    ).toBeHidden()
    await expect(page.locator('[data-component="journal-editor"] h1')).toHaveText('Long walk')
  })

  test('deleting the selected entry selects the next one and keeps undo available', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto('/journal')
    await page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Shipped the thing' })
      .click()
    await page
      .locator('[data-component="journal-editor"]')
      .getByRole('button', { name: 'Delete entry' })
      .click()
    const deletedRow = page
      .locator('[data-component="journal-entry-row"]')
      .filter({ hasText: 'Shipped the thing' })
    await expect
      .poll(async () => {
        if ((await deletedRow.count()) === 0) return 0
        return Number(await deletedRow.evaluate((element) => getComputedStyle(element).opacity))
      })
      .toBeLessThan(1)
    await expect(page.getByRole('button', { name: '← All entries' })).toBeHidden()
    await expect(
      page.locator('[data-component="journal-entry-row"]').filter({ hasText: 'Long walk' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Shipped the thing')).toBeVisible()
  })

  // The three move tests share collections on the process-wide mock store
  // (resets + PUTs to j-work/), so they must not run against each other's
  // leftovers — same constraint event-move.spec.ts documents for its own
  // dedicated collections.
  test.describe('moving entries between calendars', () => {
    test.describe.configure({ mode: 'serial' })

    test('editing an entry can move it to another calendar', async ({ page, baseURL }) => {
      await clearState(page)
      await seedMoveAccount(page, baseURL!)
      await page.request.put(`${baseURL}/mock-caldav${J_WORK}j-move-entry.ics`, {
        data: MOVE_VJOURNAL('Relocatable entry', 'Should move to Journal Personal.'),
      })
      await seedJournalMoveStore(page)

      await page.goto('/journal')
      await syncAll(page)
      await expect(page.getByText('Relocatable entry').first()).toBeVisible()
      await expect
        .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
          timeout: 15_000,
        })
        .toBe(1)

      // Edit it: the calendar picker now appears on existing entries too (#89).
      await page.getByText('Relocatable entry').first().dblclick()
      await pickJournalCalendar(page, 'j-personal')
      await expect(page.locator('[data-component="journal-save-status"]')).toContainText(
        /Saved|saved locally/,
        { timeout: 15_000 }
      )

      // The VJOURNAL moved on the server: j-personal has it, j-work is empty.
      await expect
        .poll(async () => Object.keys((await dump(page, baseURL!, J_PERSONAL)) ?? {}).length, {
          timeout: 15_000,
        })
        .toBe(1)
      const personalIcs = Object.values((await dump(page, baseURL!, J_PERSONAL)) ?? {}).join('\n')
      expect(personalIcs).toContain('Relocatable entry')
      await expect
        .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
          timeout: 15_000,
        })
        .toBe(0)

      // And the UI tracks it: hiding the source calendar keeps the entry,
      // hiding the target takes it away.
      await hideCalendar(page, 'j-work')
      await expect(page.getByText('Relocatable entry').first()).toBeVisible()
      await hideCalendar(page, 'j-personal')
      await expect(page.getByText('Relocatable entry').first()).toBeHidden()
    })

    test('moving an entry to the Offline calendar keeps it locally and removes it from the server', async ({
      page,
      baseURL,
    }) => {
      await clearState(page)
      await seedMoveAccount(page, baseURL!)
      await page.request.put(`${baseURL}/mock-caldav${J_WORK}j-move-entry.ics`, {
        data: MOVE_VJOURNAL('Relocatable entry', 'Should move to the Offline calendar.'),
      })
      await seedJournalMoveStore(page)

      await page.goto('/journal')
      await syncAll(page)
      await expect(page.getByText('Relocatable entry').first()).toBeVisible()

      await page.getByText('Relocatable entry').first().dblclick()
      await pickJournalCalendar(page, 'default')
      await expect(page.locator('[data-component="journal-save-status"]')).toContainText(
        /Saved|saved locally/,
        { timeout: 15_000 }
      )

      // The server copy is gone…
      await expect
        .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
          timeout: 15_000,
        })
        .toBe(0)
      // …but the entry survives locally in the Offline calendar. A regression
      // here deleted it everywhere (deleteCalDAVEvent also removes the store
      // record on success).
      await expect(page.getByText('Relocatable entry').first()).toBeVisible()
    })

    test('moving a local-only entry into a server calendar creates it there', async ({
      page,
      baseURL,
    }) => {
      await clearState(page)
      await seedMoveAccount(page, baseURL!)
      await seedJournalMoveStore(page, {
        id: 'local-entry',
        title: 'Offline thought',
        body: 'Written before any account existed.',
        date: day(15),
      })

      await page.goto('/journal')
      await expect(page.getByText('Offline thought').first()).toBeVisible()

      await page.getByText('Offline thought').first().dblclick()
      await pickJournalCalendar(page, 'j-work')
      await expect(page.locator('[data-component="journal-save-status"]')).toContainText(
        /Saved|saved locally/,
        { timeout: 15_000 }
      )

      // The VJOURNAL now exists on the server under j-work/.
      await expect
        .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
          timeout: 15_000,
        })
        .toBe(1)
      const workIcs = Object.values((await dump(page, baseURL!, J_WORK)) ?? {}).join('\n')
      expect(workIcs).toContain('Offline thought')
    })

    test('an entry can round-trip Offline and back without stale server links', async ({
      page,
      baseURL,
    }) => {
      await clearState(page)
      await seedMoveAccount(page, baseURL!)
      await page.request.put(`${baseURL}/mock-caldav${J_WORK}j-roundtrip.ics`, {
        data: MOVE_VJOURNAL('Round trip', 'Lands back on the server.'),
      })
      await seedJournalMoveStore(page)

      await page.goto('/journal')
      await syncAll(page)
      await expect(page.getByText('Round trip').first()).toBeVisible()

      // CalDAV → Offline: the server copy is deleted, the entry stays local.
      // The split pane uses a narrow-screen editor overlay; return to the
      // list before selecting the same entry again.
      const backToEntries = page.getByRole('button', { name: '← All entries' })
      if (await backToEntries.isVisible().catch(() => false)) await backToEntries.click()
      await page.getByText('Round trip').first().click()
      await pickJournalCalendar(page, 'default')
      await expect(page.locator('[data-component="journal-save-status"]')).toContainText(
        /Saved|saved locally/,
        { timeout: 15_000 }
      )
      await expect
        .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
          timeout: 15_000,
        })
        .toBe(0)
      await expect(page.getByText('Round trip').first()).toBeVisible()

      // Offline → CalDAV: the entry must be re-created as a fresh resource — a
      // stale resourceHref/etag from the deleted copy must not be reused (the
      // pre-fix entry kept them, leaving a dangling link to a 404).
      const backToEntriesAgain = page.getByRole('button', { name: '← All entries' })
      if (await backToEntriesAgain.isVisible().catch(() => false)) await backToEntriesAgain.click()
      await page.getByText('Round trip').first().click()
      await pickJournalCalendar(page, 'j-work')
      await expect(page.locator('[data-component="journal-save-status"]')).toContainText(
        /Saved|saved locally/,
        { timeout: 15_000 }
      )
      await expect
        .poll(async () => Object.keys((await dump(page, baseURL!, J_WORK)) ?? {}).length, {
          timeout: 15_000,
        })
        .toBe(1)
      const roundtripIcs = Object.values((await dump(page, baseURL!, J_WORK)) ?? {}).join('\n')
      expect(roundtripIcs).toContain('Round trip')
      expect(roundtripIcs).toContain('Lands back on the server.')
    })
  })
})
