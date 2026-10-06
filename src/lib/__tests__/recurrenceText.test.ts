import { afterEach, describe, expect, it } from 'vitest'
import { describeRecurrenceRule } from '../recurrence'
import { setLanguage } from '../i18n'
import { formatInviteBody, buildMailtoUri } from '../mailtoInvite'
import { makeEvent, makeRule } from './fixtures'

afterEach(async () => {
  await setLanguage('en')
})

describe('localised recurrence descriptions', () => {
  it('describes simple rules in German', async () => {
    await setLanguage('de')
    expect(describeRecurrenceRule(makeRule({ frequency: 'daily' }))).toBe('Jeden Tag')
    expect(describeRecurrenceRule(makeRule({ frequency: 'weekly', interval: 2 }))).toBe(
      'Alle 2 Wochen'
    )
    expect(describeRecurrenceRule(makeRule({ frequency: 'secondly', interval: 30 }))).toBe(
      'Alle 30 Sekunden'
    )
  })

  it('names weekdays and ordinals in the active language', async () => {
    await setLanguage('fr')
    expect(describeRecurrenceRule(makeRule({ frequency: 'weekly', byWeekday: [1] }))).toBe(
      'Chaque semaine le lundi'
    )
    await setLanguage('it')
    expect(
      describeRecurrenceRule(makeRule({ frequency: 'monthly', byWeekday: [0], byDayOrdinals: [2] }))
    ).toBe('Ogni mese la seconda domenica')
  })

  it('appends the count in the active language', async () => {
    await setLanguage('es')
    expect(describeRecurrenceRule(makeRule({ frequency: 'daily', count: 1 }))).toBe(
      'Cada día, 1 vez'
    )
    expect(describeRecurrenceRule(makeRule({ frequency: 'daily', count: 5 }))).toBe(
      'Cada día, 5 veces'
    )
  })

  it('keeps the English output unchanged', async () => {
    expect(
      describeRecurrenceRule(makeRule({ frequency: 'weekly', byWeekday: [1, 3], count: 5 }))
    ).toBe('Every week on Monday, Wednesday for 5 times')
  })
})

describe('localised invite email', () => {
  it('writes the invite in the active language', async () => {
    await setLanguage('nl')
    const event = makeEvent({
      title: 'Sprint',
      location: 'Zaal 4',
      attendees: [{ email: 'a@example.com' }],
    })
    const body = formatInviteBody(event)
    expect(body).toContain('Je bent uitgenodigd voor: Sprint')
    expect(body).toContain('Waar: Zaal 4')
    const uri = buildMailtoUri(event)!.uri
    expect(decodeURIComponent(uri.split('?subject=')[1].split('&body=')[0])).toMatch(
      /^Uitnodiging: Sprint/
    )
  })
})
