import type { CalendarEvent } from '@/types'
import type { Category } from '@/types/categories'
import { CATEGORY_STYLE_TREATMENTS, type CategoryStyleRule } from '@/types/categoryStyles'

export const DEFAULT_CATEGORY_STYLE_RULES: CategoryStyleRule[] = [
  {
    id: 'important',
    categories: 'important',
    treatment: 'important',
    font: 'inherit',
    color: '#b64248',
    enabled: true,
  },
  {
    id: 'tentative',
    categories: 'not confirmed, unconfirmed, tentative, maybe',
    treatment: 'travel',
    font: 'inherit',
    color: '#607fa3',
    enabled: true,
  },
]

/** Preserve an intentionally empty list. Reject malformed imported/synced rules. */
export function normalizeCategoryStyleRules(
  value: unknown,
  fallback = DEFAULT_CATEGORY_STYLE_RULES
): CategoryStyleRule[] {
  if (!Array.isArray(value)) return fallback
  const ids = new Set<string>()
  return value
    .filter((r): r is CategoryStyleRule => {
      if (!r || typeof r !== 'object') return false
      const valid =
        typeof r.id === 'string' &&
        r.id.length > 0 &&
        !ids.has(r.id) &&
        typeof r.categories === 'string' &&
        CATEGORY_STYLE_TREATMENTS.includes(r.treatment) &&
        ['inherit', 'standard', 'hand'].includes(r.font) &&
        typeof r.color === 'string' &&
        /^#[0-9a-f]{6}$/i.test(r.color) &&
        typeof r.enabled === 'boolean'
      if (valid) ids.add(r.id)
      return valid
    })
    .map(({ id, categories, treatment, font, color, enabled }) => ({
      id,
      categories,
      treatment,
      font,
      color,
      enabled,
    }))
}

export interface CategoryAppearance {
  fill?: string
  pencil?: boolean
  sketch?: string
  dashed?: string
  texture?: string
  marker?: string
  done?: boolean
  font?: 'standard' | 'hand'
}

/** Independent properties compose; the last matching rule wins each property. */
export function resolveCategoryAppearance(
  event: Pick<CalendarEvent, 'categories'>,
  categories: Category[],
  rules: CategoryStyleRule[]
): CategoryAppearance {
  const names = new Set(
    (event.categories ?? []).map((value) =>
      (categories.find((c) => c.id === value)?.name ?? value).trim().toLowerCase()
    )
  )
  const result: CategoryAppearance = {}
  for (const rule of rules) {
    if (
      !rule.enabled ||
      !rule.categories.split(',').some((c) => c.trim() && names.has(c.trim().toLowerCase()))
    )
      continue
    switch (rule.treatment) {
      case 'important':
        result.sketch = rule.color
        break
      case 'tentative':
        result.fill = rule.color
        result.pencil = true
        break
      case 'focus':
        result.fill = rule.color
        result.pencil = false
        result.dashed = rule.color
        break
      case 'travel':
        result.texture = rule.color
        break
      case 'deadline':
        result.fill = rule.color
        result.pencil = false
        result.done = false
        result.marker = rule.color
        break
      case 'done':
        result.fill = rule.color
        result.pencil = true
        result.marker = undefined
        result.done = true
        break
    }
    if (rule.font !== 'inherit') result.font = rule.font
  }
  return result
}
