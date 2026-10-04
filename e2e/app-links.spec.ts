import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

// The E2E server adds `linkSchemes: { obsidian: 'Obsidian' }` to its config
// (see vite.config.ts), so obsidian:// is an app scheme that is allowed here.
const BARE_APP_LINK = 'obsidian://open?vault=Work&file=Plan'
const NAMED_APP_LINK = 'obsidian://open?vault=Work&file=Project'
const ENCODED_APP_LINK = 'obsidian://open?vault=Заметки'
const CODE_APP_LINK = 'obsidian://open?vault=Code'
const UNLISTED_APP_LINK = 'anytype://object?objectId=abc'

const DESCRIPTION = [
  `Notes: ${BARE_APP_LINK}`,
  '',
  `[Project page](${NAMED_APP_LINK})`,
  '',
  `**${ENCODED_APP_LINK}** and \`${CODE_APP_LINK}\``,
  '',
  `Other: ${UNLISTED_APP_LINK}`,
  '',
  `[unlisted](${UNLISTED_APP_LINK}) [do not run](javascript:alert(1))`,
].join('\n')

test.describe('links into other apps in descriptions', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.addInitScript((description) => {
      if (sessionStorage.getItem('__calino_test_app_links')) return
      sessionStorage.setItem('__calino_test_app_links', '1')
      const at = (hour: number): string => {
        const date = new Date()
        date.setHours(hour, 0, 0, 0)
        return date.toISOString()
      }
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Offline calendar',
                color: '#4285F4',
                isVisible: true,
                isDefault: true,
              },
            ],
            events: [
              {
                id: 'planning-sync',
                calendarId: 'default',
                title: 'Planning sync',
                type: 'event',
                start: at(10),
                end: at(11),
                isAllDay: false,
                description,
              },
            ],
          },
          version: 1,
        })
      )
    }, DESCRIPTION)

    await page.goto('/month')
    await page
      .getByRole('button', { name: /Planning sync/ })
      .first()
      .click()
    await expect(page.locator('[data-component="event-preview"]')).toBeVisible()
  })

  test('a configured scheme is linked, by the app name when the link is bare', async ({ page }) => {
    const preview = page.locator('[data-component="event-preview"]')

    const bare = preview.getByRole('link', { name: 'Obsidian ↗' }).first()
    await expect(bare).toHaveAttribute('href', BARE_APP_LINK)
    // A link into an app opens the app; a new tab would stay behind, empty.
    await expect(bare).not.toHaveAttribute('target')
    await expect(preview.getByRole('link', { name: 'Project page' })).toHaveAttribute(
      'href',
      NAMED_APP_LINK
    )
  })

  test('a bare link is named after the app inside emphasis and left alone in code', async ({
    page,
  }) => {
    const preview = page.locator('[data-component="event-preview"]')

    await expect(preview.locator('strong a')).toHaveText('Obsidian ↗')
    await expect(preview.locator('strong a')).toHaveAttribute('href', encodeURI(ENCODED_APP_LINK))
    await expect(preview.locator('code')).toHaveText(CODE_APP_LINK)
    await expect(preview.locator('code a')).toHaveCount(0)
  })

  test('schemes that are not configured, or that run code, are not linked', async ({ page }) => {
    const preview = page.locator('[data-component="event-preview"]')

    await expect(preview).toContainText(UNLISTED_APP_LINK)
    await expect(preview.getByText('unlisted', { exact: true })).toHaveAttribute('href', '')
    await expect(preview.getByText('do not run')).toHaveAttribute('href', '')
    await expect(preview.locator('a[href^="anytype:"], a[href^="javascript:"]')).toHaveCount(0)
  })
})
