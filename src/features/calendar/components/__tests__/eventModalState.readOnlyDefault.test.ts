import { describe, it, expect } from 'vitest'
import { getInitialFormState } from '../eventModalState'

/**
 * A new event must default to a calendar it can actually be saved to.
 *
 * EventModal's Create button validates the chosen `calendarId` against a list
 * that excludes read-only calendars, while the default pick used to run over a
 * list filtered only by supported components. A read-only calendar sitting
 * first — a webcal subscription, or anything the server grants no write
 * privilege on — was therefore selected by default and then rejected by the
 * button: Create greyed out, the picker showing the offending calendar, and
 * nothing on screen saying why.
 */
describe('default calendar selection skips read-only calendars', () => {
  const state = (calendars: { id: string; isDefault: boolean; readOnly?: boolean }[]) =>
    getInitialFormState(true, null, '2026-06-15', null, [], calendars, [])

  it('skips a read-only calendar that sits first', () => {
    expect(
      state([
        { id: 'subscribed', isDefault: false, readOnly: true },
        { id: 'writable', isDefault: false },
      ]).calendarId
    ).toBe('writable')
  })

  it('skips a read-only calendar even when it is flagged default', () => {
    expect(
      state([
        { id: 'subscribed', isDefault: true, readOnly: true },
        { id: 'writable', isDefault: false },
      ]).calendarId
    ).toBe('writable')
  })

  it('still honours the default flag among writable calendars', () => {
    expect(
      state([
        { id: 'first', isDefault: false },
        { id: 'preferred', isDefault: true },
      ]).calendarId
    ).toBe('preferred')
  })

  it('falls back to a read-only calendar when every calendar is read-only', () => {
    // No good answer exists here. Returning nothing would leave `calendarId`
    // empty and blame an unselected calendar; picking one lets the modal
    // render its read-only notice, which does explain the situation.
    expect(
      state([
        { id: 'ro-a', isDefault: false, readOnly: true },
        { id: 'ro-b', isDefault: true, readOnly: true },
      ]).calendarId
    ).toBe('ro-b')
  })

  it('applies the same pick when the modal is closed', () => {
    // The closed-modal early return computes its own default; it drifted from
    // the open path once before.
    expect(
      getInitialFormState(
        false,
        null,
        null,
        null,
        [],
        [
          { id: 'subscribed', isDefault: true, readOnly: true },
          { id: 'writable', isDefault: false },
        ],
        []
      ).calendarId
    ).toBe('writable')
  })
})
