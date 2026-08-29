import { expect, test } from '@playwright/test'

test.describe('desktop notification assets', () => {
  test('serves the icon used by browser reminders', async ({ request }) => {
    const response = await request.get('/apple-touch-icon.png')

    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('image/png')
  })
})
