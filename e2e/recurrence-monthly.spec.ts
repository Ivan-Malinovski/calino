/**
 * E2E spec for the monthly recurrence pattern picker (R2.4).
 *
 * Before R2.4, the monthly pattern picker (e.g. "Second Tuesday") was
 * writing its per-BYDAY positional control to a field named `bySetPos`
 * in the form state, which was the wrong destination — `bySetPos` is
 * RFC 5545's standalone positional rule part (e.g. "the last weekday"),
 * not the per-BYDAY ordinal (e.g. "second Tuesday"). The result was
 * that selecting "Second Tuesday" in the UI would round-trip to the
 * server as `BYSETPOS=2;BYDAY=TU`, which most CalDAV servers interpret
 * as a meaningless or no-op rule.
 *
 * R2.4 renamed the field to `byDayOrdinals` and updated every consumer
 * (eventModalState, EventFormFields, RecurrenceFields, EventModal,
 * icalTypeMapping). This spec exercises the user-visible path:
 *
 *   1. Open a Tuesday day cell → modal opens pre-filled with Tuesday.
 *   2. Enable Recurring, pick Monthly, set pattern to "nth weekday",
 *      set nth to "Second".
 *   3. Save.
 *   4. Reload the page (forces the store to rehydrate from localStorage).
 *   5. Open the same event from the calendar.
 *   6. Assert the pattern, nth, and weekday are all preserved.
 *
 * If the bug were present, step 6 would fail because the in-memory
 * store would lose the ordinal across the save→reload round trip
 * (it would have been written to the wrong field, and the read path
 * would default to "First" + the start weekday).
 *
 * Conventions: see `e2e/__user-flow.template.ts` for the selector
 * hierarchy (data-component > aria-label > role+name > text).
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('Monthly day selection', () => {
  for (const { year, day, startDay, dates } of [
    { year: 2027, day: '-1', startDay: '31', dates: ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'] },
    { year: 2028, day: '-1', startDay: '31', dates: ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'] },
    { year: 2028, day: '30', startDay: '30', dates: ['2028-01-30', null, '2028-03-30', '2028-04-30'] },
    { year: 2028, day: '31', startDay: '31', dates: ['2028-01-31', null, '2028-03-31', null] },
  ]) {
    test(`monthly day ${day} in ${year} preserves its meaning across months and reload`, async ({ page }) => {
      await clearState(page)
      await page.clock.setFixedTime(new Date(year, 0, 1, 12))
      await page.goto('/month')
      await page.locator(`[data-date="${year}-01-${startDay}"]`).click()
      const modal = page.locator('[data-component="modal-card"]')
      const title = `Monthly day ${day}`
      await modal.locator('[data-component="event-title-input"]').fill(title)
      await modal.getByText('Recurring', { exact: true }).click()
      await modal.locator('#recurrence-select').selectOption('monthly')
      const dayPicker = modal.getByRole('combobox', { name: 'Day', exact: true })
      await expect(dayPicker.locator('option[value="31"]')).toHaveText('31')
      await expect(dayPicker.locator('option[value="-1"]')).toHaveText('Last day')
      await dayPicker.selectOption(day)
      await modal.locator('[data-component="modal-save"]').click()
      await expect(modal).toBeHidden()
      await page.reload()

      const cards = page.locator('[data-component="event-card"]').filter({ hasText: title })
      await cards.first().click()
      await page.locator('[data-component="event-preview"]')
        .getByRole('button', { name: /Open event/ }).click()
      await expect(dayPicker).toHaveValue(day)
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()

      for (const [index, date] of dates.entries()) {
        const month = `${year}-${String(index + 1).padStart(2, '0')}`
        const monthCards = page.locator(`[data-date^="${month}"] [data-component="event-card"]`)
          .filter({ hasText: title })
        if (date) {
          await expect(monthCards).toHaveCount(1)
          await expect(page.locator(`[data-date="${date}"] [data-component="event-card"]`)
            .filter({ hasText: title })).toBeVisible()
        } else {
          await expect(monthCards).toHaveCount(0)
        }
        if (index < dates.length - 1) {
          await page.locator('[data-component="header"]').getByRole('button', { name: 'Next', exact: true }).click()
        }
      }
    })
  }
})

test.describe('Monthly recurrence — second Tuesday (R2.4 byDayOrdinals)', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('second Tuesday pattern survives save → reload → reopen', async ({ page }) => {
    // 1. Open the month view and click on any Tuesday. Day cells are
    //    focusable containers without a button role (the day-number button is
    //    the semantic control); their aria-label still names the day.
    await page.goto('/month')
    const tuesdayCell = page.locator('[data-date][aria-label^="Tuesday, "]').first()
    await expect(tuesdayCell).toBeVisible()
    await tuesdayCell.click()

    // 2. Modal opens. Fill the title.
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal.locator('[data-component="event-title-input"]').fill('Second Tuesday standup')

    // 3. Enable Recurring.
    await modal.getByText('Recurring', { exact: true }).click()

    // 4. Select Monthly in the Repeat select (id="recurrence-select").
    await modal.locator('#recurrence-select').selectOption('monthly')

    // 5. The default Monthly pattern is "On day of the month" (recurring
    //    on the same numeric day, e.g. the 15th). Switch to "On the nth
    //    weekday" to set up "Second Tuesday".
    await expect(modal.getByLabel('Monthly pattern')).toHaveValue('dayOfMonth')
    await modal.getByLabel('Monthly pattern').selectOption('nthWeekday')

    // 6. After switching, the nth is inferred from the start day (e.g.
    //    clicking the 29th gives Fifth). Change to Second regardless.
    await modal.getByLabel('Nth weekday of the month').selectOption('2')

    // 7. The weekday is already Tuesday (the start day we clicked).
    //    Calino uses getUTCDay() values internally: Sun=0, Mon=1,
    //    Tue=2, ..., Sat=6. With the default firstDayOfWeek=1
    //    (Monday), Tuesday's value in the select is 2.
    //    Use exact: true because getByLabel matches "weekday" inside
    //    "Nth weekday of the month" by default.
    await expect(modal.getByLabel('Weekday', { exact: true })).toHaveValue('2')

    // 6. Save.
    await modal.locator('[data-component="modal-save"]').click()
    await expect(modal).toBeHidden({ timeout: 5_000 })

    // 7. Reload to force the store to rehydrate from localStorage.
    //    This is the step that catches the R2.4 bug: if the in-memory
    //    store wrote to bySetPos instead of byDayOrdinals, the read
    //    path would not see the ordinal after reload.
    await page.reload()
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    // 8. Open the same event. The event was saved to the Tuesday we
    //    clicked, which is in the displayed month. Find an event card
    //    with the title we set.
    const eventCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Second Tuesday standup' })
      .first()
    await expect(eventCard).toBeVisible()
    await eventCard.click()

    // 9. Open the event from the preview popup.
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/ })
      .click()
    await expect(modal).toBeVisible()

    // 10. Assert the recurrence UI round-trips the pattern correctly.
    await expect(modal.getByText('Recurring', { exact: true })).toBeVisible()
    await expect(modal.locator('#recurrence-select')).toHaveValue('monthly')
    await expect(modal.getByLabel('Monthly pattern')).toHaveValue('nthWeekday')
    await expect(modal.getByLabel('Nth weekday of the month')).toHaveValue('2')
    // The weekday is Tuesday (value 2 in getUTCDay() with firstDayOfWeek=1).
    await expect(modal.getByLabel('Weekday', { exact: true })).toHaveValue('2')
  })
})
