import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CATEGORY_STYLE_RULES,
  normalizeCategoryStyleRules,
  resolveCategoryAppearance,
} from '../categoryStyles'
import type { CategoryStyleRule } from '@/types/categoryStyles'

const pencil: CategoryStyleRule = {
  id: 'pencil',
  categories: 'maybe',
  treatment: 'tentative',
  font: 'hand',
  color: '#777985',
  enabled: true,
}

describe('category styles', () => {
  it.each(['not confirmed', 'unconfirmed', 'tentative', 'maybe'])(
    'uses texture for %s by default',
    (category) => {
      expect(
        resolveCategoryAppearance({ categories: [category] }, [], DEFAULT_CATEGORY_STYLE_RULES)
      ).toEqual({ texture: '#607fa3' })
    }
  )

  it('matches exact names ignoring case and whitespace, including category ids', () => {
    const categories = [{ id: 'local-id', name: ' IMPORTANT ', color: '#123456' }]
    expect(
      resolveCategoryAppearance(
        { categories: ['local-id'] },
        categories,
        DEFAULT_CATEGORY_STYLE_RULES
      )
    ).toEqual({ sketch: '#b64248' })
    expect(
      resolveCategoryAppearance(
        { categories: ['Very Important'] },
        [],
        DEFAULT_CATEGORY_STYLE_RULES
      )
    ).toEqual({})
    expect(resolveCategoryAppearance({}, [], DEFAULT_CATEGORY_STYLE_RULES)).toEqual({})
  })

  it('composes sketch and texture, independently of category colours', () => {
    expect(
      resolveCategoryAppearance(
        { categories: ['important', 'maybe'] },
        [],
        DEFAULT_CATEGORY_STYLE_RULES
      )
    ).toEqual({ sketch: '#b64248', texture: '#607fa3' })
  })

  it('uses the last matching value for conflicting properties, preserving inherited fonts', () => {
    const red = { ...DEFAULT_CATEGORY_STYLE_RULES[0], categories: 'maybe', color: '#ff0000' }
    const blue = { ...red, id: 'blue', color: '#0000ff' }
    const resolve = (rules: CategoryStyleRule[]) =>
      resolveCategoryAppearance({ categories: ['maybe'] }, [], rules)
    expect(resolve([pencil, red, blue])).toMatchObject({
      sketch: '#0000ff',
      font: 'hand',
      pencil: true,
    })
    expect(resolve([blue, red, pencil])).toMatchObject({ sketch: '#ff0000', font: 'hand' })
    expect(resolve([pencil, { ...red, font: 'standard' }])).toMatchObject({ font: 'standard' })
    expect(
      resolve([
        { ...red, enabled: false },
        { ...pencil, categories: ', ,' },
      ])
    ).toEqual({})
  })

  it('resolves underline versus strike-through in rule order', () => {
    const done: CategoryStyleRule = { ...pencil, treatment: 'done' }
    const marker: CategoryStyleRule = { ...pencil, id: 'marker', treatment: 'deadline' }
    const event = { categories: ['maybe'] }
    expect(resolveCategoryAppearance(event, [], [done, marker])).toMatchObject({
      done: false,
      marker: pencil.color,
    })
    expect(resolveCategoryAppearance(event, [], [marker, done])).toMatchObject({
      done: true,
      marker: undefined,
    })
  })

  it('validates stored or synced rules without restoring an intentionally empty list', () => {
    expect(normalizeCategoryStyleRules(undefined)).toEqual(DEFAULT_CATEGORY_STYLE_RULES)
    expect(normalizeCategoryStyleRules([])).toEqual([])
    expect(
      normalizeCategoryStyleRules([
        null,
        {},
        pencil,
        pencil,
        { ...pencil, id: 'bad', color: 'url(unsafe)' },
      ])
    ).toEqual([pencil])
    expect(normalizeCategoryStyleRules([{ ...pencil, id: 'bad', enabled: 'true' }])).toEqual([])
  })
})
